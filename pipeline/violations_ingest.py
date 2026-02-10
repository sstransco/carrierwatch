"""
CarrierWatch — Inspection Violations Detail Pipeline

Downloads per-violation records from DOT DataHub (876r-jsdb) and populates
the inspection_violations table. Also updates ELD/HOS violation counts on carriers.
"""
from __future__ import annotations

import csv
import logging
import re

import httpx
import psycopg2
from psycopg2.extras import execute_values

from config import DATA_DIR, DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

VIOLATIONS_URL = "https://datahub.transportation.gov/api/views/876r-jsdb/rows.csv?accessType=DOWNLOAD"
VIOLATIONS_FILE = "violations.csv"


def download_violations():
    """Download violations CSV."""
    path = DATA_DIR / VIOLATIONS_FILE
    if path.exists() and path.stat().st_size > 100 * 1024 * 1024:
        log.info("Violations CSV already at %s (%.0f MB)", path, path.stat().st_size / (1024 * 1024))
        return path

    log.info("Downloading violations dataset...")
    with httpx.Client(timeout=1200, follow_redirects=True) as client:
        with client.stream("GET", VIOLATIONS_URL) as resp:
            resp.raise_for_status()
            total = 0
            with open(path, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
                    total += len(chunk)
                    if total % (200 * 1024 * 1024) == 0:
                        log.info("  Downloaded %.0f MB...", total / (1024 * 1024))
    log.info("Downloaded violations: %.0f MB", path.stat().st_size / (1024 * 1024))
    return path


def parse_int(val):
    if not val:
        return None
    try:
        return int(float(val.strip().replace(",", "")))
    except (ValueError, TypeError):
        return None


def parse_violations(csv_path, conn):
    """Parse and bulk insert violation records."""
    log.info("Parsing violations from %s", csv_path)

    insert_sql = """
        INSERT INTO inspection_violations
            (inspection_id, dot_number, violation_code, violation_description,
             oos_indicator, violation_category, unit_type)
        VALUES %s
    """
    template = "(%s, %s, %s, %s, %s, %s, %s)"

    batch = []
    total = 0
    batch_size = 10000

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k.lower().strip() if k else "": v for k, v in raw_row.items()}

            insp_id = parse_int(row.get("inspection_id", ""))
            if not insp_id:
                continue

            # Build violation code from PART_NO + PART_NO_SECTION
            part_no = (row.get("part_no", "") or "").strip()
            part_section = (row.get("part_no_section", "") or "").strip()
            if not part_no:
                continue
            code = f"{part_no}.{part_section}" if part_section else part_no

            # No DOT_NUMBER in violations CSV — will be NULL (joined via inspection_id)
            dot = None

            desc = None  # No description column in this dataset
            oos = (row.get("out_of_service_indicator", "") or "").strip().upper() in ("Y", "YES", "TRUE", "1")

            # Categorize: ELD/HOS violations are 395.x
            category = None
            if code.startswith("395."):
                category = "ELD_HOS"
            elif code.startswith("393."):
                category = "VEHICLE"
            elif code.startswith("392."):
                category = "DRIVING"
            elif code.startswith("391."):
                category = "DRIVER_QUALIFICATION"
            elif code.startswith("390."):
                category = "GENERAL"
            elif code.startswith("397."):
                category = "HAZMAT"
            elif code.startswith("396."):
                category = "INSPECTION_REPAIR"
            elif code.startswith("383."):
                category = "CDL"

            unit = (row.get("insp_viol_unit", "") or "").strip()[:50] or None

            record = (insp_id, dot, code, desc, oos, category, unit)
            batch.append(record)
            total += 1

            if len(batch) >= batch_size:
                with conn.cursor() as cur:
                    execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                batch = []
                if total % 500000 == 0:
                    log.info("  Violations: %d records loaded...", total)

    if batch:
        with conn.cursor() as cur:
            execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
        conn.commit()

    log.info("Total violations loaded: %d", total)
    return total


def update_eld_hos_counts(conn):
    """Update ELD/HOS violation counts on carriers table."""
    log.info("Updating ELD/HOS violation counts on carriers...")
    with conn.cursor() as cur:
        # ELD violations (395.x codes)
        cur.execute("""
            UPDATE carriers c SET
                eld_violations = sub.cnt
            FROM (
                SELECT dot_number, COUNT(*) as cnt
                FROM inspection_violations
                WHERE violation_code LIKE '395.%%'
                GROUP BY dot_number
            ) sub
            WHERE c.dot_number = sub.dot_number
        """)
        eld_updated = cur.rowcount
        conn.commit()
        log.info("  ELD violations updated for %d carriers", eld_updated)

        # HOS violations (395.1x, 395.3x, 395.8x are key HOS codes)
        cur.execute("""
            UPDATE carriers c SET
                hos_violations = sub.cnt
            FROM (
                SELECT dot_number, COUNT(*) as cnt
                FROM inspection_violations
                WHERE violation_code LIKE '395.%%'
                  AND oos_indicator = TRUE
                GROUP BY dot_number
            ) sub
            WHERE c.dot_number = sub.dot_number
        """)
        hos_updated = cur.rowcount
        conn.commit()
        log.info("  HOS OOS violations updated for %d carriers", hos_updated)

        # Risk flag: 5+ ELD violations
        cur.execute("""
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 25,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'ELD_VIOLATIONS_5_PLUS')
            WHERE c.eld_violations >= 5
              AND NOT ('ELD_VIOLATIONS_5_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
        """)
        eld_flagged = cur.rowcount
        conn.commit()
        log.info("  Carriers flagged for 5+ ELD violations: %d", eld_flagged)


def main():
    log.info("=== CarrierWatch Violations Pipeline ===")

    csv_path = download_violations()

    conn = psycopg2.connect(DATABASE_URL)
    try:
        # Clear existing
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM inspection_violations")
            existing = cur.fetchone()[0]
            if existing > 0:
                log.info("Clearing %d existing violation records...", existing)
                cur.execute("TRUNCATE inspection_violations RESTART IDENTITY")
                conn.commit()

        count = parse_violations(csv_path, conn)
        log.info("Loaded %d violation records", count)

        # Backfill dot_number from inspections table
        log.info("Backfilling dot_number from inspections table...")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE inspection_violations iv SET
                    dot_number = i.dot_number
                FROM inspections i
                WHERE iv.inspection_id = i.inspection_id
                  AND iv.dot_number IS NULL
            """)
            backfilled = cur.rowcount
            conn.commit()
        log.info("  Backfilled dot_number for %d violation records", backfilled)

        # Stats
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(DISTINCT violation_code) FROM inspection_violations")
            unique_codes = cur.fetchone()[0]
            cur.execute("SELECT violation_category, COUNT(*) FROM inspection_violations WHERE violation_category IS NOT NULL GROUP BY violation_category ORDER BY COUNT(*) DESC")
            categories = cur.fetchall()

        log.info("Unique violation codes: %d", unique_codes)
        for cat, cnt in categories:
            log.info("  %s: %d violations", cat, cnt)

        # Update ELD/HOS counts
        update_eld_hos_counts(conn)

    finally:
        conn.close()

    log.info("=== Violations Pipeline complete ===")


if __name__ == "__main__":
    main()
