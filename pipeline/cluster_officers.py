"""
Officer Identity Resolution — Link Scoring & Clustering

For each officer name with 2+ carriers, finds carriers linked by
overlapping signals (phone, email, address, co-officers) and groups
them into confirmed clusters using union-find.

Safe to run while site is live — reads carrier_principals/carriers,
writes only to officer_network_clusters (new table). Uses small
batches and doesn't lock existing tables.

Usage:
    DATABASE_URL=postgresql://... python3 cluster_officers.py
"""
from __future__ import annotations

import os
import sys
import time
from collections import defaultdict

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://carrierwatch:carrierwatch_dev_2024@localhost:5433/carrierwatch",
)

BATCH_SIZE = 500  # officers per batch


# ── Union-Find ──────────────────────────────────────────────────────
class UnionFind:
    def __init__(self, elements: list[int]):
        self.parent = {e: e for e in elements}
        self.rank = {e: 0 for e in elements}

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1

    def clusters(self) -> dict[int, list[int]]:
        groups: dict[int, list[int]] = defaultdict(list)
        for e in self.parent:
            groups[self.find(e)].append(e)
        return dict(groups)


# ── Signal detection ────────────────────────────────────────────────
def find_links(
    carriers: list[dict],
    co_officer_map: dict[int, set[str]],
    officer_name: str,
) -> list[tuple[int, int, set[str]]]:
    """
    For a list of carriers under the same officer name, find pairs
    linked by shared signals. Returns [(dot_a, dot_b, {signals})].
    """
    links: list[tuple[int, int, set[str]]] = []
    n = len(carriers)

    # Index carriers by signal for O(n) grouping instead of O(n^2) pairwise
    by_phone: dict[str, list[int]] = defaultdict(list)
    by_email: dict[str, list[int]] = defaultdict(list)
    by_address: dict[str, list[int]] = defaultdict(list)
    by_state: dict[str, list[int]] = defaultdict(list)

    for c in carriers:
        dot = c["dot_number"]
        if c["phone"] and len(c["phone"]) >= 7:
            by_phone[c["phone"]].append(dot)
        if c["email"] and "@" in c["email"]:
            by_email[c["email"].lower()].append(dot)
        if c["address_hash"]:
            by_address[c["address_hash"]].append(dot)
        if c["physical_state"]:
            by_state[c["physical_state"]].append(dot)

    # Collect pairwise links from each signal group
    pair_signals: dict[tuple[int, int], set[str]] = defaultdict(set)

    for signal_name, groups in [
        ("phone", by_phone),
        ("email", by_email),
        ("address", by_address),
    ]:
        for _key, dots in groups.items():
            if len(dots) < 2:
                continue
            for i in range(len(dots)):
                for j in range(i + 1, len(dots)):
                    a, b = min(dots[i], dots[j]), max(dots[i], dots[j])
                    pair_signals[(a, b)].add(signal_name)

    # Co-officer signal: carriers that share another officer besides this one
    # Group by co-officer name
    co_groups: dict[str, list[int]] = defaultdict(list)
    for dot, co_names in co_officer_map.items():
        for co_name in co_names:
            if co_name != officer_name:
                co_groups[co_name].append(dot)

    for _co_name, dots in co_groups.items():
        if len(dots) < 2:
            continue
        for i in range(len(dots)):
            for j in range(i + 1, len(dots)):
                a, b = min(dots[i], dots[j]), max(dots[i], dots[j])
                pair_signals[(a, b)].add("co_officer")

    # State overlap is weak — only count if combined with another signal
    for _key, dots in by_state.items():
        if len(dots) < 2:
            continue
        for i in range(len(dots)):
            for j in range(i + 1, len(dots)):
                a, b = min(dots[i], dots[j]), max(dots[i], dots[j])
                if (a, b) in pair_signals:  # only add if already linked
                    pair_signals[(a, b)].add("same_state")

    return [(a, b, sigs) for (a, b), sigs in pair_signals.items()]


