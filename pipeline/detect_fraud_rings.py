"""
CarrierWatch — Fraud ring detection pipeline.

Builds connected components from the carrier-officer bipartite graph.
A "fraud ring" is a group of 3+ carriers connected by sharing 2+ officers
(using identity clusters when available, raw names as fallback).

Also computes insurance company stats materialized view.

Usage:
    cd pipeline && DATABASE_URL=postgresql://... python3 detect_fraud_rings.py
"""
from __future__ import annotations

import logging
from collections import defaultdict

import psycopg2
import psycopg2.extras

from config import DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

MIN_SHARED_OFFICERS = 2   # minimum shared officers to form an edge
MIN_RING_SIZE = 3          # minimum carriers in a ring


class UnionFind:
    """Weighted union-find with path compression."""

    def __init__(self):
        self.parent = {}
        self.rank = {}

    def find(self, x):
        if x not in self.parent:
            self.parent[x] = x
            self.rank[x] = 0
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, x, y):
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return
        if self.rank[rx] < self.rank[ry]:
            rx, ry = ry, rx
        self.parent[ry] = rx
        if self.rank[rx] == self.rank[ry]:
            self.rank[rx] += 1

    def components(self):
        """Return dict of root → set of members."""
        groups = defaultdict(set)
        for node in self.parent:
            groups[self.find(node)].add(node)
        return groups


