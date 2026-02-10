"""
CarrierWatch — Extract Company Officers/Principals from FMCSA Census CSV.

Reads the already-downloaded census CSV and populates carrier_principals table.
Also updates risk scores for officers linked to many carriers.
"""
from __future__ import annotations

import csv
import logging
import re

import psycopg2
from psycopg2.extras import execute_values

from config import DATA_DIR, DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def normalize_officer_name(name: str) -> str:
    """Normalize officer name: lowercase, trim, handle LASTNAME, FIRSTNAME format."""
    if not name:
        return ""
    name = name.strip().lower()
    name = re.sub(r"[.,']", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    # Handle "LASTNAME, FIRSTNAME" -> "firstname lastname"
    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            name = parts[1] + " " + parts[0]
    return name


def download_census_csv():
    """Download census CSV if not already present."""
    csv_path = DATA_DIR / "census.csv"
    if csv_path.exists() and csv_path.stat().st_size > 100 * 1024 * 1024:
        log.info("Census CSV already at %s (%.0f MB)", csv_path, csv_path.stat().st_size / (1024 * 1024))
        return csv_path

    import httpx
    from config import DATAHUB_BULK_CSV_URL

    log.info("Downloading FMCSA Census CSV...")
    with httpx.Client(timeout=600, follow_redirects=True) as client:
        with client.stream("GET", DATAHUB_BULK_CSV_URL) as resp:
            resp.raise_for_status()
            total = 0
            with open(csv_path, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)
                    total += len(chunk)
                    if total % (100 * 1024 * 1024) == 0:
                        log.info("  Downloaded %.0f MB...", total / (1024 * 1024))
    log.info("Downloaded census CSV: %.0f MB", csv_path.stat().st_size / (1024 * 1024))
    return csv_path


def parse_principals(csv_path):
    """Parse officer data from census CSV."""
    log.info("Parsing principals from %s", csv_path)
    count = 0

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k.lower().strip(): v for k, v in raw_row.items()}

            dot_str = (row.get("dot_number", "") or "").strip()
            if not dot_str:
                continue
            try:
                dot = int(dot_str)
            except ValueError:
                continue

            phone = (row.get("phone", "") or "").strip() or None
            cell = (row.get("cell_phone", "") or "").strip() or None
            email = (row.get("email_address", "") or "").strip() or None

            for field, position in [("company_officer_1", "Officer 1"), ("company_officer_2", "Officer 2")]:
                name = (row.get(field, "") or "").strip()
                if not name or len(name) < 2:
                    continue
                normalized = normalize_officer_name(name)
                if not normalized or len(normalized) < 2:
                    continue

                yield (dot, name, normalized, position, phone if position == "Officer 1" else cell, email)
                count += 1

            if count % 500000 == 0 and count > 0:
                log.info("  Parsed %d principal records...", count)

    log.info("Total principal records parsed: %d", count)


def main():
    log.info("=== CarrierWatch Principals Pipeline ===")

    csv_path = download_census_csv()

    conn = psycopg2.connect(DATABASE_URL)
    try:
        # Clear existing data
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM carrier_principals")
            existing = cur.fetchone()[0]
            if existing > 0:
                log.info("Clearing %d existing principal records...", existing)
                cur.execute("TRUNCATE carrier_principals RESTART IDENTITY")
                conn.commit()

        # Parse and insert
        insert_sql = """
            INSERT INTO carrier_principals (dot_number, officer_name, officer_name_normalized, officer_position, phone, email)
            VALUES %s
        """
        template = "(%s, %s, %s, %s, %s, %s)"

        batch = []
        total = 0
        batch_size = 10000

        for record in parse_principals(csv_path):
            batch.append(record)
            total += 1

            if len(batch) >= batch_size:
                with conn.cursor() as cur:
                    execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                batch = []
                if total % 500000 == 0:
                    log.info("  Inserted %d records...", total)

        if batch:
            with conn.cursor() as cur:
                execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
            conn.commit()

        log.info("Total principals inserted: %d", total)

        # Stats
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(DISTINCT officer_name_normalized) FROM carrier_principals")
            unique = cur.fetchone()[0]
            cur.execute("""
                SELECT officer_name_normalized, COUNT(DISTINCT dot_number) as carrier_count
                FROM carrier_principals
                GROUP BY officer_name_normalized
                HAVING COUNT(DISTINCT dot_number) >= 5
                ORDER BY carrier_count DESC
                LIMIT 10
            """)
            top = cur.fetchall()

        log.info("Unique officers: %d", unique)
        log.info("Top officers with 5+ carriers:")
        for name, cnt in top:
            log.info("  %s — %d carriers", name, cnt)

        # Update risk flags for officers with many carriers
        log.info("Updating officer-based risk flags...")
        with conn.cursor() as cur:
            # Find officers with 5+ carriers
            cur.execute("""
                CREATE TEMP TABLE officer_counts AS
                SELECT officer_name_normalized, COUNT(DISTINCT dot_number) as carrier_count
                FROM carrier_principals
                GROUP BY officer_name_normalized
                HAVING COUNT(DISTINCT dot_number) >= 5
            """)

            # Get dot numbers that need flagging
            cur.execute("""
                CREATE TEMP TABLE officer_flagged_dots AS
                SELECT DISTINCT cp.dot_number, MAX(oc.carrier_count) as max_count
                FROM carrier_principals cp
                JOIN officer_counts oc ON cp.officer_name_normalized = oc.officer_name_normalized
                GROUP BY cp.dot_number
            """)

            # Apply risk scores based on tier
            for threshold, points, flag in [
                (25, 50, "OFFICER_25_PLUS"),
                (10, 35, "OFFICER_10_PLUS"),
                (5, 20, "OFFICER_5_PLUS"),
            ]:
                cur.execute("""
                    UPDATE carriers c SET
                        risk_score = COALESCE(risk_score, 0) + %s,
                        risk_flags = array_append(COALESCE(risk_flags, '{}'), %s)
                    FROM officer_flagged_dots ofd
                    WHERE c.dot_number = ofd.dot_number
                      AND ofd.max_count >= %s
                      AND NOT (%s = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_25_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_10_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_5_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                """, (points, flag, threshold, flag))
                flagged = cur.rowcount
                conn.commit()
                log.info("  %s (%d+ carriers, +%d pts): %d carriers flagged", flag, threshold, points, flagged)

    finally:
        conn.close()

    log.info("=== Principals Pipeline complete ===")


if __name__ == "__main__":
    main()
