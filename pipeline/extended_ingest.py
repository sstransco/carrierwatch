"""
CarrierWatch Extended Dataset Ingestion Pipeline

Downloads and ingests:
- Vehicle Inspections (8M+ records)
- Crash Records (4.9M+ records)
- Authority History (1.8M+ records)
- Insurance History (7.3M+ records)
"""
from __future__ import annotations

import csv
import logging
import re
from pathlib import Path

import httpx
import psycopg2
from psycopg2.extras import execute_values

from config import DATA_DIR, DATABASE_URL

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# Dataset URLs from DOT DataHub
DATASETS = {
    "inspections": {
        "url": "https://datahub.transportation.gov/api/views/fx4q-ay7w/rows.csv?accessType=DOWNLOAD",
        "file": "inspections.csv",
        "label": "Vehicle Inspections",
    },
    "crashes": {
        "url": "https://datahub.transportation.gov/api/views/aayw-vxb3/rows.csv?accessType=DOWNLOAD",
        "file": "crashes.csv",
        "label": "Crash Records",
    },
    "authority": {
        "url": "https://datahub.transportation.gov/api/views/6eyk-hxee/rows.csv?accessType=DOWNLOAD",
        "file": "authority_history.csv",
        "label": "Authority History",
    },
    "insurance": {
        "url": "https://datahub.transportation.gov/api/views/6sqe-dvqs/rows.csv?accessType=DOWNLOAD",
        "file": "insurance_history.csv",
        "label": "Insurance History",
    },
}