def has_table(conn, table_name):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = %s AND table_schema = 'public'
            )
        """, (table_name,))
        return cur.fetchone()[0]


def build_officer_edges(conn):
    """
    Build edges between carriers that share officers.
    Returns dict: (dot_a, dot_b) → set of shared officer names.
    """
    use_clusters = has_table(conn, "officer_network_clusters")
    cur = conn.cursor()

    if use_clusters:
        log.info("Building edges from officer_network_clusters...")
        # Each cluster has member_dot_numbers — all pairs within a cluster share
        # that identity. We need pairs sharing 2+ distinct cluster identities.
        cur.execute("""
            SELECT member_dot_numbers, officer_name_normalized, cluster_index
            FROM officer_network_clusters
            WHERE carrier_count >= 2
        """)
    else:
        log.info("Building edges from carrier_principals (raw names)...")
        # Group carriers by officer name
        cur.execute("""
            SELECT array_agg(DISTINCT dot_number), officer_name_normalized, 0
            FROM carrier_principals
            WHERE officer_name_normalized IS NOT NULL
            GROUP BY officer_name_normalized
            HAVING COUNT(DISTINCT dot_number) >= 2
        """)

    # Build pair → shared officer count
    pair_officers = defaultdict(set)
    rows_processed = 0

    for member_dots, officer_name, cluster_idx in cur:
        if not member_dots or len(member_dots) < 2:
            continue
        # Create identity key
        identity_key = f"{officer_name}:{cluster_idx}" if use_clusters else officer_name
        # All pairs within this group share this identity
        dots = sorted(set(member_dots))
        for i in range(len(dots)):
            for j in range(i + 1, min(i + 50, len(dots))):  # cap to avoid O(n^2) explosion
                pair = (dots[i], dots[j])
                pair_officers[pair].add(identity_key)
        rows_processed += 1
        if rows_processed % 50000 == 0:
            log.info("  Processed %d groups, %d edges so far...", rows_processed, len(pair_officers))

    log.info("  Total groups processed: %d", rows_processed)
    log.info("  Raw edges (any shared officer): %d", len(pair_officers))

    # Filter to pairs sharing MIN_SHARED_OFFICERS+ officers
    strong_edges = {
        pair: officers
        for pair, officers in pair_officers.items()
        if len(officers) >= MIN_SHARED_OFFICERS
    }
    log.info("  Strong edges (%d+ shared officers): %d", MIN_SHARED_OFFICERS, len(strong_edges))

    return strong_edges


def find_rings(edges):
    """Build connected components from edges using union-find."""
    uf = UnionFind()

    for (dot_a, dot_b) in edges:
        uf.union(dot_a, dot_b)

    components = uf.components()

    # Filter to rings of MIN_RING_SIZE+
    rings = {root: members for root, members in components.items() if len(members) >= MIN_RING_SIZE}
    log.info("Connected components with %d+ carriers: %d", MIN_RING_SIZE, len(rings))

    return rings


def save_rings(conn, rings, edges):
    """Save fraud rings to the database."""
    cur = conn.cursor()

    # Clear existing
    cur.execute("TRUNCATE fraud_rings RESTART IDENTITY")
    conn.commit()

    # For each ring, gather stats
    ring_data = []
    for root, member_dots in rings.items():
        dots = sorted(member_dots)
        # Collect shared officers for this ring
        ring_officers = set()
        ring_addresses = set()
        for (a, b), officers in edges.items():
            if a in member_dots and b in member_dots:
                ring_officers.update(officers)

        ring_data.append((dots, list(ring_officers)))

    if not ring_data:
        log.info("No rings to save")
        return 0

    # Batch insert with stats from carriers table
    log.info("Saving %d fraud rings...", len(ring_data))
    saved = 0

    for dots, officers in ring_data:
        # Clean officer names (remove cluster suffix for display)
        display_officers = list(set(o.split(":")[0] for o in officers))

        cur.execute("""
            WITH ring_stats AS (
                SELECT
                    COUNT(*) AS carrier_count,
                    COUNT(*) FILTER (WHERE operating_status ILIKE 'AUTHORIZED%%') AS active_count,
                    COALESCE(SUM(total_crashes), 0) AS total_crashes,
                    COALESCE(SUM(fatal_crashes), 0) AS total_fatalities,
                    COALESCE(SUM(COALESCE(risk_score, 0)), 0) AS combined_risk,
                    array_agg(DISTINCT address_hash) FILTER (WHERE address_hash IS NOT NULL) AS addresses
                FROM carriers
                WHERE dot_number = ANY(%s)
            )
            INSERT INTO fraud_rings (
                carrier_dots, officer_names, shared_addresses,
                carrier_count, active_count, total_crashes, total_fatalities,
                combined_risk, detection_signals, confidence
            )
            SELECT
                %s,
                %s,
                COALESCE(rs.addresses, '{}'),
                rs.carrier_count,
                rs.active_count,
                rs.total_crashes,
                rs.total_fatalities,
                rs.combined_risk,
                ARRAY['shared_officers'],
                CASE
                    WHEN rs.carrier_count >= 10 AND rs.total_fatalities > 0 THEN 'high'
                    WHEN rs.carrier_count >= 5 OR rs.total_crashes > 5 THEN 'medium'
                    ELSE 'low'
                END
            FROM ring_stats rs
        """, (dots, dots, display_officers))
        saved += 1

        if saved % 1000 == 0:
            conn.commit()
            log.info("  Saved %d rings...", saved)

    conn.commit()
    log.info("  Total rings saved: %d", saved)
    return saved


def apply_fraud_ring_flags(conn):
    """Flag carriers that are part of medium/high confidence fraud rings."""
    cur = conn.cursor()

    log.info("Applying FRAUD_RING risk flags...")
    cur.execute("""
        WITH ring_members AS (
            SELECT DISTINCT unnest(carrier_dots) AS dot_number
            FROM fraud_rings
            WHERE confidence IN ('medium', 'high')
        )
        UPDATE carriers c SET
            risk_score = COALESCE(risk_score, 0) + 25,
            risk_flags = array_append(COALESCE(risk_flags, '{}'), 'FRAUD_RING')
        FROM ring_members rm
        WHERE c.dot_number = rm.dot_number
          AND NOT ('FRAUD_RING' = ANY(COALESCE(c.risk_flags, '{}')))
    """)
    flagged = cur.rowcount
    conn.commit()
    log.info("  FRAUD_RING: %d carriers flagged", flagged)
    return flagged


def refresh_insurance_stats(conn):
    """Refresh the insurance_company_stats materialized view."""
    cur = conn.cursor()

    # Check if the materialized view exists
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM pg_matviews WHERE matviewname = 'insurance_company_stats'
        )
    """)
    if not cur.fetchone()[0]:
        log.info("insurance_company_stats materialized view does not exist, skipping")
        return

    log.info("Refreshing insurance_company_stats materialized view...")
    cur.execute("REFRESH MATERIALIZED VIEW insurance_company_stats")
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM insurance_company_stats")
    count = cur.fetchone()[0]
    log.info("  Insurance companies: %d", count)

    cur.execute("""
        SELECT insurance_company, carriers_insured, cancellation_rate, high_risk_carriers
        FROM insurance_company_stats
        ORDER BY carriers_insured DESC
        LIMIT 10
    """)
    log.info("  Top 10 insurance companies by carriers insured:")
    for company, insured, cancel_rate, high_risk in cur.fetchall():
        log.info("    %s: %d insured, %.1f%% cancel rate, %d high-risk",
                 company[:50], insured, float(cancel_rate or 0), high_risk or 0)


