-- PPP Loan data table
CREATE TABLE IF NOT EXISTS ppp_loans (
    loan_id SERIAL PRIMARY KEY,
    borrower_name TEXT NOT NULL,
    borrower_address TEXT,
    borrower_city VARCHAR(100),
    borrower_state VARCHAR(2),
    borrower_zip VARCHAR(10),
    naics_code VARCHAR(10),
    loan_amount NUMERIC(12,2),
    forgiveness_amount NUMERIC(12,2),
    forgiveness_date DATE,
    loan_status TEXT,
    jobs_reported INTEGER DEFAULT 0,
    lender TEXT,
    date_approved DATE,
    -- Matching fields
    address_hash VARCHAR(16),
    name_hash VARCHAR(16),
    -- Link to carrier (populated by matching)
    matched_dot_number INTEGER REFERENCES carriers(dot_number),
    match_confidence VARCHAR(20), -- 'exact_address', 'name_fuzzy', 'address_only'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppp_loans_address_hash ON ppp_loans (address_hash);
CREATE INDEX IF NOT EXISTS idx_ppp_loans_name_hash ON ppp_loans (name_hash);
CREATE INDEX IF NOT EXISTS idx_ppp_loans_dot ON ppp_loans (matched_dot_number);
CREATE INDEX IF NOT EXISTS idx_ppp_loans_state ON ppp_loans (borrower_state);
CREATE INDEX IF NOT EXISTS idx_ppp_loans_borrower_name_trgm ON ppp_loans USING GIN (borrower_name gin_trgm_ops);

-- Risk score columns on carriers
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS risk_flags TEXT[] DEFAULT '{}';
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS ppp_loan_count INTEGER DEFAULT 0;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS ppp_loan_total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS ppp_forgiven_total NUMERIC(12,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_carriers_risk_score ON carriers (risk_score DESC);

-- Function to compute risk scores
CREATE OR REPLACE FUNCTION compute_risk_scores()
RETURNS void AS $$
BEGIN
    -- Reset scores
    UPDATE carriers SET risk_score = 0, risk_flags = '{}';

    -- Flag 1: Address overlap (5+ carriers = +20, 10+ = +35, 25+ = +50)
    UPDATE carriers c SET
        risk_score = risk_score + CASE
            WHEN ac.carrier_count >= 25 THEN 50
            WHEN ac.carrier_count >= 10 THEN 35
            WHEN ac.carrier_count >= 5 THEN 20
            ELSE 0
        END,
        risk_flags = array_append(risk_flags, 'ADDRESS_OVERLAP_' || ac.carrier_count)
    FROM address_clusters ac
    WHERE c.address_hash = ac.address_hash
      AND ac.carrier_count >= 5;

    -- Flag 2: New authority (less than 1 year old = +15)
    UPDATE carriers SET
        risk_score = risk_score + 15,
        risk_flags = array_append(risk_flags, 'NEW_AUTHORITY')
    WHERE authority_grant_date > CURRENT_DATE - INTERVAL '1 year'
      AND authority_grant_date IS NOT NULL;

    -- Flag 3: High crash rate (any fatal crash = +25, 3+ crashes = +15)
    UPDATE carriers SET
        risk_score = risk_score + 25,
        risk_flags = array_append(risk_flags, 'FATAL_CRASHES')
    WHERE fatal_crashes > 0;

    UPDATE carriers SET
        risk_score = risk_score + 15,
        risk_flags = array_append(risk_flags, 'HIGH_CRASH_COUNT')
    WHERE total_crashes >= 3 AND fatal_crashes = 0;

    -- Flag 4: High OOS rate (vehicle OOS > 30% = +20)
    UPDATE carriers SET
        risk_score = risk_score + 20,
        risk_flags = array_append(risk_flags, 'HIGH_VEHICLE_OOS')
    WHERE vehicle_oos_rate > 30 AND total_inspections > 0;

    -- Flag 5: Driver OOS > 20% = +15
    UPDATE carriers SET
        risk_score = risk_score + 15,
        risk_flags = array_append(risk_flags, 'HIGH_DRIVER_OOS')
    WHERE driver_oos_rate > 20 AND total_inspections > 0;

    -- Flag 6: Inactive/revoked with recent activity indicators
    UPDATE carriers SET
        risk_score = risk_score + 10,
        risk_flags = array_append(risk_flags, 'INACTIVE_STATUS')
    WHERE operating_status_code = 'I'
      AND address_hash IN (
          SELECT address_hash FROM address_clusters WHERE carrier_count >= 3
      );

    -- Flag 7: PPP loan received (+10), large PPP loan (+20)
    UPDATE carriers SET
        risk_score = risk_score + CASE
            WHEN ppp_loan_total > 100000 THEN 20
            WHEN ppp_loan_count > 0 THEN 10
            ELSE 0
        END,
        risk_flags = CASE
            WHEN ppp_loan_total > 100000 THEN array_append(risk_flags, 'LARGE_PPP_LOAN')
            WHEN ppp_loan_count > 0 THEN array_append(risk_flags, 'PPP_LOAN')
            ELSE risk_flags
        END
    WHERE ppp_loan_count > 0;

    -- Flag 8: PPP forgiven at address with multiple carriers
    UPDATE carriers SET
        risk_score = risk_score + 15,
        risk_flags = array_append(risk_flags, 'PPP_FORGIVEN_CLUSTER')
    WHERE ppp_forgiven_total > 0
      AND address_hash IN (
          SELECT address_hash FROM address_clusters WHERE carrier_count >= 3
      );

    -- Flag 9: PO Box address (+15) — carriers should have physical domicile
    UPDATE carriers SET
        risk_score = risk_score + 15,
        risk_flags = array_append(risk_flags, 'PO_BOX_ADDRESS')
    WHERE physical_address ILIKE '%P.O.%'
       OR physical_address ILIKE '%P O BOX%'
       OR physical_address ILIKE '%PO BOX%'
       OR physical_address ILIKE '%POB %'
       OR physical_address ILIKE '%P.O BOX%'
       OR physical_address ILIKE 'BOX %';

    -- Flag 10: No physical address at all (+10)
    UPDATE carriers SET
        risk_score = risk_score + 10,
        risk_flags = array_append(risk_flags, 'NO_PHYSICAL_ADDRESS')
    WHERE physical_address IS NULL OR TRIM(physical_address) = '';
END;
$$ LANGUAGE plpgsql;