def download_dataset(key):
    """Download a dataset CSV from DataHub."""
    ds = DATASETS[key]
    path = DATA_DIR / ds["file"]

    if path.exists() and path.stat().st_size > 1024 * 1024:
        log.info("%s already downloaded at %s (%.0f MB)",
                 ds["label"], path, path.stat().st_size / (1024 * 1024))
        return path

    log.info("Downloading %s...", ds["label"])
    try:
        with httpx.Client(timeout=1200, follow_redirects=True) as client:
            with client.stream("GET", ds["url"]) as resp:
                resp.raise_for_status()
                total = 0
                with open(path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                        f.write(chunk)
                        total += len(chunk)
                        if total % (200 * 1024 * 1024) == 0:
                            log.info("  Downloaded %.0f MB...", total / (1024 * 1024))
        log.info("Downloaded %s: %.0f MB", ds["label"], path.stat().st_size / (1024 * 1024))
        return path
    except Exception as e:
        log.error("Failed to download %s: %s", ds["label"], e)
        return None


def parse_int(val):
    if not val:
        return None
    try:
        return int(float(val.strip().replace(",", "")))
    except (ValueError, TypeError):
        return None


def parse_date(val):
    if not val or not val.strip():
        return None
    val = val.strip()
    # Try MM/DD/YYYY
    parts = val.split("/")
    if len(parts) == 3:
        try:
            return "%s-%s-%s" % (parts[2][:4], parts[0].zfill(2), parts[1].zfill(2))
        except (ValueError, IndexError):
            pass
    # Try YYYYMMDD
    if re.match(r"^\d{8}$", val):
        return "%s-%s-%s" % (val[:4], val[4:6], val[6:8])
    # Try YYYY-MM-DD
    if re.match(r"\d{4}-\d{2}-\d{2}", val):
        return val[:10]
    return None


def parse_decimal(val):
    if not val:
        return None
    try:
        return float(val.strip().replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return None


# ==========================================
# INSPECTIONS
# ==========================================

INSP_COLUMNS = [
    "inspection_id", "dot_number", "report_state", "report_number",
    "insp_date", "insp_level_id", "location_desc", "county_code",
    "post_acc_ind", "viol_total", "oos_total", "driver_viol_total",
    "driver_oos_total", "vehicle_viol_total", "vehicle_oos_total",
    "hazmat_viol_total", "hazmat_oos_total", "insp_carrier_name",
    "insp_carrier_state",
]


def parse_inspections(csv_path, conn):
    """Parse and bulk insert inspection records."""
    log.info("Parsing inspections from %s", csv_path)

    columns_sql = ", ".join(INSP_COLUMNS)
    insert_sql = "INSERT INTO inspections ({cols}) VALUES %s ON CONFLICT (inspection_id) DO NOTHING".format(cols=columns_sql)
    template = "(" + ", ".join(["%s"] * len(INSP_COLUMNS)) + ")"

    batch = []
    total = 0
    batch_size = 10000

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k.lower().strip() if k else "": v for k, v in raw_row.items()}

            dot = parse_int(row.get("dot_number", ""))
            if not dot:
                continue

            insp_id = parse_int(row.get("inspection_id", row.get("insp_id", "")))
            if not insp_id:
                continue

            record = (
                insp_id,
                dot,
                (row.get("report_state", "") or "")[:2] or None,
                (row.get("report_number", "") or "")[:20] or None,
                parse_date(row.get("insp_date", "")),
                parse_int(row.get("insp_level_id", "")),
                (row.get("location_desc", row.get("location", "")) or "")[:500] or None,
                (row.get("county_code", "") or "")[:10] or None,
                (row.get("post_acc_ind", "") or "")[:1] or None,
                parse_int(row.get("viol_total", "")) or 0,
                parse_int(row.get("oos_total", "")) or 0,
                parse_int(row.get("driver_viol_total", "")) or 0,
                parse_int(row.get("driver_oos_total", "")) or 0,
                parse_int(row.get("vehicle_viol_total", "")) or 0,
                parse_int(row.get("vehicle_oos_total", "")) or 0,
                parse_int(row.get("hazmat_viol_total", "")) or 0,
                parse_int(row.get("hazmat_oos_total", "")) or 0,
                (row.get("insp_carrier_name", "") or "")[:500] or None,
                (row.get("insp_carrier_state", "") or "")[:2] or None,
            )

            batch.append(record)
            total += 1

            if len(batch) >= batch_size:
                with conn.cursor() as cur:
                    execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                batch = []
                if total % 500000 == 0:
                    log.info("  Inspections: %d records loaded...", total)

    if batch:
        with conn.cursor() as cur:
            execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
        conn.commit()

    log.info("Total inspections loaded: %d", total)
    return total


# ==========================================
# CRASHES
# ==========================================

CRASH_COLUMNS = [
    "crash_id", "report_seq_no", "dot_number", "report_state", "report_date",
    "location", "city", "state", "fatalities", "injuries", "tow_away",
    "hazmat_released", "federal_recordable", "vehicle_id_number",
    "vehicle_license_number", "cargo_body_type_id", "crash_carrier_name",
    "crash_carrier_state", "weather_condition_id", "light_condition_id",
    "road_surface_condition_id",
]


def parse_crashes(csv_path, conn):
    """Parse and bulk insert crash records."""
    log.info("Parsing crashes from %s", csv_path)

    columns_sql = ", ".join(CRASH_COLUMNS)
    insert_sql = "INSERT INTO crashes ({cols}) VALUES %s ON CONFLICT (crash_id, report_seq_no) DO NOTHING".format(cols=columns_sql)
    template = "(" + ", ".join(["%s"] * len(CRASH_COLUMNS)) + ")"

    batch = []
    total = 0
    batch_size = 10000

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k.lower().strip() if k else "": v for k, v in raw_row.items()}

            dot = parse_int(row.get("dot_number", ""))
            if not dot:
                continue

            crash_id = parse_int(row.get("crash_id", ""))
            if not crash_id:
                continue

            record = (
                crash_id,
                parse_int(row.get("report_seq_no", "")) or 1,
                dot,
                (row.get("report_state", "") or "")[:2] or None,
                parse_date(row.get("report_date", "")),
                (row.get("location", "") or "")[:500] or None,
                (row.get("city", "") or "")[:200] or None,
                (row.get("state", "") or "")[:2] or None,
                parse_int(row.get("fatalities", "")) or 0,
                parse_int(row.get("injuries", "")) or 0,
                parse_int(row.get("tow_away", row.get("towaway", ""))) or 0,
                (row.get("hazmat_released", "") or "")[:1] or None,
                (row.get("federal_recordable", "") or "")[:1] or None,
                (row.get("vehicle_identification_number", row.get("vehicle_id_number", "")) or "")[:50] or None,
                (row.get("vehicle_license_number", "") or "")[:20] or None,
                (row.get("cargo_body_type_id", "") or "")[:10] or None,
                (row.get("crash_carrier_name", "") or "")[:500] or None,
                (row.get("crash_carrier_state", "") or "")[:2] or None,
                (row.get("weather_condition_id", "") or "")[:10] or None,
                (row.get("light_condition_id", "") or "")[:10] or None,
                (row.get("road_surface_condition_id", "") or "")[:10] or None,
            )

            batch.append(record)
            total += 1

            if len(batch) >= batch_size:
                with conn.cursor() as cur:
                    execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                batch = []
                if total % 500000 == 0:
                    log.info("  Crashes: %d records loaded...", total)

    if batch:
        with conn.cursor() as cur:
            execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
        conn.commit()

    log.info("Total crashes loaded: %d", total)
    return total


