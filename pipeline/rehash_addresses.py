"""
Rehash all carrier addresses using improved normalization.

Strips suite/apt/unit numbers so carriers at the same building
share a single address_hash and cluster together on the map.
"""
from __future__ import annotations

import hashlib
import logging

import psycopg2

from config import DATABASE_URL
from ingest import normalize_address

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

BATCH_SIZE = 10_000


def make_hash(address: str, city: str, state: str, zip_code: str) -> str | None:
    normalized = normalize_address(address, city, state, zip_code)
    if not normalized or normalized == "|||":
        return None
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    # Count total
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM carriers WHERE physical_address IS NOT NULL")
        total = cur.fetchone()[0]
    log.info("Rehashing %d carriers...", total)

    offset = 0
    updated = 0
    while offset < total:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT dot_number, physical_address, physical_city, physical_state, physical_zip
                FROM carriers
                WHERE physical_address IS NOT NULL
                ORDER BY dot_number
                LIMIT %s OFFSET %s
            """, (BATCH_SIZE, offset))
            rows = cur.fetchall()

        if not rows:
            break

        updates = []
        for dot, addr, city, state, zip_code in rows:
            new_hash = make_hash(addr or "", city or "", state or "", zip_code or "")
            updates.append((new_hash, dot))

        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, """
                UPDATE carriers SET address_hash = %s WHERE dot_number = %s
            """, updates, page_size=1000)
        conn.commit()

        updated += len(updates)
        offset += BATCH_SIZE
        if updated % 100_000 == 0:
            log.info("  %d / %d rehashed...", updated, total)

    log.info("Rehashed %d carriers.", updated)

    # Refresh materialized view
    log.info("Refreshing address_clusters materialized view...")
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY address_clusters;")
    log.info("Done! Materialized view refreshed.")

    conn.close()


if __name__ == "__main__":
    import psycopg2.extras
    main()
