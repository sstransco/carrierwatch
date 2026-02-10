"""
CarrierWatch Data Ingestion Pipeline

Downloads FMCSA census data from DOT DataHub (Socrata),
parses it, normalizes addresses, and bulk-loads into PostGIS.
"""
from __future__ import annotations

import csv
import hashlib
import io
import logging
import re
from pathlib import Path

import httpx
import psycopg2
from psycopg2.extras import execute_values

from config import (
    CENSUS_COLUMN_MAP,
    DATA_DIR,
    DATABASE_URL,
    DATAHUB_BULK_CSV_URL,
    DATAHUB_SODA_URL,
    SODA_PAGE_SIZE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# Address normalization patterns
STREET_ABBREVS = {
    r"\bSTREET\b": "ST",
    r"\bAVENUE\b": "AVE",
    r"\bAV\b": "AVE",
    r"\bBOULEVARD\b": "BLVD",
    r"\bDRIVE\b": "DR",
    r"\bLANE\b": "LN",
    r"\bROAD\b": "RD",
    r"\bCOURT\b": "CT",
    r"\bPLACE\b": "PL",
    r"\bCIRCLE\b": "CIR",
    r"\bPARKWAY\b": "PKWY",
    r"\bHIGHWAY\b": "HWY",
    r"\bNORTH\b": "N",
    r"\bSOUTH\b": "S",
    r"\bEAST\b": "E",
    r"\bWEST\b": "W",
}

# Regex to strip suite/apt/unit/floor/bldg suffixes for address grouping
_UNIT_RE = re.compile(
    r"\b(STE|SUITE|SUIT|APT|APARTMENT|UNIT|BLDG|BUILDING|FL|FLOOR|RM|ROOM|SP|SPC|SPACE|LOT|DEPT|#)\s*\S*.*$",
    re.IGNORECASE,
)


def normalize_address(address: str, city: str, state: str, zip_code: str) -> str:
    if not address:
        return ""
    addr = address.upper().strip()
    addr = re.sub(r"[.,#]", "", addr)
    # Strip unit/suite/apt suffixes so all units at same building share a hash
    addr = _UNIT_RE.sub("", addr)
    for pattern, replacement in STREET_ABBREVS.items():
        addr = re.sub(pattern, replacement, addr)
    addr = re.sub(r"\s+", " ", addr).strip()
    city = (city or "").upper().strip()
    state = (state or "").upper().strip()
    zip5 = (zip_code or "")[:5].strip()
    return "%s|%s|%s|%s" % (addr, city, state, zip5)


def make_address_hash(address: str, city: str, state: str, zip_code: str) -> str | None:
    normalized = normalize_address(address, city, state, zip_code)
    if not normalized or normalized == "|||":
        return None
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def parse_int(val: str) -> int:
    if not val or not val.strip():
        return 0
    try:
        return int(val.strip().replace(",", ""))
    except ValueError:
        return 0


def parse_date(val: str) -> str | None:
    """Parse date. DataHub uses YYYYMMDD format."""
    if not val or not val.strip():
        return None
    val = val.strip()
    # YYYYMMDD format (DataHub)
    if len(val) >= 8 and val[:8].isdigit():
        y, m, d = val[:4], val[4:6], val[6:8]
        if 1900 <= int(y) <= 2100 and 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            return "%s-%s-%s" % (y, m, d)
    # MM/DD/YYYY format (legacy)
    parts = val.split("/")
    if len(parts) == 3:
        try:
            return "%s-%s-%s" % (parts[2], parts[0].zfill(2), parts[1].zfill(2))
        except (ValueError, IndexError):
            pass
    # Already ISO
    if re.match(r"\d{4}-\d{2}-\d{2}", val):
        return val[:10]
    return None


def download_csv() -> Path:
    """Download FMCSA census CSV from DOT DataHub."""
    csv_path = DATA_DIR / "census.csv"
    if csv_path.exists():
        size_mb = csv_path.stat().st_size / (1024 * 1024)
        if size_mb > 100:
            log.info("Census CSV already downloaded (%.0f MB) at %s", size_mb, csv_path)
            return csv_path
        log.info("Existing CSV is small (%.0f MB), re-downloading...", size_mb)

    log.info("Downloading FMCSA Census data from DOT DataHub...")
    log.info("URL: %s", DATAHUB_BULK_CSV_URL)
    log.info("This is ~500MB and may take a few minutes...")

    with httpx.Client(timeout=600, follow_redirects=True) as client:
        with client.stream("GET", DATAHUB_BULK_CSV_URL) as resp:
            resp.raise_for_status()
            total = 0
            with open(csv_path, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
                    total += len(chunk)
                    if total % (50 * 1024 * 1024) == 0 or total == len(chunk):
                        log.info("  Downloaded %.0f MB...", total / (1024 * 1024))

    size_mb = csv_path.stat().st_size / (1024 * 1024)
    log.info("Download complete: %.0f MB", size_mb)
    return csv_path


def parse_row(row: dict) -> dict | None:
    """Parse a single CSV row into a carrier record."""
    dot_str = row.get("dot_number", "").strip()
    if not dot_str:
        return None
    try:
        dot_number = int(dot_str)
    except ValueError:
        return None

    record = {"dot_number": dot_number}

    # Map fields
    record["legal_name"] = row.get("legal_name", "").strip() or None
    record["dba_name"] = row.get("dba_name", "").strip() or None

    # Build MC number from prefix + number
    mc_prefix = row.get("docket1prefix", "").strip()
    mc_num = row.get("docket1", "").strip()
    if mc_prefix and mc_num:
        record["mc_number"] = mc_num
    else:
        record["mc_number"] = None

    record["carrier_operation"] = row.get("carrier_operation", "").strip() or None
    record["hm_flag"] = row.get("hm_ind", "").strip() or None
    record["pc_flag"] = None  # not directly in DataHub

    # Physical address
    record["physical_address"] = row.get("phy_street", "").strip() or None
    record["physical_city"] = row.get("phy_city", "").strip() or None
    record["physical_state"] = row.get("phy_state", "").strip() or None
    record["physical_zip"] = row.get("phy_zip", "").strip() or None
    record["physical_country"] = row.get("phy_country", "").strip() or "US"

    # Mailing address
    record["mailing_address"] = row.get("carrier_mailing_street", "").strip() or None
    record["mailing_city"] = row.get("carrier_mailing_city", "").strip() or None
    record["mailing_state"] = row.get("carrier_mailing_state", "").strip() or None
    record["mailing_zip"] = row.get("carrier_mailing_zip", "").strip() or None
    record["mailing_country"] = row.get("carrier_mailing_country", "").strip() or "US"

    record["phone"] = row.get("phone", "").strip() or None

    # Numeric fields
    record["power_units"] = parse_int(row.get("power_units", ""))
    record["drivers"] = parse_int(row.get("total_drivers", ""))

    # Status — classdef has the full text, status_code is the letter code
    record["operating_status"] = row.get("classdef", "").strip() or None
    record["operating_status_code"] = row.get("status_code", "").strip() or None

    # Dates
    record["authority_grant_date"] = parse_date(row.get("review_date", ""))
    record["authority_status"] = None
    record["common_authority"] = None
    record["contract_authority"] = None
    record["broker_authority"] = None

    # Safety
    record["safety_rating"] = row.get("safety_rating", "").strip() or None
    record["safety_rating_date"] = parse_date(row.get("safety_rating_date", ""))
    record["safety_review_date"] = None
    record["safety_review_type"] = row.get("review_type", "").strip() or None

    # Insurance (not directly in DataHub census, set to 0)
    record["insurance_bipd_on_file"] = 0
    record["insurance_bipd_required"] = 0
    record["insurance_bond_on_file"] = 0
    record["insurance_bond_required"] = 0

    # Address hash
    record["address_hash"] = make_address_hash(
        record.get("physical_address") or "",
        record.get("physical_city") or "",
        record.get("physical_state") or "",
        record.get("physical_zip") or "",
    )

    if not record["legal_name"]:
        return None

    return record


def parse_csv(csv_path: Path):
    """Parse the CSV and yield carrier records."""
    log.info("Parsing CSV: %s", csv_path)
    count = 0
    skipped = 0
    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            # Normalize column names to lowercase
            row = {k.lower().strip(): v for k, v in raw_row.items()}
            record = parse_row(row)
            if record:
                count += 1
                yield record
                if count % 200000 == 0:
                    log.info("Parsed %d records...", count)
            else:
                skipped += 1

    log.info("Total records parsed: %d (skipped: %d)", count, skipped)


DB_COLUMNS = [
    "dot_number", "mc_number", "legal_name", "dba_name",
    "carrier_operation", "hm_flag", "pc_flag",
    "physical_address", "physical_city", "physical_state", "physical_zip", "physical_country",
    "mailing_address", "mailing_city", "mailing_state", "mailing_zip", "mailing_country",
    "phone", "power_units", "drivers",
    "operating_status", "operating_status_code",
    "authority_grant_date", "authority_status",
    "common_authority", "contract_authority", "broker_authority",
    "safety_rating", "safety_rating_date", "safety_review_date", "safety_review_type",
    "insurance_bipd_on_file", "insurance_bipd_required",
    "insurance_bond_on_file", "insurance_bond_required",
    "address_hash",
]


def bulk_insert(records, conn):
    """Bulk insert carrier records using execute_values with upsert."""
    columns_sql = ", ".join(DB_COLUMNS)
    update_parts = []
    for c in DB_COLUMNS:
        if c != "dot_number":
            update_parts.append("{col} = EXCLUDED.{col}".format(col=c))
    update_cols = ", ".join(update_parts)

    insert_sql = (
        "INSERT INTO carriers ({cols}) VALUES %s "
        "ON CONFLICT (dot_number) DO UPDATE SET {updates}, updated_at = NOW()"
    ).format(cols=columns_sql, updates=update_cols)

    template = "(" + ", ".join(["%s"] * len(DB_COLUMNS)) + ")"

    batch = []
    total = 0
    batch_size = 5000

    with conn.cursor() as cur:
        for record in records:
            row = tuple(record.get(c) for c in DB_COLUMNS)
            batch.append(row)

            if len(batch) >= batch_size:
                execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                total += len(batch)
                log.info("Inserted %d records (total: %d)", len(batch), total)
                batch = []

        if batch:
            execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
            conn.commit()
            total += len(batch)
            log.info("Inserted final %d records (total: %d)", len(batch), total)

    return total


def refresh_materialized_views(conn):
    log.info("Refreshing address_clusters materialized view...")
    with conn.cursor() as cur:
        cur.execute("REFRESH MATERIALIZED VIEW address_clusters;")
    conn.commit()
    log.info("Materialized view refreshed.")


def get_stats(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM carriers;")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM carriers WHERE location IS NOT NULL;")
        geocoded = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM address_clusters;")
        clusters = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM address_clusters WHERE carrier_count >= 5;")
        flagged = cur.fetchone()[0]

    log.info("=== Database Stats ===")
    log.info("Total carriers: %d", total)
    log.info("Geocoded: %d", geocoded)
    log.info("Address clusters (2+ carriers): %d", clusters)
    log.info("Flagged addresses (5+ carriers): %d", flagged)


def main():
    log.info("=== CarrierWatch Data Pipeline ===")

    # Step 1: Download
    csv_path = download_csv()

    # Step 2: Parse and load
    conn = psycopg2.connect(DATABASE_URL)
    try:
        records = parse_csv(csv_path)
        total = bulk_insert(records, conn)
        log.info("Loaded %d carriers into database.", total)

        # Step 3: Refresh materialized views
        refresh_materialized_views(conn)

        # Step 4: Stats
        get_stats(conn)
    finally:
        conn.close()

    log.info("=== Pipeline complete ===")
    log.info("Next step: Run geocoding with `python3 geocode.py`")


if __name__ == "__main__":
    main()
