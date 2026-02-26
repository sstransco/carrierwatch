"""
county_setup.py — Download US county boundaries, load into PostGIS,
backfill carriers.county_geoid, and refresh county_carrier_stats.

Usage:
    cd pipeline && DATABASE_URL=postgresql://carrierwatch:carrierwatch_dev_2024@localhost:5433/carrierwatch python3 county_setup.py
"""
from __future__ import annotations

import os
import sys
import zipfile
import subprocess
import tempfile
import psycopg2
import psycopg2.extras
import httpx

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://carrierwatch:carrierwatch_dev_2024@localhost:5433/carrierwatch",
)

COUNTY_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip"
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

# State FIPS → abbreviation mapping
FIPS_TO_STATE = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
    "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
    "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR",
    "78": "VI",
}

BATCH_SIZE = 50_000


def download_counties() -> str:
    """Download Census county boundary shapefile if not already present."""
    os.makedirs(DATA_DIR, exist_ok=True)
    zip_path = os.path.join(DATA_DIR, "cb_2023_us_county_500k.zip")

    if os.path.exists(zip_path):
        print(f"  Shapefile ZIP already exists: {zip_path}")
        return zip_path

    print(f"  Downloading county boundaries from Census Bureau...")
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        resp = client.get(COUNTY_URL)
        resp.raise_for_status()
        with open(zip_path, "wb") as f:
            f.write(resp.content)

    print(f"  Downloaded {len(resp.content) / 1024 / 1024:.1f} MB → {zip_path}")
    return zip_path