def compute_peer_benchmarks(conn):
    """Compute fleet_size_bucket, peer_crash_percentile, peer_oos_percentile."""
    cur = conn.cursor()

    log.info("Computing peer benchmarks...")

    # Step 1: Assign fleet size buckets
    cur.execute("""
        UPDATE carriers SET fleet_size_bucket = CASE
            WHEN power_units <= 0 OR power_units IS NULL THEN 'unknown'
            WHEN power_units = 1 THEN '1'
            WHEN power_units <= 5 THEN '2-5'
            WHEN power_units <= 20 THEN '6-20'
            WHEN power_units <= 100 THEN '21-100'
            WHEN power_units <= 500 THEN '101-500'
            ELSE '500+'
        END
        WHERE fleet_size_bucket IS NULL OR fleet_size_bucket = ''
    """)
    bucketed = cur.rowcount
    conn.commit()
    log.info("  Fleet size buckets assigned: %d", bucketed)

    # Step 2: Compute crash percentile within peer group
    cur.execute("""
        WITH peer_stats AS (
            SELECT
                dot_number,
                fleet_size_bucket,
                PERCENT_RANK() OVER (
                    PARTITION BY fleet_size_bucket
                    ORDER BY total_crashes
                ) AS crash_pctile,
                PERCENT_RANK() OVER (
                    PARTITION BY fleet_size_bucket
                    ORDER BY vehicle_oos_rate
                ) AS oos_pctile
            FROM carriers
            WHERE fleet_size_bucket != 'unknown'
              AND total_inspections > 0
        )
        UPDATE carriers c SET
            peer_crash_percentile = (ps.crash_pctile * 100)::real,
            peer_oos_percentile = (ps.oos_pctile * 100)::real
        FROM peer_stats ps
        WHERE c.dot_number = ps.dot_number
    """)
    benchmarked = cur.rowcount
    conn.commit()
    log.info("  Peer benchmarks computed: %d carriers", benchmarked)

    # Show outlier stats
    cur.execute("""
        SELECT COUNT(*) FROM carriers
        WHERE peer_crash_percentile >= 95
    """)
    top_5_crash = cur.fetchone()[0]
    cur.execute("""
        SELECT COUNT(*) FROM carriers
        WHERE peer_oos_percentile >= 95
    """)
    top_5_oos = cur.fetchone()[0]
    log.info("  Top 5%% crash outliers: %d", top_5_crash)
    log.info("  Top 5%% OOS outliers: %d", top_5_oos)


def main():
    log.info("=" * 60)
    log.info("CarrierWatch — Fraud Ring Detection & Analytics")
    log.info("=" * 60)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    try:
        # Phase 1: Build fraud rings
        log.info("\n[1/4] Building officer-carrier edges...")
        edges = build_officer_edges(conn)

        if edges:
            log.info("\n[2/4] Finding connected components...")
            rings = find_rings(edges)

            if rings:
                save_rings(conn, rings, edges)
                apply_fraud_ring_flags(conn)
            else:
                log.info("No fraud rings detected")
        else:
            log.info("No strong edges found, skipping ring detection")

        # Phase 2: Insurance company stats
        log.info("\n[3/4] Insurance company analysis...")
        refresh_insurance_stats(conn)

        # Phase 3: Peer benchmarking
        log.info("\n[4/4] Peer benchmarking...")
        compute_peer_benchmarks(conn)

    finally:
        conn.close()

    log.info("=" * 60)
    log.info("Fraud ring detection & analytics complete!")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
