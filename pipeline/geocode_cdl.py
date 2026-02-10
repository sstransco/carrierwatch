"""
CarrierWatch CDL Schools Geocoding Pipeline

Geocodes CDL school addresses using the Census Bureau Batch Geocoder.
Processes schools in batches of 10,000.
"""
from __future__ import annotations

import csv
import io
import logging
import time

import httpx
import psycopg2
from psycopg2.extras import execute_batch

# Configuration
DB_DSN = "host=localhost port=5433 dbname=carrierwatch user=carrierwatch password=carrierwatch_dev_2024"
CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
BATCH_SIZE = 10_000
MAX_RETRIES = 3
RETRY_DELAY = 10
BATCH_DELAY = 3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def get_ungeocoded_schools(conn) -> list[dict]:
    sql = """
        SELECT id, physical_address, city, state, zip
        FROM cdl_schools
        WHERE location IS NULL
          AND physical_address IS NOT NULL
          AND physical_address != ''
        ORDER BY id
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return [
        {"id": r[0], "address": r[1], "city": r[2] or "", "state": r[3] or "", "zip": (r[4] or "")[:5]}
        for r in rows
    ]


def build_census_csv(schools: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    for s in schools:
        writer.writerow([s["id"], s["address"], s["city"], s["state"], s["zip"]])
    return buf.getvalue()


def submit_census_batch(batch_csv: str, batch_num: int) -> dict[int, tuple[float, float]]:
    files = {"addressFile": ("batch.csv", batch_csv, "text/csv")}
    data = {"benchmark": "Public_AR_Current"}

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            log.info("  Attempt %d/%d for batch %d...", attempt, MAX_RETRIES, batch_num)
            with httpx.Client(timeout=180) as client:
                resp = client.post(CENSUS_GEOCODER_URL, data=data, files=files)
                resp.raise_for_status()

            results = {}
            reader = csv.reader(io.StringIO(resp.text))
            for row in reader:
                if len(row) < 6:
                    continue
                try:
                    school_id = int(row[0].strip('"'))
                except ValueError:
                    continue
                match_status = row[2].strip('"').strip()
                if match_status in ("Match", "Exact"):
                    coords = row[5].strip('"').strip()
                    if "," in coords:
                        lng_str, lat_str = coords.split(",")
                        try:
                            lng = float(lng_str)
                            lat = float(lat_str)
                            if -180 <= lng <= 180 and -90 <= lat <= 90:
                                results[school_id] = (lat, lng)
                        except ValueError:
                            pass
            log.info("  Census returned %d matches", len(results))
            return results

        except httpx.TimeoutException:
            log.warning("  Timeout on attempt %d for batch %d", attempt, batch_num)
        except httpx.HTTPStatusError as e:
            log.warning("  HTTP %s on attempt %d for batch %d", e.response.status_code, attempt, batch_num)
        except httpx.RequestError as e:
            log.warning("  Request error on attempt %d for batch %d: %s", attempt, batch_num, e)

        if attempt < MAX_RETRIES:
            wait = RETRY_DELAY * attempt
            log.info("  Retrying in %ds...", wait)
            time.sleep(wait)

    log.error("  All %d attempts failed for batch %d", MAX_RETRIES, batch_num)
    return {}


def update_locations(conn, locations: dict[int, tuple[float, float]]):
    if not locations:
        return
    sql = """
        UPDATE cdl_schools
        SET location = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
        WHERE id = %s
    """
    params = [(lng, lat, sid) for sid, (lat, lng) in locations.items()]
    with conn.cursor() as cur:
        execute_batch(cur, sql, params, page_size=1000)
    conn.commit()
    log.info("  Updated %d school locations in database", len(locations))


def main():
    log.info("=== CDL Schools Geocoding Pipeline ===")
    conn = psycopg2.connect(DB_DSN)
    try:
        schools = get_ungeocoded_schools(conn)
        total = len(schools)
        log.info("Found %d schools to geocode", total)

        if total == 0:
            log.info("Nothing to geocode.")
            return

        geocoded_total = 0
        failed_total = 0
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

        for i in range(0, total, BATCH_SIZE):
            batch = schools[i : i + BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1
            log.info("Batch %d/%d -- %d schools (rows %d-%d of %d)",
                     batch_num, total_batches, len(batch), i + 1, i + len(batch), total)

            batch_csv = build_census_csv(batch)
            results = submit_census_batch(batch_csv, batch_num)

            if results:
                update_locations(conn, results)
                geocoded_total += len(results)

            batch_failed = len(batch) - len(results)
            failed_total += batch_failed
            log.info("  Batch %d done: %d matched, %d failed | Running total: %d",
                     batch_num, len(results), batch_failed, geocoded_total)

            if i + BATCH_SIZE < total:
                log.info("  Waiting %ds before next batch...", BATCH_DELAY)
                time.sleep(BATCH_DELAY)

        log.info("=== Geocoding Complete ===")
        log.info("Schools processed:     %d", total)
        log.info("Successfully geocoded: %d", geocoded_total)
        log.info("Failed/no match:       %d", failed_total)
        if total > 0:
            log.info("Success rate:          %.1f%%", geocoded_total / total * 100)

        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM cdl_schools WHERE location IS NOT NULL")
            db_count = cur.fetchone()[0]
        log.info("Total schools with location in DB: %d / 31780", db_count)

    finally:
        conn.close()
        log.info("Database connection closed.")


if __name__ == "__main__":
    main()