def load_shapefile(zip_path: str) -> None:
    """Extract shapefile and load into PostGIS via shp2pgsql."""
    with tempfile.TemporaryDirectory() as tmpdir:
        print(f"  Extracting shapefile...")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmpdir)

        # Find the .shp file
        shp_file = None
        for fname in os.listdir(tmpdir):
            if fname.endswith(".shp"):
                shp_file = os.path.join(tmpdir, fname)
                break

        if not shp_file:
            raise FileNotFoundError("No .shp file found in archive")

        print(f"  Loading {shp_file} into PostGIS...")

        # Use shp2pgsql to generate SQL, pipe to psql
        # -s 4326: SRID
        # -D: dump format (faster)
        # -I: create spatial index
        # -W UTF-8: encoding
        shp2pgsql = subprocess.Popen(
            [
                "shp2pgsql", "-s", "4326", "-D", "-W", "UTF-8",
                shp_file, "public.us_counties_raw",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        psql = subprocess.Popen(
            ["psql", DATABASE_URL],
            stdin=shp2pgsql.stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        shp2pgsql.stdout.close()
        psql_stdout, psql_stderr = psql.communicate()

        # Wait for shp2pgsql to finish and check its exit code
        shp2pgsql.wait()
        shp2pgsql_stderr = shp2pgsql.stderr.read()

        if shp2pgsql.returncode != 0:
            print(f"  shp2pgsql FAILED (exit code {shp2pgsql.returncode})")
            if shp2pgsql_stderr:
                print(f"  shp2pgsql stderr: {shp2pgsql_stderr.decode()}")
            raise RuntimeError(f"shp2pgsql failed with code {shp2pgsql.returncode}")

        if psql.returncode != 0:
            print(f"  psql FAILED (exit code {psql.returncode})")
            if psql_stderr:
                print(f"  psql stderr: {psql_stderr.decode()}")
            raise RuntimeError(f"psql failed with code {psql.returncode}")

        print(f"  Shapefile loaded into us_counties_raw")


def transform_counties(conn) -> int:
    """Move data from raw shp2pgsql table to our us_counties table."""
    cur = conn.cursor()

    # Clear existing data
    cur.execute("TRUNCATE TABLE us_counties")

    # Insert from raw table, mapping columns
    cur.execute("""
        INSERT INTO us_counties (geoid, statefp, countyfp, name, namelsad, aland, awater, geom)
        SELECT
            geoid,
            statefp,
            countyfp,
            name,
            namelsad,
            aland::bigint,
            awater::bigint,
            ST_Multi(ST_SetSRID(geom, 4326))
        FROM us_counties_raw
        ON CONFLICT (geoid) DO UPDATE SET
            name = EXCLUDED.name,
            namelsad = EXCLUDED.namelsad,
            aland = EXCLUDED.aland,
            awater = EXCLUDED.awater,
            geom = EXCLUDED.geom
    """)
    count = cur.rowcount
    print(f"  Inserted {count} counties into us_counties")

    # Populate state abbreviations
    for fips, abbr in FIPS_TO_STATE.items():
        cur.execute(
            "UPDATE us_counties SET state_abbr = %s WHERE statefp = %s",
            (abbr, fips),
        )

    # Drop raw table
    cur.execute("DROP TABLE IF EXISTS us_counties_raw")

    conn.commit()
    return count


def backfill_county_geoid(conn) -> int:
    """Assign county_geoid to carriers via spatial join, in batches."""
    cur = conn.cursor()

    # Count carriers needing assignment
    cur.execute("""
        SELECT COUNT(*) FROM carriers
        WHERE location IS NOT NULL AND county_geoid IS NULL
    """)
    total = cur.fetchone()[0]
    print(f"  {total:,} carriers need county assignment")

    if total == 0:
        return 0

    updated = 0
    batch = 0

    while True:
        batch += 1
        cur.execute(f"""
            WITH batch AS (
                SELECT dot_number, location
                FROM carriers
                WHERE location IS NOT NULL AND county_geoid IS NULL
                ORDER BY dot_number
                LIMIT {BATCH_SIZE}
                FOR UPDATE SKIP LOCKED
            )
            UPDATE carriers c
            SET county_geoid = co.geoid
            FROM batch b
            -- ST_Covers includes points on polygon boundaries; ST_Within does not
            JOIN us_counties co ON ST_Covers(co.geom, b.location::geometry)
            WHERE c.dot_number = b.dot_number
        """)
        rows = cur.rowcount
        conn.commit()

        updated += rows
        pct = (updated / total * 100) if total > 0 else 0
        print(f"  Batch {batch}: assigned {rows} carriers (total {updated:,} / {total:,} = {pct:.1f}%)")

        if rows == 0:
            # Check if there are still unassigned carriers (might be outside US boundaries)
            cur.execute("""
                SELECT COUNT(*) FROM carriers
                WHERE location IS NOT NULL AND county_geoid IS NULL
            """)
            remaining = cur.fetchone()[0]
            if remaining > 0:
                print(f"  {remaining:,} carriers could not be assigned to a county (outside boundaries)")
            break

    return updated


def refresh_materialized_view(conn) -> None:
    """Refresh county_carrier_stats materialized view."""
    cur = conn.cursor()
    print("  Refreshing county_carrier_stats materialized view...")
    cur.execute("REFRESH MATERIALIZED VIEW county_carrier_stats")
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM county_carrier_stats WHERE carrier_count > 0")
    count = cur.fetchone()[0]
    print(f"  {count} counties have carriers")


def main():
    print("=" * 60)
    print("CarrierWatch County Setup")
    print("=" * 60)

    # Step 1: Run migration
    print("\n[1/5] Running database migration...")
    migration_path = os.path.join(os.path.dirname(__file__), "..", "database", "005_counties.sql")
    if os.path.exists(migration_path):
        result = subprocess.run(
            ["psql", DATABASE_URL, "-f", migration_path],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"  Migration FAILED (exit code {result.returncode})")
            if result.stderr:
                print(f"  stderr: {result.stderr}")
            sys.exit(1)
        print("  Migration applied")
    else:
        print(f"  Warning: {migration_path} not found, skipping migration")

    # Step 2: Download
    print("\n[2/5] Downloading county boundaries...")
    zip_path = download_counties()

    # Step 3: Load shapefile
    print("\n[3/5] Loading shapefile into PostGIS...")
    load_shapefile(zip_path)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    try:
        # Step 3b: Transform to final table
        print("\n[3b] Transforming to us_counties table...")
        county_count = transform_counties(conn)

        # Step 4: Backfill carrier county assignments
        print(f"\n[4/5] Backfilling carriers.county_geoid ({county_count} counties)...")
        updated = backfill_county_geoid(conn)
        print(f"  Total carriers assigned: {updated:,}")

        # Step 5: Refresh materialized view
        print("\n[5/5] Refreshing materialized view...")
        refresh_materialized_view(conn)

    finally:
        conn.close()

    print("\n" + "=" * 60)
    print("County setup complete!")
    print("Next: restart Martin to pick up county_choropleth_mvt function")
    print("=" * 60)


if __name__ == "__main__":
    main()
