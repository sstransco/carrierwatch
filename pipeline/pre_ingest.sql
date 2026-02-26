-- ============================================================
-- Pre-ingest: maximize bulk load performance
-- Run BEFORE all pipeline scripts
-- ============================================================

-- 1. WAL / checkpoint tuning (makes commits async — safe, just delayed durability)
ALTER SYSTEM SET synchronous_commit = off;
ALTER SYSTEM SET wal_buffers = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET max_wal_size = '4GB';
SELECT pg_reload_conf();

-- 2. Disable autovacuum on heavy tables (prevents interruptions mid-load)
ALTER TABLE carriers           SET (autovacuum_enabled = false);
ALTER TABLE inspections        SET (autovacuum_enabled = false);
ALTER TABLE crashes            SET (autovacuum_enabled = false);
ALTER TABLE authority_history  SET (autovacuum_enabled = false);
ALTER TABLE insurance_history  SET (autovacuum_enabled = false);

-- 3. Drop all non-PK indexes on carriers
--    (PK stays — needed for ON CONFLICT DO UPDATE)
DROP INDEX IF EXISTS idx_carriers_location;
DROP INDEX IF EXISTS idx_carriers_location_geom;
DROP INDEX IF EXISTS idx_carriers_mc_number;
DROP INDEX IF EXISTS idx_carriers_state;
DROP INDEX IF EXISTS idx_carriers_status;
DROP INDEX IF EXISTS idx_carriers_address_hash;
DROP INDEX IF EXISTS idx_carriers_legal_name_trgm;
DROP INDEX IF EXISTS idx_carriers_safety_rating;
DROP INDEX IF EXISTS idx_carriers_authority_date;
DROP INDEX IF EXISTS idx_carriers_risk_score;
DROP INDEX IF EXISTS idx_carriers_risk_flags;

-- 4. Drop all non-PK indexes on inspections
DROP INDEX IF EXISTS idx_inspections_dot;
DROP INDEX IF EXISTS idx_inspections_date;
DROP INDEX IF EXISTS idx_inspections_state;

-- 5. Drop all non-PK indexes on crashes
DROP INDEX IF EXISTS idx_crashes_dot;
DROP INDEX IF EXISTS idx_crashes_date;
DROP INDEX IF EXISTS idx_crashes_state;

-- 6. Drop non-PK indexes on authority_history
DROP INDEX IF EXISTS idx_auth_history_dot;
DROP INDEX IF EXISTS idx_auth_history_docket;

-- 7. Drop all non-PK indexes on insurance_history
DROP INDEX IF EXISTS idx_ins_history_dot;
DROP INDEX IF EXISTS idx_ins_history_docket;
DROP INDEX IF EXISTS idx_ins_history_effective;
DROP INDEX IF EXISTS idx_ins_history_cancl;

-- 8. Drop indexes on tables loaded by other scripts
DROP INDEX IF EXISTS idx_carrier_principals_dot;
DROP INDEX IF EXISTS idx_carrier_principals_name;
DROP INDEX IF EXISTS idx_carrier_principals_norm;
DROP INDEX IF EXISTS idx_insp_violations_insp;
DROP INDEX IF EXISTS idx_insp_violations_dot;
DROP INDEX IF EXISTS idx_ppp_loans_dot;
DROP INDEX IF EXISTS idx_ppp_loans_hash;

\echo 'Pre-ingest complete: indexes dropped, autovacuum off, WAL async.'
