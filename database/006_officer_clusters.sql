-- Officer identity resolution: cluster carriers by overlapping signals
-- (phone, email, address, co-officers) within each officer name.
-- Additive only — does not modify any existing tables.

CREATE TABLE IF NOT EXISTS officer_network_clusters (
    id SERIAL PRIMARY KEY,
    officer_name_normalized TEXT NOT NULL,
    cluster_index INTEGER NOT NULL,      -- 0, 1, 2... within this officer name
    member_dot_numbers INTEGER[] NOT NULL,
    carrier_count INTEGER NOT NULL,
    link_signals TEXT[] NOT NULL,         -- e.g. {'phone','address','co_officer'}
    total_crashes INTEGER DEFAULT 0,
    fatal_crashes INTEGER DEFAULT 0,
    total_units INTEGER DEFAULT 0,
    avg_risk_score REAL DEFAULT 0,
    ppp_total NUMERIC DEFAULT 0,
    states TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(officer_name_normalized, cluster_index)
);

CREATE INDEX IF NOT EXISTS idx_onc_officer ON officer_network_clusters (officer_name_normalized);
CREATE INDEX IF NOT EXISTS idx_onc_carrier_count ON officer_network_clusters (carrier_count DESC);
CREATE INDEX IF NOT EXISTS idx_onc_members ON officer_network_clusters USING GIN (member_dot_numbers);
