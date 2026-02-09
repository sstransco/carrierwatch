-- Extended datasets: Inspections, Crashes, Authority History, Insurance History

-- ==========================================
-- INSPECTIONS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS inspections (
    inspection_id BIGINT PRIMARY KEY,
    dot_number INTEGER REFERENCES carriers(dot_number),
    report_state VARCHAR(2),
    report_number VARCHAR(20),
    insp_date DATE,
    insp_level_id INTEGER,
    insp_level_desc TEXT,
    location_desc TEXT,
    county_code VARCHAR(10),
    post_acc_ind VARCHAR(1),
    viol_total INTEGER DEFAULT 0,
    oos_total INTEGER DEFAULT 0,
    driver_viol_total INTEGER DEFAULT 0,
    driver_oos_total INTEGER DEFAULT 0,
    vehicle_viol_total INTEGER DEFAULT 0,
    vehicle_oos_total INTEGER DEFAULT 0,
    hazmat_viol_total INTEGER DEFAULT 0,
    hazmat_oos_total INTEGER DEFAULT 0,
    insp_carrier_name TEXT,
    insp_carrier_state VARCHAR(2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspections_dot ON inspections (dot_number);
CREATE INDEX IF NOT EXISTS idx_inspections_date ON inspections (insp_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_state ON inspections (report_state);

-- ==========================================
-- CRASHES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS crashes (
    crash_id BIGINT,
    report_seq_no INTEGER DEFAULT 1,
    dot_number INTEGER REFERENCES carriers(dot_number),
    report_state VARCHAR(2),
    report_date DATE,
    location TEXT,
    city TEXT,
    state VARCHAR(2),
    fatalities INTEGER DEFAULT 0,
    injuries INTEGER DEFAULT 0,
    tow_away INTEGER DEFAULT 0,
    hazmat_released VARCHAR(1),
    federal_recordable VARCHAR(1),
    vehicle_id_number TEXT,
    vehicle_license_number TEXT,
    cargo_body_type_id TEXT,
    crash_carrier_name TEXT,
    crash_carrier_state VARCHAR(2),
    weather_condition_id TEXT,
    light_condition_id TEXT,
    road_surface_condition_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (crash_id, report_seq_no)
);

CREATE INDEX IF NOT EXISTS idx_crashes_dot ON crashes (dot_number);
CREATE INDEX IF NOT EXISTS idx_crashes_date ON crashes (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_crashes_state ON crashes (report_state);

-- ==========================================
-- AUTHORITY HISTORY TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS authority_history (
    id SERIAL PRIMARY KEY,
    dot_number INTEGER,
    docket_number TEXT,
    legal_name TEXT,
    dba_name TEXT,
    common_stat VARCHAR(5),
    contract_stat VARCHAR(5),
    broker_stat VARCHAR(5),
    common_app_pend VARCHAR(5),
    contract_app_pend VARCHAR(5),
    broker_app_pend VARCHAR(5),
    common_rev_pend VARCHAR(5),
    contract_rev_pend VARCHAR(5),
    broker_rev_pend VARCHAR(5),
    property_chk VARCHAR(5),
    passenger_chk VARCHAR(5),
    hhg_chk VARCHAR(5),
    private_auth_chk VARCHAR(5),
    enterprise_chk VARCHAR(5),
    bus_street TEXT,
    bus_city VARCHAR(100),
    bus_state VARCHAR(2),
    bus_zip VARCHAR(10),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_history_dot ON authority_history (dot_number);
CREATE INDEX IF NOT EXISTS idx_auth_history_docket ON authority_history (docket_number);

-- ==========================================
-- INSURANCE HISTORY TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS insurance_history (
    id SERIAL PRIMARY KEY,
    dot_number INTEGER,
    docket_number TEXT,
    ins_form_code VARCHAR(10),
    ins_cancl_form VARCHAR(10),
    policy_no TEXT,
    min_cov_amount NUMERIC(12,2),
    ins_class_code VARCHAR(10),
    effective_date DATE,
    cancl_effective_date DATE,
    cancl_method VARCHAR(5),
    insurance_company TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_history_dot ON insurance_history (dot_number);
CREATE INDEX IF NOT EXISTS idx_ins_history_docket ON insurance_history (docket_number);
CREATE INDEX IF NOT EXISTS idx_ins_history_effective ON insurance_history (effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_ins_history_cancl ON insurance_history (cancl_effective_date DESC);
