"""
CarrierWatch — CDL Training Schools Pipeline

Downloads the FMCSA Training Provider Registry (TPR) Excel export
and populates the cdl_schools table. Cross-references addresses with
carrier addresses for fraud detection.
"""
from __future__ import annotations

import hashlib
import logging
import re

import httpx
import openpyxl
import psycopg2
from psycopg2.extras import execute_values

from config import DATA_DIR, DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

TPR_XLSX_URL = "https://tpr.fmcsa.dot.gov/content/Locations/Location-List-20260209_1602.xlsx"
TPR_FILE = "cdl_schools.xlsx"


def download_tpr():
    """Download TPR Excel export."""
    path = DATA_DIR / TPR_FILE
    if path.exists() and path.stat().st_size > 100 * 1024:
        log.info("TPR Excel already at %s (%.1f MB)", path, path.stat().st_size / (1024 * 1024))
        return path

    log.info("Downloading TPR Excel...")
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        resp = client.get(TPR_XLSX_URL)
        resp.raise_for_status()
        with open(path, "wb") as f:
            f.write(resp.content)
    log.info("Downloaded TPR Excel: %.1f MB", path.stat().st_size / (1024 * 1024))
    return path


STREET_ABBREVS = {
    r"\bSTREET\b": "ST", r"\bAVENUE\b": "AVE", r"\bBOULEVARD\b": "BLVD",
    r"\bDRIVE\b": "DR", r"\bLANE\b": "LN", r"\bROAD\b": "RD",
    r"\bCOURT\b": "CT", r"\bPLACE\b": "PL", r"\bCIRCLE\b": "CIR",
    r"\bPARKWAY\b": "PKWY", r"\bHIGHWAY\b": "HWY", r"\bSUITE\b": "STE",
    r"\bAPARTMENT\b": "APT", r"\bBUILDING\b": "BLDG", r"\bFLOOR\b": "FL",
    r"\bNORTH\b": "N", r"\bSOUTH\b": "S", r"\bEAST\b": "E", r"\bWEST\b": "W",
}


def normalize_address(addr, city, state, zipcode):
    """Normalize address to match carriers.make_address_hash format."""
    if not addr:
        return None
    a = addr.strip().upper()
    a = re.sub(r"[.,#]", "", a)
    for pattern, replacement in STREET_ABBREVS.items():
        a = re.sub(pattern, replacement, a)
    a = re.sub(r"\s+", " ", a).strip()
    c = (city or "").upper().strip()
    s = (state or "").upper().strip()
    z = str(zipcode or "").strip()[:5]
    raw = "%s|%s|%s|%s" % (a, c, s, z)
    if raw == "|||":
        return None
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def parse_tpr(xlsx_path):
    """Parse TPR Excel file and yield school records."""
    log.info("Parsing TPR Excel from %s", xlsx_path)
    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb["Registered Locations"]

    # Headers are in row 3:
    # Col 0: Location Type, Col 1: Private Enrollment Only, Col 2: Training Conducted In (state),
    # Col 3: Last Updated, Col 4: Training Location Name, Col 5: Training Provider Name,
    # Col 6: Provider Status, Col 7: Phone Number, Col 8: Email Address, Col 9: Website,
    # Col 10: Street Address, Col 11: City, Col 12: ZIP Code,
    # Col 13-15: Class A (Theory, BTW Range, BTW Public)
    # Col 16-18: Class B (Theory, BTW Range, BTW Public)
    # Col 19-21: Passenger (Theory, BTW Range, BTW Public)
    # Col 22-24: School Bus (Theory, BTW Range, BTW Public)
    # Col 25: Hazardous Materials Theory

    count = 0
    for row in ws.iter_rows(min_row=4, values_only=True):
        name = row[4] if len(row) > 4 else None
        if not name:
            continue

        provider = row[5] if len(row) > 5 else name
        state = (row[2] if len(row) > 2 else None) or ""
        # Map state names to abbreviations
        state_abbr = state_name_to_abbr(state.strip()) if state else None

        street = (row[10] if len(row) > 10 else None) or ""
        city = (row[11] if len(row) > 11 else None) or ""
        zipcode = str(row[12]).strip()[:10] if len(row) > 12 and row[12] else ""
        phone = str(row[7]).strip() if len(row) > 7 and row[7] else None
        location_type = str(row[0]).strip() if len(row) > 0 and row[0] else None
        status = str(row[6]).strip() if len(row) > 6 and row[6] else "active"

        # Determine training types
        training = []
        if len(row) > 15:
            if any(str(row[i]).strip().upper() == "YES" for i in [13, 14, 15] if i < len(row) and row[i]):
                training.append("Class A")
        if len(row) > 18:
            if any(str(row[i]).strip().upper() == "YES" for i in [16, 17, 18] if i < len(row) and row[i]):
                training.append("Class B")
        if len(row) > 21:
            if any(str(row[i]).strip().upper() == "YES" for i in [19, 20, 21] if i < len(row) and row[i]):
                training.append("Passenger")
        if len(row) > 24:
            if any(str(row[i]).strip().upper() == "YES" for i in [22, 23, 24] if i < len(row) and row[i]):
                training.append("School Bus")
        if len(row) > 25:
            if str(row[25]).strip().upper() == "YES":
                training.append("Hazmat")

        address_hash = normalize_address(street, city, state_abbr or state, zipcode)

        yield (
            str(provider)[:500],
            str(street)[:500] if street else None,
            str(city)[:200] if city else None,
            state_abbr,
            zipcode or None,
            phone,
            training or None,
            location_type,
            status.lower() if status else "active",
            address_hash,
        )
        count += 1

    log.info("Parsed %d CDL school records", count)