# ==========================================
# AUTHORITY HISTORY
# ==========================================

AUTH_COLUMNS = [
    "dot_number", "docket_number", "legal_name", "dba_name",
    "common_stat", "contract_stat", "broker_stat",
    "common_app_pend", "contract_app_pend", "broker_app_pend",
    "common_rev_pend", "contract_rev_pend", "broker_rev_pend",
    "property_chk", "passenger_chk", "hhg_chk", "private_auth_chk",
    "enterprise_chk", "bus_street", "bus_city", "bus_state", "bus_zip",
]


def parse_authority(csv_path, conn):
    """Parse and bulk insert authority history records."""
    log.info("Parsing authority history from %s", csv_path)

    columns_sql = ", ".join(AUTH_COLUMNS)
    insert_sql = "INSERT INTO authority_history ({cols}) VALUES %s".format(cols=columns_sql)
    template = "(" + ", ".join(["%s"] * len(AUTH_COLUMNS)) + ")"

    batch = []
    total = 0
    batch_size = 10000

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k.lower().strip() if k else "": v for k, v in raw_row.items()}

            dot = parse_int(row.get("dot_number", ""))

            record = (
                dot,
                (row.get("docket_number", row.get("docket", "")) or "")[:50] or None,
                (row.get("legal_name", "") or "")[:500] or None,
                (row.get("dba_name", "") or "")[:500] or None,
                (row.get("common_stat", "") or "")[:5] or None,
                (row.get("contract_stat", "") or "")[:5] or None,
                (row.get("broker_stat", "") or "")[:5] or None,
                (row.get("common_app_pend", "") or "")[:5] or None,
                (row.get("contract_app_pend", "") or "")[:5] or None,
                (row.get("broker_app_pend", "") or "")[:5] or None,
                (row.get("common_rev_pend", "") or "")[:5] or None,
                (row.get("contract_rev_pend", "") or "")[:5] or None,
                (row.get("broker_rev_pend", "") or "")[:5] or None,
                (row.get("property_chk", "") or "")[:5] or None,
                (row.get("passenger_chk", "") or "")[:5] or None,
                (row.get("hhg_chk", "") or "")[:5] or None,
                (row.get("private_auth_chk", "") or "")[:5] or None,
                (row.get("enterprise_chk", "") or "")[:5] or None,
                (row.get("bus_street_po", row.get("bus_street", "")) or "")[:500] or None,
                (row.get("bus_city", "") or "")[:100] or None,
                (row.get("bus_state_code", row.get("bus_state", "")) or "")[:2] or None,
                (row.get("bus_zip_code", row.get("bus_zip", "")) or "")[:10] or None,
            )

            batch.append(record)
            total += 1

            if len(batch) >= batch_size:
                with conn.cursor() as cur:
                    execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                batch = []
                if total % 500000 == 0:
                    log.info("  Authority: %d records loaded...", total)

    if batch:
        with conn.cursor() as cur:
            execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
        conn.commit()

    log.info("Total authority records loaded: %d", total)
    return total


# ==========================================
# INSURANCE HISTORY
# ==========================================

INS_COLUMNS = [
    "dot_number", "docket_number", "ins_form_code", "ins_cancl_form",
    "policy_no", "min_cov_amount", "ins_class_code", "effective_date",
    "cancl_effective_date", "cancl_method", "insurance_company",
]


def parse_insurance(csv_path, conn):
    """Parse and bulk insert insurance history records."""
    log.info("Parsing insurance history from %s", csv_path)

    columns_sql = ", ".join(INS_COLUMNS)
    insert_sql = "INSERT INTO insurance_history ({cols}) VALUES %s".format(cols=columns_sql)
    template = "(" + ", ".join(["%s"] * len(INS_COLUMNS)) + ")"

    batch = []
    total = 0
    batch_size = 10000

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k.lower().strip() if k else "": v for k, v in raw_row.items()}

            dot = parse_int(row.get("dot_number", ""))

            record = (
                dot,
                (row.get("docket_number", "") or "")[:50] or None,
                (row.get("ins_form_code", "") or "")[:10] or None,
                (row.get("ins_cancl_form", "") or "")[:10] or None,
                (row.get("policy_no", "") or "")[:100] or None,
                parse_decimal(row.get("min_cov_amount", "")),
                (row.get("ins_class_code", "") or "")[:10] or None,
                parse_date(row.get("effective_date", "")),
                parse_date(row.get("cancl_effective_date", "")),
                (row.get("cancl_method", "") or "")[:5] or None,
                (row.get("name_company", row.get("insurance_company", "")) or "")[:500] or None,
            )

            batch.append(record)
            total += 1

            if len(batch) >= batch_size:
                with conn.cursor() as cur:
                    execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                batch = []
                if total % 500000 == 0:
                    log.info("  Insurance: %d records loaded...", total)

    if batch:
        with conn.cursor() as cur:
            execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
        conn.commit()

    log.info("Total insurance records loaded: %d", total)
    return total


