-- ============================================================
-- Post-ingest: recreate indexes, vacuum, reset settings
-- Run AFTER all pipeline scripts
-- ============================================================

\echo 'Recreating carriers indexes...'
CREATE INDEX IF NOT EXISTS idx_carriers_location          ON carriers USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_carriers_location_geom     ON carriers USING GIST ((location::geometry)) WHERE location IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carriers_mc_number         ON carriers (mc_number);
CREATE INDEX IF NOT EXISTS idx_carriers_state             ON carriers (physical_state);
CREATE INDEX IF NOT EXISTS idx_carriers_status            ON carriers (operating_status);
CREATE INDEX IF NOT EXISTS idx_carriers_address_hash      ON carriers (address_hash);
CREATE INDEX IF NOT EXISTS idx_carriers_legal_name_trgm   ON carriers USING GIN (legal_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_carriers_safety_rating     ON carriers (safety_rating);
CREATE INDEX IF NOT EXISTS idx_carriers_authority_date    ON carriers (authority_grant_date);

\echo 'Recreating inspections indexes...'
CREATE INDEX IF NOT EXISTS idx_inspections_dot   ON inspections (dot_number);
CREATE INDEX IF NOT EXISTS idx_inspections_date  ON inspections (insp_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_state ON inspections (report_state);

\echo 'Recreating crashes indexes...'
CREATE INDEX IF NOT EXISTS idx_crashes_dot   ON crashes (dot_number);
CREATE INDEX IF NOT EXISTS idx_crashes_date  ON crashes (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_crashes_state ON crashes (report_state);

\echo 'Recreating authority_history indexes...'
CREATE INDEX IF NOT EXISTS idx_auth_history_dot    ON authority_history (dot_number);
CREATE INDEX IF NOT EXISTS idx_auth_history_docket ON authority_history (docket_number);

\echo 'Recreating insurance_history indexes...'
CREATE INDEX IF NOT EXISTS idx_ins_history_dot      ON insurance_history (dot_number);
CREATE INDEX IF NOT EXISTS idx_ins_history_docket   ON insurance_history (docket_number);
CREATE INDEX IF NOT EXISTS idx_ins_history_effective ON insurance_history (effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_ins_history_cancl    ON insurance_history (cancl_effective_date DESC);

\echo 'Aggregating inspection counts to carriers...'
UPDATE carriers c SET
    total_inspections = agg.cnt,
    vehicle_oos_rate = CASE WHEN agg.cnt > 0 THEN ROUND(agg.vehicle_oos::numeric / agg.cnt * 100, 1) ELSE 0 END,
    driver_oos_rate  = CASE WHEN agg.cnt > 0 THEN ROUND(agg.driver_oos::numeric / agg.cnt * 100, 1) ELSE 0 END,
    hazmat_oos_rate  = CASE WHEN agg.cnt > 0 THEN ROUND(agg.hazmat_oos::numeric / agg.cnt * 100, 1) ELSE 0 END
FROM (
    SELECT dot_number,
           COUNT(*)                                AS cnt,
           SUM(CASE WHEN vehicle_oos_total > 0 THEN 1 ELSE 0 END) AS vehicle_oos,
           SUM(CASE WHEN driver_oos_total > 0  THEN 1 ELSE 0 END) AS driver_oos,
           SUM(CASE WHEN hazmat_oos_total > 0  THEN 1 ELSE 0 END) AS hazmat_oos
    FROM inspections
    GROUP BY dot_number
) agg
WHERE c.dot_number = agg.dot_number;

\echo 'Aggregating crash counts to carriers...'
UPDATE carriers c SET
    total_crashes  = agg.cnt,
    fatal_crashes  = agg.fatal,
    injury_crashes = agg.injury,
    tow_crashes    = agg.tow
FROM (
    SELECT dot_number,
           COUNT(DISTINCT crash_id)                                        AS cnt,
           COUNT(DISTINCT crash_id) FILTER (WHERE fatalities > 0)          AS fatal,
           COUNT(DISTINCT crash_id) FILTER (WHERE injuries > 0)            AS injury,
           COUNT(DISTINCT crash_id) FILTER (WHERE tow_away > 0)            AS tow
    FROM crashes
    GROUP BY dot_number
) agg
WHERE c.dot_number = agg.dot_number;

\echo 'Re-enabling autovacuum...'
ALTER TABLE carriers           SET (autovacuum_enabled = true);
ALTER TABLE inspections        SET (autovacuum_enabled = true);
ALTER TABLE crashes            SET (autovacuum_enabled = true);
ALTER TABLE authority_history  SET (autovacuum_enabled = true);
ALTER TABLE insurance_history  SET (autovacuum_enabled = true);

\echo 'Resetting WAL settings...'
ALTER SYSTEM SET synchronous_commit = on;
ALTER SYSTEM SET wal_buffers = DEFAULT;
ALTER SYSTEM SET checkpoint_completion_target = DEFAULT;
ALTER SYSTEM SET max_wal_size = DEFAULT;
SELECT pg_reload_conf();

\echo 'Running VACUUM ANALYZE on heavy tables...'
VACUUM ANALYZE carriers;
VACUUM ANALYZE inspections;
VACUUM ANALYZE crashes;
VACUUM ANALYZE authority_history;
VACUUM ANALYZE insurance_history;

\echo 'Refreshing materialized views...'
REFRESH MATERIALIZED VIEW address_clusters;
REFRESH MATERIALIZED VIEW officer_carrier_counts;
REFRESH MATERIALIZED VIEW CONCURRENTLY insurance_company_stats;

\echo 'Post-ingest complete. Database ready.'