STATE_MAP = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
    "puerto rico": "PR", "guam": "GU", "virgin islands": "VI",
    "american samoa": "AS", "northern mariana islands": "MP",
}


def state_name_to_abbr(name):
    if not name:
        return None
    name_lower = name.strip().lower()
    if name_lower in STATE_MAP:
        return STATE_MAP[name_lower]
    # Already an abbreviation?
    if len(name) == 2 and name.upper() in STATE_MAP.values():
        return name.upper()
    return None


def main():
    log.info("=== CarrierWatch CDL Schools Pipeline ===")

    xlsx_path = download_tpr()

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM cdl_schools")
            existing = cur.fetchone()[0]
            if existing > 0:
                log.info("Clearing %d existing CDL school records...", existing)
                cur.execute("TRUNCATE cdl_schools RESTART IDENTITY")
                conn.commit()

        insert_sql = """
            INSERT INTO cdl_schools
                (provider_name, physical_address, city, state, zip, phone,
                 training_types, provider_type, status, address_hash)
            VALUES %s
        """
        template = "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"

        batch = []
        total = 0
        batch_size = 5000

        for record in parse_tpr(xlsx_path):
            batch.append(record)
            total += 1

            if len(batch) >= batch_size:
                with conn.cursor() as cur:
                    execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
                conn.commit()
                batch = []
                log.info("  Inserted %d records...", total)

        if batch:
            with conn.cursor() as cur:
                execute_values(cur, insert_sql, batch, template=template, page_size=batch_size)
            conn.commit()

        log.info("Total CDL schools inserted: %d", total)

        # Stats
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(DISTINCT state) FROM cdl_schools WHERE state IS NOT NULL")
            states = cur.fetchone()[0]
            cur.execute("SELECT state, COUNT(*) FROM cdl_schools WHERE state IS NOT NULL GROUP BY state ORDER BY COUNT(*) DESC LIMIT 10")
            top_states = cur.fetchall()
            cur.execute("SELECT unnest(training_types) as t, COUNT(*) FROM cdl_schools WHERE training_types IS NOT NULL GROUP BY t ORDER BY COUNT(*) DESC")
            training_dist = cur.fetchall()

        log.info("CDL schools across %d states", states)
        log.info("Top states:")
        for st, cnt in top_states:
            log.info("  %s: %d schools", st, cnt)
        log.info("Training types:")
        for t, cnt in training_dist:
            log.info("  %s: %d schools", t, cnt)

        # Cross-reference with carrier addresses
        log.info("Cross-referencing CDL schools with carrier addresses...")
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cs.provider_name, cs.city, cs.state, ac.carrier_count
                FROM cdl_schools cs
                JOIN address_clusters ac ON cs.address_hash = ac.address_hash
                WHERE ac.carrier_count >= 3
                ORDER BY ac.carrier_count DESC
                LIMIT 20
            """)
            overlaps = cur.fetchall()

        if overlaps:
            log.info("CDL schools at addresses with 3+ carriers:")
            for name, city, state, cnt in overlaps:
                log.info("  %s (%s, %s) — %d carriers at same address", name, city, state, cnt)
        else:
            log.info("No CDL schools found at high-density carrier addresses")

    finally:
        conn.close()

    log.info("=== CDL Schools Pipeline complete ===")


if __name__ == "__main__":
    main()
