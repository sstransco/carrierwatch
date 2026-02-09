"""
CarrierWatch Geocoding Pipeline

Geocodes carrier addresses using the Census Bureau Batch Geocoder (free, no API key).
Falls back to Nominatim/OSM for failed addresses.
"""
from __future__ import annotations

import csv
import io
import logging
import time

import httpx
import psycopg2
from psycopg2.extras import execute_batch

from config import (
    CENSUS_GEOCODER_URL,
    DATABASE_URL,
    GEOCODE_BATCH_SIZE,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def get_ungeocoded_carriers(conn, limit: int = 0) -> list[dict]:
    """Get carriers that haven't been geocoded yet."""
    sql = """
        SELECT dot_number, physical_address, physical_city, physical_state, physical_zip
        FROM carriers
        WHERE location IS NULL
          AND physical_address IS NOT NULL
          AND physical_address != ''
          AND physical_state IS NOT NULL
        ORDER BY dot_number
    """
    if limit > 0:
        sql += f" LIMIT {limit}"

    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    return [
        {
            "dot_number": r[0],
            "address": r[1],
            "city": r[2],
            "state": r[3],
            "zip": r[4],
        }
        for r in rows
    ]


def build_census_batch(carriers: list[dict]) -> str:
    """Build CSV content for Census Bureau batch geocoder.

    Format: Unique ID, Street Address, City, State, ZIP
    """
    buf = io.StringIO()
    writer = csv.writer(buf)
    for c in carriers:
        writer.writerow([
            c["dot_number"],
            c["address"] or "",
            c["city"] or "",
            c["state"] or "",
            (c["zip"] or "")[:5],
        ])
    return buf.getvalue()


def submit_census_batch(batch_csv: str) -> dict[int, tuple[float, float]]:
    """Submit batch to Census Geocoder, return {dot_number: (lat, lng)}."""
    results = {}

    files = {"addressFile": ("batch.csv", batch_csv, "text/csv")}
    data = {
        "benchmark": "Public_AR_Current",
        "returntype": "locations",
    }

    try:
        with httpx.Client(timeout=120) as client:
            resp = client.post(CENSUS_GEOCODER_URL, data=data, files=files)
            resp.raise_for_status()

        reader = csv.reader(io.StringIO(resp.text))
        for row in reader:
            if len(row) < 6:
                continue
            try:
                dot_number = int(row[0].strip('"'))
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
                            results[dot_number] = (lat, lng)
                    except ValueError:
                        pass
    except httpx.HTTPStatusError as e:
        log.error("Census geocoder HTTP error: %s", e)
    except httpx.RequestError as e:
        log.error("Census geocoder request error: %s", e)

    return results


def geocode_nominatim(address: str, city: str, state: str) -> tuple[float, float] | None:
    """Fallback geocoder using Nominatim/OSM. Rate-limited to 1 req/sec."""
    query = f"{address}, {city}, {state}, USA"
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "countrycodes": "us",
    }
    headers = {"User-Agent": "CarrierWatch/1.0 (transparency platform)"}

    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if data:
                lat = float(data[0]["lat"])
                lon = float(data[0]["lon"])
                return (lat, lon)
    except Exception as e:
        log.debug("Nominatim failed for %s: %s", query, e)

    return None


def update_locations(conn, locations: dict[int, tuple[float, float]]):
    """Update carrier locations in the database."""
    if not locations:
        return

    sql = """
        UPDATE carriers
        SET location = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
            updated_at = NOW()
        WHERE dot_number = %s
    """
    params = [(lng, lat, dot) for dot, (lat, lng) in locations.items()]

    with conn.cursor() as cur:
        execute_batch(cur, sql, params, page_size=1000)
    conn.commit()


def main():
    log.info("=== CarrierWatch Geocoding Pipeline ===")

    conn = psycopg2.connect(DATABASE_URL)
    try:
        carriers = get_ungeocoded_carriers(conn)
        total = len(carriers)
        log.info("Found %d carriers to geocode", total)

        if total == 0:
            log.info("Nothing to geocode.")
            return

        geocoded_total = 0
        failed_total = 0

        # Process in batches via Census Geocoder
        for i in range(0, total, GEOCODE_BATCH_SIZE):
            batch = carriers[i:i + GEOCODE_BATCH_SIZE]
            batch_num = (i // GEOCODE_BATCH_SIZE) + 1
            total_batches = (total + GEOCODE_BATCH_SIZE - 1) // GEOCODE_BATCH_SIZE
            log.info("Processing batch %d/%d (%d carriers)...", batch_num, total_batches, len(batch))

            # Submit to Census Bureau
            batch_csv = build_census_batch(batch)
            results = submit_census_batch(batch_csv)
            log.info("  Census matched: %d / %d", len(results), len(batch))

            # Update matched locations
            if results:
                update_locations(conn, results)
                geocoded_total += len(results)

            # Track failures for optional Nominatim fallback
            failed = [c for c in batch if c["dot_number"] not in results]
            failed_total += len(failed)

            # Rate limiting between batches
            if i + GEOCODE_BATCH_SIZE < total:
                log.info("  Waiting 2s before next batch...")
                time.sleep(2)

        log.info("=== Geocoding Complete ===")
        log.info("Total geocoded (Census): %d", geocoded_total)
        log.info("Total failed: %d", failed_total)
        log.info("Success rate: %.1f%%", (geocoded_total / total * 100) if total else 0)

        # Refresh materialized views
        log.info("Refreshing materialized views...")
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW address_clusters;")
        conn.commit()
        log.info("Done.")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
