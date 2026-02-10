-- 005_counties.sql
-- US County boundaries for choropleth heatmap front page
-- Source: Census Bureau Cartographic Boundary Files (cb_2023_us_county_500k)

-- ============================================================
-- 1. US Counties table (loaded via shp2pgsql from Census TIGER)
-- ============================================================
CREATE TABLE IF NOT EXISTS us_counties (
    geoid VARCHAR(5) PRIMARY KEY,          -- 5-digit FIPS (state + county)
    statefp VARCHAR(2) NOT NULL,
    countyfp VARCHAR(3) NOT NULL,
    name VARCHAR(100) NOT NULL,
    namelsad VARCHAR(100),
    state_abbr VARCHAR(2),
    aland BIGINT,
    awater BIGINT,
    geom geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_us_counties_geom ON us_counties USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_us_counties_statefp ON us_counties (statefp);

-- ============================================================
-- 2. Add county_geoid to carriers
-- ============================================================
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS county_geoid VARCHAR(5);
CREATE INDEX IF NOT EXISTS idx_carriers_county_geoid ON carriers (county_geoid);

-- ============================================================
-- 3. State FIPS → abbreviation lookup
-- ============================================================
-- Run after loading shapefile data:
-- UPDATE us_counties SET state_abbr = ... (handled by county_setup.py)

-- ============================================================
-- 4. County carrier stats materialized view
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS county_carrier_stats AS
SELECT
    co.geoid,
    co.name AS county_name,
    co.statefp,
    co.state_abbr,
    co.geom,
    COALESCE(COUNT(c.dot_number), 0)::integer AS carrier_count,
    COALESCE(SUM(CASE WHEN c.operating_status = 'AUTHORIZED' THEN 1 ELSE 0 END), 0)::integer AS active_count,
    COALESCE(SUM(CASE WHEN COALESCE(c.risk_score, 0) >= 50 THEN 1 ELSE 0 END), 0)::integer AS high_risk_count,
    COALESCE(AVG(NULLIF(c.risk_score, 0)), 0)::integer AS avg_risk_score,
    COALESCE(SUM(c.total_crashes), 0)::integer AS total_crashes,
    COALESCE(SUM(c.fatal_crashes), 0)::integer AS fatal_crashes,
    COALESCE(SUM(c.total_inspections), 0)::integer AS total_inspections,
    COALESCE(AVG(c.vehicle_oos_rate), 0)::real AS avg_vehicle_oos_rate
FROM us_counties co
LEFT JOIN carriers c ON c.county_geoid = co.geoid
GROUP BY co.geoid, co.name, co.statefp, co.state_abbr, co.geom;

CREATE UNIQUE INDEX IF NOT EXISTS idx_county_stats_geoid ON county_carrier_stats (geoid);
CREATE INDEX IF NOT EXISTS idx_county_stats_geom ON county_carrier_stats USING GIST (geom);

-- ============================================================
-- 5. MVT function for Martin tile server
-- ============================================================
CREATE OR REPLACE FUNCTION county_choropleth_mvt(z integer, x integer, y integer, query_params json DEFAULT '{}')
RETURNS bytea AS $$
DECLARE
    bounds geometry;
    result bytea;
    tol float;
BEGIN
    bounds := ST_TileEnvelope(z, x, y);

    -- Zoom-dependent simplification tolerance
    tol := CASE
        WHEN z <= 3 THEN 0.05
        WHEN z <= 5 THEN 0.01
        WHEN z <= 7 THEN 0.005
        WHEN z <= 9 THEN 0.001
        ELSE 0.0001
    END;

    SELECT INTO result ST_AsMVT(tile, 'counties', 4096, 'mvtgeom')
    FROM (
        SELECT
            geoid,
            county_name,
            state_abbr,
            carrier_count,
            active_count,
            high_risk_count,
            avg_risk_score,
            total_crashes,
            fatal_crashes,
            ST_AsMVTGeom(
                ST_Transform(
                    ST_SimplifyPreserveTopology(geom, tol),
                    3857
                ),
                bounds,
                4096, 64, true
            ) AS mvtgeom
        FROM county_carrier_stats
        WHERE ST_Intersects(geom, ST_Transform(bounds, 4326))
          AND carrier_count > 0
    ) AS tile
    WHERE tile.mvtgeom IS NOT NULL;

    RETURN COALESCE(result, '');
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