# ==========================================
# MAIN
# ==========================================

def main():
    import sys

    log.info("=== CarrierWatch Extended Dataset Pipeline ===")

    # Allow selecting specific datasets via command line
    targets = sys.argv[1:] if len(sys.argv) > 1 else ["inspections", "crashes", "authority", "insurance"]

    conn = psycopg2.connect(DATABASE_URL)

    try:
        for target in targets:
            if target not in DATASETS:
                log.warning("Unknown dataset: %s", target)
                continue

            log.info("--- Processing: %s ---", DATASETS[target]["label"])

            # Download
            csv_path = download_dataset(target)
            if not csv_path or not csv_path.exists():
                log.error("Skipping %s — download failed", target)
                continue

            # Clear existing data for this dataset
            table_map = {
                "inspections": "inspections",
                "crashes": "crashes",
                "authority": "authority_history",
                "insurance": "insurance_history",
            }
            table = table_map[target]
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM %s" % table)
                existing = cur.fetchone()[0]
                if existing > 0:
                    log.info("Clearing %d existing %s records...", existing, target)
                    cur.execute("TRUNCATE %s RESTART IDENTITY CASCADE" % table)
                    conn.commit()

            # Parse and load
            parser_map = {
                "inspections": parse_inspections,
                "crashes": parse_crashes,
                "authority": parse_authority,
                "insurance": parse_insurance,
            }
            count = parser_map[target](csv_path, conn)
            log.info("Loaded %d %s records", count, target)

        # Update risk flags based on new data
        log.info("Updating insurance-based risk flags...")
        with conn.cursor() as cur:
            # Flag carriers with cancelled/lapsed insurance
            cur.execute("""
                UPDATE carriers c SET
                    risk_score = risk_score + 20,
                    risk_flags = array_append(risk_flags, 'INSURANCE_LAPSE')
                WHERE c.dot_number IN (
                    SELECT DISTINCT ih.dot_number
                    FROM insurance_history ih
                    WHERE ih.cancl_effective_date IS NOT NULL
                      AND ih.cancl_effective_date < CURRENT_DATE
                      AND ih.dot_number NOT IN (
                          SELECT dot_number FROM insurance_history
                          WHERE effective_date > ih.cancl_effective_date
                            AND cancl_effective_date IS NULL
                      )
                )
                AND NOT ('INSURANCE_LAPSE' = ANY(c.risk_flags))
            """)
            ins_flagged = cur.rowcount
            conn.commit()
            log.info("  Carriers flagged for insurance lapse: %d", ins_flagged)

            # Flag carriers with revoked then reissued authority
            cur.execute("""
                UPDATE carriers c SET
                    risk_score = risk_score + 15,
                    risk_flags = array_append(risk_flags, 'AUTHORITY_REVOKED_REISSUED')
                WHERE c.dot_number IN (
                    SELECT dot_number FROM authority_history
                    WHERE common_rev_pend = 'Y' OR contract_rev_pend = 'Y' OR broker_rev_pend = 'Y'
                )
                AND NOT ('AUTHORITY_REVOKED_REISSUED' = ANY(c.risk_flags))
            """)
            auth_flagged = cur.rowcount
            conn.commit()
            log.info("  Carriers flagged for authority revocation: %d", auth_flagged)

        # Final stats
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM inspections")
            insp_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM crashes")
            crash_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM authority_history")
            auth_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM insurance_history")
            ins_count = cur.fetchone()[0]

        log.info("=== Extended Pipeline Stats ===")
        log.info("Inspections: %d", insp_count)
        log.info("Crashes: %d", crash_count)
        log.info("Authority History: %d", auth_count)
        log.info("Insurance History: %d", ins_count)

    finally:
        conn.close()

    log.info("=== Extended Pipeline complete ===")


if __name__ == "__main__":
    main()