# ── Main ────────────────────────────────────────────────────────────
def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("Officer Identity Resolution — Link Scoring & Clustering")
    print("=" * 60)

    # Get all officer names with 2+ carriers
    cur.execute("""
        SELECT officer_name_normalized, carrier_count
        FROM officer_carrier_counts
        WHERE carrier_count >= 2
        ORDER BY carrier_count DESC
    """)
    officers = cur.fetchall()
    total = len(officers)
    print(f"Officers to process: {total:,}")

    # Clear old data
    cur.execute("TRUNCATE officer_network_clusters RESTART IDENTITY")
    conn.commit()

    processed = 0
    clusters_total = 0
    confirmed_total = 0
    start = time.time()

    for batch_start in range(0, total, BATCH_SIZE):
        batch = officers[batch_start : batch_start + BATCH_SIZE]
        names = [o["officer_name_normalized"] for o in batch]

        # Fetch all carrier_principals for this batch of officers
        cur.execute("""
            SELECT cp.officer_name_normalized, cp.dot_number, cp.phone, cp.email,
                   c.address_hash, c.physical_state,
                   COALESCE(c.risk_score, 0) AS risk_score,
                   COALESCE(c.total_crashes, 0) AS total_crashes,
                   COALESCE(c.fatal_crashes, 0) AS fatal_crashes,
                   COALESCE(c.power_units, 0) AS power_units,
                   COALESCE(c.ppp_loan_total, 0) AS ppp_total
            FROM carrier_principals cp
            JOIN carriers c ON c.dot_number = cp.dot_number
            WHERE cp.officer_name_normalized = ANY(%s)
        """, (names,))
        rows = cur.fetchall()

        # Group by officer name
        by_officer: dict[str, list[dict]] = defaultdict(list)
        for r in rows:
            by_officer[r["officer_name_normalized"]].append(r)

        # Fetch co-officers for all dot_numbers in this batch
        all_dots = list({r["dot_number"] for r in rows})
        co_officer_by_dot: dict[int, set[str]] = defaultdict(set)

        if all_dots:
            # Process in chunks to avoid huge IN clauses
            for chunk_start in range(0, len(all_dots), 5000):
                chunk = all_dots[chunk_start : chunk_start + 5000]
                cur.execute("""
                    SELECT dot_number, officer_name_normalized
                    FROM carrier_principals
                    WHERE dot_number = ANY(%s)
                """, (chunk,))
                for r2 in cur.fetchall():
                    co_officer_by_dot[r2["dot_number"]].add(
                        r2["officer_name_normalized"]
                    )

        # Process each officer
        insert_rows = []
        for officer_name in names:
            carriers = by_officer.get(officer_name, [])
            if len(carriers) < 2:
                continue

            dot_numbers = [c["dot_number"] for c in carriers]
            carrier_map = {c["dot_number"]: c for c in carriers}

            # Build co-officer map limited to this officer's carriers
            officer_co_map = {
                dot: co_officer_by_dot.get(dot, set())
                for dot in dot_numbers
            }

            # Find linked pairs
            links = find_links(carriers, officer_co_map, officer_name)

            # Union-find clustering
            uf = UnionFind(dot_numbers)
            cluster_signals: dict[tuple[int, int], set[str]] = {}
            for a, b, sigs in links:
                uf.union(a, b)
                cluster_signals[(a, b)] = sigs

            # Build clusters
            components = uf.clusters()

            # Collect all signals used in each cluster
            for idx, (root, members) in enumerate(
                sorted(components.items(), key=lambda x: -len(x[1]))
            ):
                member_set = set(members)
                signals_used: set[str] = set()
                for (a, b), sigs in cluster_signals.items():
                    if a in member_set or b in member_set:
                        signals_used |= sigs

                # If single carrier or no confirming signals, mark as unconfirmed
                if len(members) == 1:
                    signals_used = {"name_only"}

                # Compute stats
                crashes = sum(carrier_map[d]["total_crashes"] for d in members if d in carrier_map)
                fatal = sum(carrier_map[d]["fatal_crashes"] for d in members if d in carrier_map)
                units = sum(carrier_map[d]["power_units"] for d in members if d in carrier_map)
                risk_scores = [carrier_map[d]["risk_score"] for d in members if d in carrier_map]
                avg_risk = sum(risk_scores) / len(risk_scores) if risk_scores else 0
                ppp = sum(float(carrier_map[d]["ppp_total"]) for d in members if d in carrier_map)
                states = sorted({carrier_map[d]["physical_state"] for d in members if d in carrier_map and carrier_map[d]["physical_state"]})

                insert_rows.append((
                    officer_name,
                    idx,
                    sorted(members),
                    len(members),
                    sorted(signals_used),
                    crashes,
                    fatal,
                    units,
                    round(avg_risk, 1),
                    round(ppp, 2),
                    states,
                ))

                clusters_total += 1
                if len(members) >= 2 and signals_used != {"name_only"}:
                    confirmed_total += 1

        # Bulk insert
        if insert_rows:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO officer_network_clusters
                    (officer_name_normalized, cluster_index, member_dot_numbers,
                     carrier_count, link_signals, total_crashes, fatal_crashes,
                     total_units, avg_risk_score, ppp_total, states)
                VALUES %s
                """,
                insert_rows,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            )
            conn.commit()

        processed += len(batch)
        elapsed = time.time() - start
        rate = processed / elapsed if elapsed > 0 else 0
        print(
            f"  {processed:,}/{total:,} officers "
            f"({clusters_total:,} clusters, {confirmed_total:,} confirmed) "
            f"[{rate:.0f}/s]",
            end="\r",
        )

    print()
    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.1f}s")
    print(f"Total clusters: {clusters_total:,}")
    print(f"Confirmed multi-carrier clusters: {confirmed_total:,}")

    # Summary stats
    cur.execute("""
        SELECT
            COUNT(*) AS total_clusters,
            COUNT(*) FILTER (WHERE carrier_count >= 2 AND NOT (link_signals = ARRAY['name_only'])) AS confirmed,
            COUNT(*) FILTER (WHERE carrier_count >= 5 AND NOT (link_signals = ARRAY['name_only'])) AS confirmed_5plus,
            COUNT(*) FILTER (WHERE carrier_count >= 10 AND NOT (link_signals = ARRAY['name_only'])) AS confirmed_10plus,
            COUNT(*) FILTER (WHERE carrier_count >= 25 AND NOT (link_signals = ARRAY['name_only'])) AS confirmed_25plus,
            MAX(carrier_count) AS max_cluster_size
        FROM officer_network_clusters
    """)
    stats = cur.fetchone()
    print(f"\nCluster stats:")
    for k, v in stats.items():
        print(f"  {k}: {v:,}" if isinstance(v, int) else f"  {k}: {v}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
