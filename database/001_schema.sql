-- CarrierWatch Database Schema
-- PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Main carriers table
CREATE TABLE IF NOT EXISTS carriers (
    dot_number        INTEGER PRIMARY KEY,
    mc_number         VARCHAR(20),
    legal_name        VARCHAR(255) NOT NULL,
    dba_name          VARCHAR(255),
    carrier_operation  VARCHAR(50),
    hm_flag           VARCHAR(5),
    pc_flag           VARCHAR(5),

    -- Physical address
    physical_address  VARCHAR(255),
    physical_city     VARCHAR(100),
    physical_state    VARCHAR(2),
    physical_zip      VARCHAR(10),
    physical_country  VARCHAR(5) DEFAULT 'US',

    -- Mailing address
    mailing_address   VARCHAR(255),
    mailing_city      VARCHAR(100),
    mailing_state     VARCHAR(2),
    mailing_zip       VARCHAR(10),
    mailing_country   VARCHAR(5) DEFAULT 'US',

    -- Location (PostGIS)
    location          geography(Point, 4326),

    -- Company info
    phone             VARCHAR(20),
    power_units       INTEGER DEFAULT 0,
    drivers           INTEGER DEFAULT 0,

    -- Status & authority
    operating_status       VARCHAR(50),
    operating_status_code  VARCHAR(5),
    authority_grant_date   DATE,
    authority_status       VARCHAR(50),
    common_authority       VARCHAR(5),
    contract_authority     VARCHAR(5),
    broker_authority       VARCHAR(5),

    -- Safety
    safety_rating          VARCHAR(50),
    safety_rating_date     DATE,
    safety_review_date     DATE,
    safety_review_type     VARCHAR(50),

    -- Insurance
    insurance_bipd_on_file   INTEGER DEFAULT 0,
    insurance_bipd_required  INTEGER DEFAULT 0,
    insurance_bond_on_file   INTEGER DEFAULT 0,
    insurance_bond_required  INTEGER DEFAULT 0,

    -- Inspection / crash stats
    total_inspections    INTEGER DEFAULT 0,
    total_crashes        INTEGER DEFAULT 0,
    fatal_crashes        INTEGER DEFAULT 0,
    injury_crashes       INTEGER DEFAULT 0,
    tow_crashes          INTEGER DEFAULT 0,
    vehicle_oos_inspections  INTEGER DEFAULT 0,
    vehicle_oos_rate     NUMERIC(5,2) DEFAULT 0,
    driver_oos_inspections   INTEGER DEFAULT 0,
    driver_oos_rate      NUMERIC(5,2) DEFAULT 0,
    hazmat_oos_inspections   INTEGER DEFAULT 0,
    hazmat_oos_rate      NUMERIC(5,2) DEFAULT 0,

    -- Address matching
    address_hash      VARCHAR(64),

    -- Timestamps
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carriers_location ON carriers USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_carriers_location_geom ON carriers USING GIST ((location::geometry)) WHERE location IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carriers_mc_number ON carriers (mc_number);
CREATE INDEX IF NOT EXISTS idx_carriers_state ON carriers (physical_state);
CREATE INDEX IF NOT EXISTS idx_carriers_status ON carriers (operating_status);
CREATE INDEX IF NOT EXISTS idx_carriers_address_hash ON carriers (address_hash);
CREATE INDEX IF NOT EXISTS idx_carriers_legal_name_trgm ON carriers USING GIN (legal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_carriers_safety_rating ON carriers (safety_rating);
CREATE INDEX IF NOT EXISTS idx_carriers_authority_date ON carriers (authority_grant_date);

-- Address clusters materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS address_clusters AS
SELECT
    address_hash,
    MIN(physical_address) AS address,
    MIN(physical_city) AS city,
    MIN(physical_state) AS state,
    MIN(physical_zip) AS zip,
    COUNT(*) AS carrier_count,
    ST_Centroid(ST_Collect(location::geometry))::geography AS centroid,
    ARRAY_AGG(dot_number ORDER BY dot_number) AS dot_numbers,
    SUM(CASE WHEN operating_status = 'AUTHORIZED' THEN 1 ELSE 0 END) AS active_count,
    SUM(total_crashes) AS total_crashes,
    SUM(total_inspections) AS total_inspections,
    AVG(vehicle_oos_rate) AS avg_vehicle_oos_rate
FROM carriers
WHERE address_hash IS NOT NULL
  AND location IS NOT NULL
GROUP BY address_hash
HAVING COUNT(*) >= 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_address_clusters_hash ON address_clusters (address_hash);
CREATE INDEX IF NOT EXISTS idx_address_clusters_centroid ON address_clusters USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_address_clusters_centroid_geom ON address_clusters USING GIST ((centroid::geometry)) WHERE centroid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_address_clusters_count ON address_clusters (carrier_count DESC);
CREATE INDEX IF NOT EXISTS idx_address_clusters_state ON address_clusters (state);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_address_clusters()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY address_clusters;
END;
$$ LANGUAGE plpgsql;

-- Tile-serving helper functions for Martin
-- Carriers layer function
CREATE OR REPLACE FUNCTION carriers_mvt(z integer, x integer, y integer, query_params json DEFAULT '{}')
RETURNS bytea AS $$
DECLARE
    bounds geometry;
    result bytea;
BEGIN
    bounds := ST_TileEnvelope(z, x, y);

    SELECT INTO result ST_AsMVT(tile, 'carriers', 4096, 'geom')
    FROM (
        SELECT
            dot_number,
            legal_name,
            operating_status,
            power_units,
            safety_rating,
            address_hash,
            physical_state,
            total_crashes,
            vehicle_oos_rate,
            COALESCE(risk_score, 0) AS risk_score,
            COALESCE(physical_country, 'US') AS physical_country,
            ST_AsMVTGeom(
                ST_Transform(location::geometry, 3857),
                bounds,
                4096, 64, true
            ) AS geom
        FROM carriers
        WHERE location IS NOT NULL
          AND ST_Intersects(location::geometry, ST_Transform(bounds, 4326))
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Address clusters layer function
-- Zoom-dependent filtering: only show large clusters at low zoom
CREATE OR REPLACE FUNCTION address_clusters_mvt(z integer, x integer, y integer, query_params json DEFAULT '{}')
RETURNS bytea AS $$
DECLARE
    bounds geometry;
    result bytea;
    min_count integer;
BEGIN
    bounds := ST_TileEnvelope(z, x, y);

    -- Progressive disclosure: fewer dots at low zoom, more detail as you zoom in
    min_count := CASE
        WHEN z <= 4 THEN 20
        WHEN z <= 5 THEN 10
        WHEN z <= 6 THEN 7
        WHEN z <= 7 THEN 5
        WHEN z <= 9 THEN 3
        ELSE 2
    END;

    SELECT INTO result ST_AsMVT(tile, 'address_clusters', 4096, 'geom')
    FROM (
        SELECT
            address_hash,
            address,
            city,
            state,
            zip,
            carrier_count,
            active_count,
            total_crashes,
            avg_vehicle_oos_rate::real,
            ST_AsMVTGeom(
                ST_Transform(centroid::geometry, 3857),
                bounds,
                4096, 64, true
            ) AS geom
        FROM address_clusters
        WHERE centroid IS NOT NULL
          AND carrier_count >= min_count
          AND ST_Intersects(centroid::geometry, ST_Transform(bounds, 4326))
    ) AS tile
    WHERE tile.geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
