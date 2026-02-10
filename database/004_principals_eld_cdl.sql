-- Migration 004: Company Principals, Inspection Violations, CDL Schools

-- ==========================================
-- CARRIER PRINCIPALS (Company Officers)
-- ==========================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS carrier_principals (
    id SERIAL PRIMARY KEY,
    dot_number INTEGER NOT NULL,
    officer_name TEXT NOT NULL,
    officer_name_normalized TEXT NOT NULL,
    officer_position TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_principals_dot ON carrier_principals(dot_number);
CREATE INDEX IF NOT EXISTS idx_principals_name ON carrier_principals(officer_name_normalized);
CREATE INDEX IF NOT EXISTS idx_principals_name_trgm ON carrier_principals USING gin(officer_name_normalized gin_trgm_ops);

-- ==========================================
-- INSPECTION VIOLATIONS (per-violation detail)
-- ==========================================
CREATE TABLE IF NOT EXISTS inspection_violations (
    id SERIAL PRIMARY KEY,
    inspection_id BIGINT NOT NULL,
    dot_number INTEGER,
    violation_code TEXT NOT NULL,
    violation_description TEXT,
    oos_indicator BOOLEAN DEFAULT FALSE,
    violation_category TEXT,
    unit_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_inspection ON inspection_violations(inspection_id);
CREATE INDEX IF NOT EXISTS idx_violations_dot ON inspection_violations(dot_number);
CREATE INDEX IF NOT EXISTS idx_violations_code ON inspection_violations(violation_code);
CREATE INDEX IF NOT EXISTS idx_violations_eld ON inspection_violations(dot_number) WHERE violation_code LIKE '395.%';

-- ELD/HOS summary columns on carriers
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS eld_violations INTEGER DEFAULT 0;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS hos_violations INTEGER DEFAULT 0;

-- ==========================================
-- CDL TRAINING SCHOOLS
-- ==========================================
CREATE TABLE IF NOT EXISTS cdl_schools (
    id SERIAL PRIMARY KEY,
    provider_name TEXT NOT NULL,
    physical_address TEXT,
    city TEXT,
    state VARCHAR(2),
    zip VARCHAR(10),
    phone TEXT,
    training_types TEXT[],
    provider_type TEXT,
    status TEXT DEFAULT 'active',
    location geography(Point, 4326),
    address_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cdl_schools_state ON cdl_schools(state);
CREATE INDEX IF NOT EXISTS idx_cdl_schools_location ON cdl_schools USING gist(location);
CREATE INDEX IF NOT EXISTS idx_cdl_schools_location_geom ON cdl_schools USING gist((location::geometry)) WHERE location IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdl_schools_location_geom ON cdl_schools USING gist((location::geometry)) WHERE location IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdl_schools_address_hash ON cdl_schools(address_hash);

-- ==========================================
-- OFFICER CARRIER COUNTS (materialized view for leaderboard)
-- ==========================================
CREATE MATERIALIZED VIEW IF NOT EXISTS officer_carrier_counts AS
SELECT
    officer_name_normalized,
    COUNT(DISTINCT dot_number) AS carrier_count,
    array_agg(DISTINCT dot_number ORDER BY dot_number) AS dot_numbers
FROM carrier_principals
GROUP BY officer_name_normalized;

CREATE UNIQUE INDEX IF NOT EXISTS idx_occ_name ON officer_carrier_counts (officer_name_normalized);
CREATE INDEX IF NOT EXISTS idx_occ_count ON officer_carrier_counts (carrier_count DESC);
