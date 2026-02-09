from __future__ import annotations

import os
from pathlib import Path

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://carrierwatch:carrierwatch_dev_2024@localhost:5432/carrierwatch",
)

DATA_DIR = Path(os.getenv("FMCSA_DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# DOT DataHub (Socrata) — new source for FMCSA census data
# Dataset: "Company Census File" — az4n-8mr2
# ~4.3M carrier records, updated daily, no API key required
DATAHUB_BULK_CSV_URL = "https://datahub.transportation.gov/api/views/az4n-8mr2/rows.csv?accessType=DOWNLOAD"
DATAHUB_SODA_URL = "https://datahub.transportation.gov/resource/az4n-8mr2.csv"
SODA_PAGE_SIZE = 50000

# Census Bureau Batch Geocoder
CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
GEOCODE_BATCH_SIZE = int(os.getenv("GEOCODE_BATCH_SIZE", "10000"))

# Column mapping: DataHub CSV column -> our DB column
CENSUS_COLUMN_MAP = {
    "dot_number": "dot_number",
    "docket1prefix": "mc_prefix",
    "docket1": "mc_number_raw",
    "legal_name": "legal_name",
    "dba_name": "dba_name",
    "carrier_operation": "carrier_operation",
    "hm_ind": "hm_flag",
    "phy_street": "physical_address",
    "phy_city": "physical_city",
    "phy_state": "physical_state",
    "phy_zip": "physical_zip",
    "phy_country": "physical_country",
    "carrier_mailing_street": "mailing_address",
    "carrier_mailing_city": "mailing_city",
    "carrier_mailing_state": "mailing_state",
    "carrier_mailing_zip": "mailing_zip",
    "carrier_mailing_country": "mailing_country",
    "phone": "phone",
    "power_units": "power_units",
    "total_drivers": "drivers",
    "classdef": "operating_status",
    "status_code": "operating_status_code",
    "review_date": "authority_grant_date",
    "safety_rating": "safety_rating",
    "safety_rating_date": "safety_rating_date",
    "review_type": "safety_review_type",
    "total_cdl": "total_cdl",
}
