"""
CarrierWatch PPP Loan Ingestion Pipeline

Downloads SBA PPP loan data and cross-references with FMCSA carriers
by name and address matching.
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

from config import DATA_DIR, DATABASE_URL

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# SBA PPP data is available on data.sba.gov (updated Sept 2024)
PPP_LARGE_LOANS_URL = "https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/c1275a03-c25c-488a-bd95-403c4b2fa036/download/public_150k_plus_240930.csv"

# Under-150K loans split into 12 files — download all for complete coverage
PPP_SMALL_LOAN_URLS = [
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/cff06664-1f75-4969-ab3d-6fa7d6b4c41e/download/public_up_to_150k_1_240930.csv", "ppp_up_to_150k_1.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/1e6b6629-a5aa-46e6-a442-6e67366d2362/download/public_up_to_150k_2_240930.csv", "ppp_up_to_150k_2.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/644c304a-f5ad-4cfa-b128-fe2cbcb7b26e/download/public_up_to_150k_3_240930.csv", "ppp_up_to_150k_3.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/98af633d-eb1b-4d4b-995d-330962e6c38d/download/public_up_to_150k_4_240930.csv", "ppp_up_to_150k_4.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/3b407e04-f269-47a0-a5fe-661d1a08a76c/download/public_up_to_150k_5_240930.csv", "ppp_up_to_150k_5.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/7b7b5b58-9645-4b88-a675-a8a825e77076/download/public_up_to_150k_6_240930.csv", "ppp_up_to_150k_6.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/dabdddb5-1807-44f6-97c6-d624a5372525/download/public_up_to_150k_7_240930.csv", "ppp_up_to_150k_7.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/1fc6ddc4-ccb0-49d4-b632-0749e3292e57/download/public_up_to_150k_8_240930.csv", "ppp_up_to_150k_8.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/e9f2c718-b95e-47da-8f3e-17154aab1c86/download/public_up_to_150k_9_240930.csv", "ppp_up_to_150k_9.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/d9972f0d-c377-46ac-8637-a5c1265377c8/download/public_up_to_150k_10_240930.csv", "ppp_up_to_150k_10.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/8db19ddc-f036-40df-89f9-d0d309aa58b5/download/public_up_to_150k_11_240930.csv", "ppp_up_to_150k_11.csv"),
    ("https://data.sba.gov/dataset/8aa276e2-6cab-4f86-aca4-a7dde42adf24/resource/7e4f672f-d163-4735-a5ec-f23afa2835db/download/public_up_to_150k_12_240930.csv", "ppp_up_to_150k_12.csv"),
]

# Trucking-related NAICS codes
TRUCKING_NAICS = {
    "484110",  # General Freight Trucking, Local
    "484121",  # General Freight Trucking, Long-Distance, Truckload
    "484122",  # General Freight Trucking, Long-Distance, Less Than Truckload
    "484210",  # Used Household and Office Goods Moving
    "484220",  # Specialized Freight (except Used Goods) Trucking, Local
    "484230",  # Specialized Freight (except Used Goods) Trucking, Long-Distance
    "488410",  # Motor Vehicle Towing
    "488490",  # Other Support Activities for Road Transportation
    "492110",  # Couriers and Express Delivery Services
    "493110",  # General Warehousing and Storage
}


def normalize_name(name):
    """Normalize business name for matching."""
    if not name:
        return ""
    name = name.upper().strip()
    # Remove common suffixes
    for suffix in [" LLC", " INC", " CORP", " CO", " LTD", " LP", " COMPANY", " INCORPORATED"]:
        name = name.replace(suffix, "")
    name = re.sub(r"[.,\-'\"()]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def make_name_hash(name):
    if not name:
        return None
    normalized = normalize_name(name)
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def make_address_hash(address, city, state, zip_code):
    addr = (address or "").upper().strip()
    addr = re.sub(r"[.,#]", "", addr)
    addr = re.sub(r"\s+", " ", addr).strip()
    city = (city or "").upper().strip()
    state = (state or "").upper().strip()
    zip5 = (zip_code or "")[:5].strip()
    combined = "%s|%s|%s|%s" % (addr, city, state, zip5)
    if combined == "|||":
        return None
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


def parse_amount(val):
    if not val:
        return 0.0
    try:
        return float(val.strip().replace(",", "").replace("$", ""))
    except ValueError:
        return 0.0


def parse_int_safe(val):
    if not val:
        return 0
    try:
        return int(float(val.strip().replace(",", "")))
    except ValueError:
        return 0


def parse_date_safe(val):
    if not val or not val.strip():
        return None
    val = val.strip()
    # Try MM/DD/YYYY
    parts = val.split("/")
    if len(parts) == 3:
        try:
            return "%s-%s-%s" % (parts[2], parts[0].zfill(2), parts[1].zfill(2))
        except (ValueError, IndexError):
            pass
    if re.match(r"\d{4}-\d{2}-\d{2}", val):
        return val[:10]
    return None


def download_file(url, path, label):
    """Download a single file from URL to path."""
    if path.exists() and path.stat().st_size > 1024 * 1024:
        log.info("%s already downloaded at %s", label, path)
        return True

    log.info("Downloading %s from SBA...", label)
    log.info("URL: %s", url)
    try:
        with httpx.Client(timeout=600, follow_redirects=True) as client:
            with client.stream("GET", url) as resp:
                resp.raise_for_status()
                total = 0
                with open(path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=1024 * 1024):
                        f.write(chunk)
                        total += len(chunk)
                        if total % (100 * 1024 * 1024) == 0:
                            log.info("  Downloaded %.0f MB...", total / (1024 * 1024))
        log.info("Downloaded %s: %.0f MB", label, path.stat().st_size / (1024 * 1024))
        return True
    except Exception as e:
        log.error("Failed to download %s: %s", label, e)
        return False


def download_ppp_data():
    """Download PPP loan CSVs from SBA."""
    paths = []

    # Large loans (150K+) — single file
    large_path = DATA_DIR / "ppp_150k_plus.csv"
    if download_file(PPP_LARGE_LOANS_URL, large_path, "150K+ loans"):
        paths.append(large_path)

    # Small loans (up to 150K) — 12 split files
    for url, filename in PPP_SMALL_LOAN_URLS:
        path = DATA_DIR / filename
        if download_file(url, path, filename):
            paths.append(path)

    return paths


def parse_ppp_csv(csv_path):
    """Parse PPP loan CSV and yield loan records, filtering for trucking-related NAICS."""
    if not csv_path.exists():
        log.warning("File not found: %s", csv_path)
        return

    log.info("Parsing PPP CSV: %s", csv_path)
    count = 0
    trucking_count = 0

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k.lower().strip() if k else "": v for k, v in raw_row.items()}
            count += 1

            naics = row.get("naicscode", row.get("naics_code", "")).strip()

            # Filter: only trucking/transport NAICS, or try to match all and let
            # the DB matching narrow it down
            # For now, take all loans — we'll match by name/address to carriers
            borrower = row.get("borrowername", row.get("borrower_name", "")).strip()
            if not borrower:
                continue

            address = row.get("borroweraddress", row.get("borrower_address", "")).strip()
            city = row.get("borrowercity", row.get("borrower_city", "")).strip()
            state = row.get("borrowerstate", row.get("borrower_state", "")).strip()
            zipcode = row.get("borrowerzip", row.get("borrower_zip", "")).strip()

            loan_amount = parse_amount(
                row.get("currentapprovalamount", row.get("loan_amount", row.get("initialapprovalamount", "")))
            )
            forgiveness = parse_amount(
                row.get("forgivenessamt", row.get("forgivenessamount", row.get("forgiveness_amount", "")))
            )
            jobs = parse_int_safe(row.get("jobsreported", row.get("jobs_reported", "")))
            lender = row.get("servicinglendername", row.get("originatinglendername", row.get("lender", ""))).strip()
            date_approved = parse_date_safe(row.get("dateapproved", row.get("date_approved", "")))
            forgiveness_date = parse_date_safe(row.get("forgivenessdate", row.get("forgiveness_date", "")))
            loan_status = row.get("loanstatus", row.get("loan_status", "")).strip()

            is_trucking = naics[:6] in TRUCKING_NAICS if len(naics) >= 6 else False
            if is_trucking:
                trucking_count += 1

            record = {
                "borrower_name": borrower,
                "borrower_address": address or None,
                "borrower_city": city or None,
                "borrower_state": state or None,
                "borrower_zip": zipcode or None,
                "naics_code": naics or None,
                "loan_amount": loan_amount,
                "forgiveness_amount": forgiveness,
                "forgiveness_date": forgiveness_date,
                "loan_status": loan_status or None,
                "jobs_reported": jobs,
                "lender": lender or None,
                "date_approved": date_approved,
                "address_hash": make_address_hash(address, city, state, zipcode),
                "name_hash": make_name_hash(borrower),
            }

            yield record

            if count % 500000 == 0:
                log.info("Parsed %d PPP records (%d trucking)...", count, trucking_count)

    log.info("Total PPP records: %d (trucking NAICS: %d)", count, trucking_count)


PPP_COLUMNS = [
    "borrower_name", "borrower_address", "borrower_city", "borrower_state",
    "borrower_zip", "naics_code", "loan_amount", "forgiveness_amount",
    "forgiveness_date", "loan_status", "jobs_reported", "lender",
    "date_approved", "address_hash", "name_hash",
]


def bulk_insert_ppp(records, conn):
    """Bulk insert PPP loan records."""
    columns_sql = ", ".join(PPP_COLUMNS)
    insert_sql = "INSERT INTO ppp_loans ({cols}) VALUES %s".format(cols=columns_sql)
    template = "(" + ", ".join(["%s"] * len(PPP_COLUMNS)) + ")"

    batch = []
    total = 0
    batch_size = 10000

    with conn.cursor() as cur:
        for record in records:
            row = tuple(record.get(c) for c in PPP_COLUMNS)
            batch.append(row)

            if len(batch) >= batch_size:
                execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                total += len(batch)
                if total % 100000 == 0:
                    log.info("Inserted %d PPP records...", total)
                batch = []

        if batch:
            execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
            conn.commit()
            total += len(batch)

    log.info("Total PPP records inserted: %d", total)
    return total


def match_ppp_to_carriers(conn):
    """Match PPP loans to carriers by address hash and name similarity."""
    log.info("Matching PPP loans to carriers...")

    with conn.cursor() as cur:
        # Match 1: Exact address hash match
        cur.execute("""
            UPDATE ppp_loans p SET
                matched_dot_number = c.dot_number,
                match_confidence = 'exact_address'
            FROM carriers c
            WHERE p.address_hash = c.address_hash
              AND p.address_hash IS NOT NULL
              AND p.matched_dot_number IS NULL
              AND c.address_hash IS NOT NULL
        """)
        addr_matches = cur.rowcount
        conn.commit()
        log.info("  Address hash matches: %d", addr_matches)

        # Match 2: Simpler name match — direct upper-case comparison
        cur.execute("""
            UPDATE ppp_loans p SET
                matched_dot_number = c.dot_number,
                match_confidence = 'name_match'
            FROM carriers c
            WHERE p.matched_dot_number IS NULL
              AND UPPER(TRIM(p.borrower_name)) = UPPER(TRIM(c.legal_name))
              AND p.borrower_state = c.physical_state
        """)
        name_matches = cur.rowcount
        conn.commit()
        log.info("  Name + state matches: %d", name_matches)

        # Update carrier PPP counts
        cur.execute("""
            UPDATE carriers c SET
                ppp_loan_count = sub.cnt,
                ppp_loan_total = sub.total_amount,
                ppp_forgiven_total = sub.total_forgiven
            FROM (
                SELECT matched_dot_number,
                       COUNT(*) as cnt,
                       COALESCE(SUM(loan_amount), 0) as total_amount,
                       COALESCE(SUM(forgiveness_amount), 0) as total_forgiven
                FROM ppp_loans
                WHERE matched_dot_number IS NOT NULL
                GROUP BY matched_dot_number
            ) sub
            WHERE c.dot_number = sub.matched_dot_number
        """)
        updated = cur.rowcount
        conn.commit()
        log.info("  Carriers updated with PPP data: %d", updated)

    return addr_matches + name_matches


def main():
    log.info("=== CarrierWatch PPP Loan Pipeline ===")

    # Step 1: Download
    paths = download_ppp_data()

    conn = psycopg2.connect(DATABASE_URL)
    try:
        # Clear existing PPP data for re-runs
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ppp_loans")
            existing = cur.fetchone()[0]
            if existing > 0:
                log.info("Clearing %d existing PPP records...", existing)
                cur.execute("TRUNCATE ppp_loans RESTART IDENTITY")
                conn.commit()

        # Step 2: Load PPP data
        for path in paths:
            if path.exists():
                log.info("Loading: %s", path.name)
                records = parse_ppp_csv(path)
                bulk_insert_ppp(records, conn)

        # Step 3: Match to carriers
        matches = match_ppp_to_carriers(conn)
        log.info("Total PPP-carrier matches: %d", matches)

        # Step 4: Recompute risk scores
        log.info("Recomputing risk scores...")
        with conn.cursor() as cur:
            cur.execute("SELECT compute_risk_scores()")
        conn.commit()

        # Stats
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM ppp_loans")
            total_loans = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM ppp_loans WHERE matched_dot_number IS NOT NULL")
            matched = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM carriers WHERE ppp_loan_count > 0")
            carriers_with_ppp = cur.fetchone()[0]
            cur.execute("SELECT COALESCE(SUM(loan_amount), 0) FROM ppp_loans WHERE matched_dot_number IS NOT NULL")
            total_ppp_amount = cur.fetchone()[0]

        log.info("=== PPP Pipeline Stats ===")
        log.info("Total PPP loans loaded: %d", total_loans)
        log.info("Matched to carriers: %d", matched)
        log.info("Carriers with PPP: %d", carriers_with_ppp)
        log.info("Total PPP amount matched: $%s", "{:,.2f}".format(total_ppp_amount))

    finally:
        conn.close()

    log.info("=== PPP Pipeline complete ===")


if __name__ == "__main__":
    main()
