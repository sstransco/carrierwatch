-- 007_chameleons_rings_insurance.sql
-- Chameleon carrier detection, fraud ring detection, insurance company analysis

-- ============================================================
-- 1. Chameleon carrier pairs
-- ============================================================
CREATE TABLE IF NOT EXISTS chameleon_pairs (
    id serial PRIMARY KEY,
    predecessor_dot integer NOT NULL,
    successor_dot integer NOT NULL,
    deactivation_date date,
    activation_date date,
    days_gap integer,
    match_signals text[] NOT NULL DEFAULT '{}',
    signal_count integer NOT NULL DEFAULT 0,
    confidence text NOT NULL DEFAULT 'low',
    created_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chameleon_predecessor ON chameleon_pairs (predecessor_dot);
CREATE INDEX IF NOT EXISTS idx_chameleon_successor ON chameleon_pairs (successor_dot);
CREATE INDEX IF NOT EXISTS idx_chameleon_confidence ON chameleon_pairs (confidence);
CREATE INDEX IF NOT EXISTS idx_chameleon_signal_count ON chameleon_pairs (signal_count DESC);

-- ============================================================
-- 2. Fraud rings (connected components of carriers sharing 2+ officers)
-- ============================================================
CREATE TABLE IF NOT EXISTS fraud_rings (
    ring_id serial PRIMARY KEY,
    carrier_dots integer[] NOT NULL,
    officer_names text[] NOT NULL DEFAULT '{}',
    shared_addresses text[] NOT NULL DEFAULT '{}',
    carrier_count integer NOT NULL DEFAULT 0,
    active_count integer NOT NULL DEFAULT 0,
    total_crashes integer NOT NULL DEFAULT 0,
    total_fatalities integer NOT NULL DEFAULT 0,
    combined_risk integer NOT NULL DEFAULT 0,
    detection_signals text[] NOT NULL DEFAULT '{}',
    confidence text NOT NULL DEFAULT 'low',
    created_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_rings_confidence ON fraud_rings (confidence);
CREATE INDEX IF NOT EXISTS idx_fraud_rings_carrier_count ON fraud_rings (carrier_count DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_rings_combined_risk ON fraud_rings (combined_risk DESC);

-- ============================================================
-- 3. Insurance company stats (materialized view)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS insurance_company_stats AS
SELECT
    insurance_company,
    COUNT(DISTINCT ih.dot_number) AS carriers_insured,
    COUNT(*) AS total_policies,
    COUNT(*) FILTER (WHERE cancl_effective_date IS NOT NULL) AS cancellations,
    ROUND(
        COUNT(*) FILTER (WHERE cancl_effective_date IS NOT NULL)::numeric
        / NULLIF(COUNT(*), 0) * 100, 1
    ) AS cancellation_rate,
    COUNT(DISTINCT ih.dot_number) FILTER (
        WHERE c.risk_score IS NOT NULL AND c.risk_score >= 50
    ) AS high_risk_carriers,
    COALESCE(AVG(COALESCE(c.risk_score, 0)), 0)::integer AS avg_carrier_risk,
    COALESCE(SUM(COALESCE(c.total_crashes, 0)), 0)::integer AS total_crashes
FROM insurance_history ih
LEFT JOIN carriers c ON ih.dot_number = c.dot_number
WHERE insurance_company IS NOT NULL AND insurance_company != ''
GROUP BY insurance_company;

CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_company_stats_name
    ON insurance_company_stats (insurance_company);

-- ============================================================
-- 4. Peer benchmarking columns on carriers
-- ============================================================
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS fleet_size_bucket text;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS peer_crash_percentile real;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS peer_oos_percentile real;
