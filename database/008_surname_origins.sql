-- 008: Surname origin classification lookup table + demographics map support
-- Maps surnames to predicted national origin using character n-gram Naive Bayes

CREATE TABLE IF NOT EXISTS surname_origins (
    surname TEXT PRIMARY KEY,
    country_code CHAR(2) NOT NULL,    -- ISO 3166-1 alpha-2 (US, IN, DE, JP, etc.)
    country_name TEXT NOT NULL,
    region TEXT NOT NULL,              -- "South Asian", "East Asian", "Western European", etc.
    confidence REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_surname_origins_country ON surname_origins (country_code);
CREATE INDEX IF NOT EXISTS idx_surname_origins_region ON surname_origins (region);

-- Add dominant_origin to carriers for map overlay
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS dominant_origin CHAR(2);
CREATE INDEX IF NOT EXISTS idx_carriers_dominant_origin ON carriers (dominant_origin) WHERE dominant_origin IS NOT NULL;

-- Update carriers_mvt to include dominant_origin
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
            dominant_origin,
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
