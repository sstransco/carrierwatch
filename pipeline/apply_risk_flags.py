"""
CarrierWatch — Authoritative risk scoring engine.

This is the SINGLE SOURCE OF TRUTH for all risk flags and scores.
Run with --reset to clear all flags and recompute from scratch.
Run without --reset to incrementally apply missing flags.

Applies all 23+ flags:
  - Address overlap (5+/10+/25+)
  - Officer identity clusters (5+/10+/25+) via officer_network_clusters
  - Foreign carrier / foreign mailing / foreign-linked address/officer
  - Authority: revoked/reissued, new authority
  - Safety: fatal crashes, high crash count, high vehicle OOS, high driver OOS
  - ELD violation rate
  - Insurance lapse (no current active policy, AUTHORIZED carriers only)
  - PPP loan / large PPP loan / PPP forgiven cluster
  - PO box address / no physical address
  - Inactive status at clustered address

Safe to re-run — checks for existing flags before applying (unless --reset).
Run AFTER geocoding to avoid deadlocks.
"""
from __future__ import annotations

import argparse
import logging
import sys

import psycopg2

from config import DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def batch_update(conn, label, sql, batch_size=5000):
    """Run a batched UPDATE to avoid long locks.
    The SQL must contain a LIMIT %s placeholder."""
    total = 0
    while True:
        with conn.cursor() as cur:
            cur.execute(sql, (batch_size,))
            updated = cur.rowcount
        conn.commit()
        total += updated
        if updated > 0 and total % 50000 == 0:
            log.info("  %s: %d updated so far...", label, total)
        if updated == 0:
            break
    log.info("  %s: %d total", label, total)
    return total


def simple_update(conn, label, sql):
    """Run a single UPDATE (no batching, no %s placeholder)."""
    with conn.cursor() as cur:
        cur.execute(sql)
        updated = cur.rowcount
    conn.commit()
    log.info("  %s: %d total", label, updated)
    return updated


def reset_all_flags(conn):
    """Clear ALL risk_score and risk_flags on every carrier."""
    log.info("RESET MODE: Clearing all risk_score and risk_flags...")
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE carriers
            SET risk_score = 0, risk_flags = '{}'
            WHERE risk_score != 0 OR (risk_flags IS NOT NULL AND array_length(risk_flags, 1) > 0)
        """)
        cleared = cur.rowcount
    conn.commit()
    log.info("  Cleared flags on %d carriers", cleared)
    return cleared


def has_table(conn, table_name):
    """Check if a table exists in the database."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = %s AND table_schema = 'public'
            )
        """, (table_name,))
        return cur.fetchone()[0]


def has_rows(conn, table_name):
    """Check if a table has any rows."""
    with conn.cursor() as cur:
        cur.execute(f"SELECT EXISTS (SELECT 1 FROM {table_name} LIMIT 1)")
        return cur.fetchone()[0]


def main():
    parser = argparse.ArgumentParser(description="Apply risk flags to carriers")
    parser.add_argument("--reset", action="store_true",
                        help="Clear all flags/scores and recompute from scratch")
    args = parser.parse_args()

    log.info("=== Applying Risk Flags %s===", "(RESET MODE) " if args.reset else "")
    conn = psycopg2.connect(DATABASE_URL)

    # Check which tables are available
    has_clusters = has_table(conn, "officer_network_clusters") and has_rows(conn, "officer_network_clusters")
    has_violations = has_table(conn, "inspection_violations") and has_rows(conn, "inspection_violations")

    if has_clusters:
        log.info("Using officer_network_clusters for identity-aware officer flags")
    else:
        log.info("officer_network_clusters not available — falling back to raw name matching")

    try:
        if args.reset:
            reset_all_flags(conn)

        # ==================================================
        # GROUP 1: Address-based flags
        # ==================================================

        # 1a. ADDRESS_OVERLAP_25+ (50 pts)
        log.info("Applying ADDRESS_OVERLAP_25+ flags...")
        batch_update(conn, "ADDRESS_OVERLAP_25+", """
            WITH flagged AS (
                SELECT c.dot_number
                FROM carriers c
                JOIN address_clusters ac ON c.address_hash = ac.address_hash
                WHERE ac.carrier_count >= 25
                  AND NOT ('ADDRESS_OVERLAP_25+' = ANY(COALESCE(c.risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 50,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'ADDRESS_OVERLAP_25+')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 1b. ADDRESS_OVERLAP_10+ (35 pts) — excludes carriers already flagged 25+
        log.info("Applying ADDRESS_OVERLAP_10+ flags...")
        batch_update(conn, "ADDRESS_OVERLAP_10+", """
            WITH flagged AS (
                SELECT c.dot_number
                FROM carriers c
                JOIN address_clusters ac ON c.address_hash = ac.address_hash
                WHERE ac.carrier_count >= 10
                  AND NOT ('ADDRESS_OVERLAP_25+' = ANY(COALESCE(c.risk_flags, '{}')))
                  AND NOT ('ADDRESS_OVERLAP_10+' = ANY(COALESCE(c.risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 35,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'ADDRESS_OVERLAP_10+')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 1c. ADDRESS_OVERLAP_5+ (20 pts) — excludes 10+ and 25+
        log.info("Applying ADDRESS_OVERLAP_5+ flags...")
        batch_update(conn, "ADDRESS_OVERLAP_5+", """
            WITH flagged AS (
                SELECT c.dot_number
                FROM carriers c
                JOIN address_clusters ac ON c.address_hash = ac.address_hash
                WHERE ac.carrier_count >= 5
                  AND NOT ('ADDRESS_OVERLAP_25+' = ANY(COALESCE(c.risk_flags, '{}')))
                  AND NOT ('ADDRESS_OVERLAP_10+' = ANY(COALESCE(c.risk_flags, '{}')))
                  AND NOT ('ADDRESS_OVERLAP_5+' = ANY(COALESCE(c.risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 20,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'ADDRESS_OVERLAP_5+')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # ==================================================
        # GROUP 2: Officer-based flags (identity-cluster aware)
        # ==================================================

        if has_clusters:
            # Use officer_network_clusters — each cluster represents a disambiguated
            # identity, so "JOSE RODRIGUEZ cluster 0" != "JOSE RODRIGUEZ cluster 1"

            # 2a. OFFICER_25_PLUS (50 pts)
            log.info("Applying OFFICER_25_PLUS flags (identity clusters)...")
            batch_update(conn, "OFFICER_25_PLUS", """
                WITH big_clusters AS (
                    SELECT unnest(member_dot_numbers) AS dot_number
                    FROM officer_network_clusters
                    WHERE carrier_count >= 25
                ),
                flagged AS (
                    SELECT DISTINCT bc.dot_number
                    FROM big_clusters bc
                    JOIN carriers c ON c.dot_number = bc.dot_number
                    WHERE NOT ('OFFICER_25_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_10_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_5_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 50,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'OFFICER_25_PLUS')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)

            # 2b. OFFICER_10_PLUS (35 pts)
            log.info("Applying OFFICER_10_PLUS flags (identity clusters)...")
            batch_update(conn, "OFFICER_10_PLUS", """
                WITH mid_clusters AS (
                    SELECT unnest(member_dot_numbers) AS dot_number
                    FROM officer_network_clusters
                    WHERE carrier_count >= 10
                ),
                flagged AS (
                    SELECT DISTINCT mc.dot_number
                    FROM mid_clusters mc
                    JOIN carriers c ON c.dot_number = mc.dot_number
                    WHERE NOT ('OFFICER_25_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_10_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_5_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 35,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'OFFICER_10_PLUS')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)

            # 2c. OFFICER_5_PLUS (20 pts)
            log.info("Applying OFFICER_5_PLUS flags (identity clusters)...")
            batch_update(conn, "OFFICER_5_PLUS", """
                WITH small_clusters AS (
                    SELECT unnest(member_dot_numbers) AS dot_number
                    FROM officer_network_clusters
                    WHERE carrier_count >= 5
                ),
                flagged AS (
                    SELECT DISTINCT sc.dot_number
                    FROM small_clusters sc
                    JOIN carriers c ON c.dot_number = sc.dot_number
                    WHERE NOT ('OFFICER_25_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_10_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('OFFICER_5_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 20,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'OFFICER_5_PLUS')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)
        else:
            # Fallback: raw name matching (higher false positive rate for common names)
            log.info("Applying OFFICER_25_PLUS flags (raw name matching)...")
            batch_update(conn, "OFFICER_25_PLUS", """
                WITH flagged AS (
                    SELECT DISTINCT cp.dot_number
                    FROM carrier_principals cp
                    JOIN (
                        SELECT officer_name_normalized FROM carrier_principals
                        GROUP BY officer_name_normalized HAVING COUNT(DISTINCT dot_number) >= 25
                    ) oc ON cp.officer_name_normalized = oc.officer_name_normalized
                    WHERE cp.dot_number IN (
                        SELECT dot_number FROM carriers
                        WHERE NOT ('OFFICER_25_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                          AND NOT ('OFFICER_10_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                          AND NOT ('OFFICER_5_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                    )
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 50,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'OFFICER_25_PLUS')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)

            log.info("Applying OFFICER_10_PLUS flags (raw name matching)...")
            batch_update(conn, "OFFICER_10_PLUS", """
                WITH flagged AS (
                    SELECT DISTINCT cp.dot_number
                    FROM carrier_principals cp
                    JOIN (
                        SELECT officer_name_normalized FROM carrier_principals
                        GROUP BY officer_name_normalized HAVING COUNT(DISTINCT dot_number) >= 10
                    ) oc ON cp.officer_name_normalized = oc.officer_name_normalized
                    WHERE cp.dot_number IN (
                        SELECT dot_number FROM carriers
                        WHERE NOT ('OFFICER_25_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                          AND NOT ('OFFICER_10_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                          AND NOT ('OFFICER_5_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                    )
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 35,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'OFFICER_10_PLUS')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)

            log.info("Applying OFFICER_5_PLUS flags (raw name matching)...")
            batch_update(conn, "OFFICER_5_PLUS", """
                WITH flagged AS (
                    SELECT DISTINCT cp.dot_number
                    FROM carrier_principals cp
                    JOIN (
                        SELECT officer_name_normalized FROM carrier_principals
                        GROUP BY officer_name_normalized HAVING COUNT(DISTINCT dot_number) >= 5
                    ) oc ON cp.officer_name_normalized = oc.officer_name_normalized
                    WHERE cp.dot_number IN (
                        SELECT dot_number FROM carriers
                        WHERE NOT ('OFFICER_25_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                          AND NOT ('OFFICER_10_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                          AND NOT ('OFFICER_5_PLUS' = ANY(COALESCE(risk_flags, '{}')))
                    )
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 20,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'OFFICER_5_PLUS')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)

        # ==================================================
        # GROUP 3: Foreign carrier flags
        # ==================================================

        # 3a. FOREIGN_CARRIER (45 pts)
        log.info("Applying FOREIGN_CARRIER flags...")
        batch_update(conn, "FOREIGN_CARRIER", """
            WITH flagged AS (
                SELECT dot_number
                FROM carriers
                WHERE physical_country IS NOT NULL
                  AND physical_country != ''
                  AND physical_country != 'US'
                  AND NOT ('FOREIGN_CARRIER' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 45,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'FOREIGN_CARRIER')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 3b. FOREIGN_MAILING (30 pts) — domestic carrier with foreign mailing address
        log.info("Applying FOREIGN_MAILING flags...")
        batch_update(conn, "FOREIGN_MAILING", """
            WITH flagged AS (
                SELECT dot_number
                FROM carriers
                WHERE (physical_country = 'US' OR physical_country IS NULL OR physical_country = '')
                  AND mailing_country IS NOT NULL
                  AND mailing_country != ''
                  AND mailing_country != 'US'
                  AND NOT ('FOREIGN_MAILING' = ANY(COALESCE(risk_flags, '{}')))
                  AND NOT ('FOREIGN_CARRIER' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 30,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'FOREIGN_MAILING')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 3c. FOREIGN_LINKED_ADDRESS (35 pts) — US carrier shares address with foreign carrier
        log.info("Applying FOREIGN_LINKED_ADDRESS flags...")
        batch_update(conn, "FOREIGN_LINKED_ADDRESS", """
            WITH foreign_addresses AS (
                SELECT DISTINCT address_hash
                FROM carriers
                WHERE physical_country IS NOT NULL
                  AND physical_country != ''
                  AND physical_country != 'US'
                  AND address_hash IS NOT NULL
            ),
            flagged AS (
                SELECT DISTINCT c.dot_number
                FROM carriers c
                JOIN foreign_addresses fa ON c.address_hash = fa.address_hash
                WHERE (c.physical_country = 'US' OR c.physical_country IS NULL OR c.physical_country = '')
                  AND NOT ('FOREIGN_LINKED_ADDRESS' = ANY(COALESCE(c.risk_flags, '{}')))
                  AND NOT ('FOREIGN_CARRIER' = ANY(COALESCE(c.risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 35,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'FOREIGN_LINKED_ADDRESS')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 3d. FOREIGN_LINKED_OFFICER (35 pts) — US carrier shares officer identity with foreign carrier
        log.info("Applying FOREIGN_LINKED_OFFICER flags...")
        if has_clusters:
            # Identity-cluster-aware: find clusters that span both US and foreign carriers
            batch_update(conn, "FOREIGN_LINKED_OFFICER", """
                WITH foreign_clusters AS (
                    -- Clusters containing at least one foreign carrier
                    SELECT onc.id, onc.member_dot_numbers
                    FROM officer_network_clusters onc
                    WHERE EXISTS (
                        SELECT 1 FROM unnest(onc.member_dot_numbers) AS d(dot)
                        JOIN carriers c ON c.dot_number = d.dot
                        WHERE c.physical_country IS NOT NULL
                          AND c.physical_country != ''
                          AND c.physical_country != 'US'
                    )
                ),
                flagged AS (
                    SELECT DISTINCT d.dot AS dot_number
                    FROM foreign_clusters fc,
                         unnest(fc.member_dot_numbers) AS d(dot)
                    JOIN carriers c ON c.dot_number = d.dot
                    WHERE (c.physical_country = 'US' OR c.physical_country IS NULL OR c.physical_country = '')
                      AND NOT ('FOREIGN_LINKED_OFFICER' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('FOREIGN_CARRIER' = ANY(COALESCE(c.risk_flags, '{}')))
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 35,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'FOREIGN_LINKED_OFFICER')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)
        else:
            # Fallback: raw name matching
            batch_update(conn, "FOREIGN_LINKED_OFFICER", """
                WITH foreign_officers AS (
                    SELECT DISTINCT cp.officer_name_normalized
                    FROM carrier_principals cp
                    JOIN carriers c ON cp.dot_number = c.dot_number
                    WHERE c.physical_country IS NOT NULL
                      AND c.physical_country != ''
                      AND c.physical_country != 'US'
                ),
                flagged AS (
                    SELECT DISTINCT cp.dot_number
                    FROM carrier_principals cp
                    JOIN foreign_officers fo ON cp.officer_name_normalized = fo.officer_name_normalized
                    JOIN carriers c ON cp.dot_number = c.dot_number
                    WHERE (c.physical_country = 'US' OR c.physical_country IS NULL OR c.physical_country = '')
                      AND NOT ('FOREIGN_LINKED_OFFICER' = ANY(COALESCE(c.risk_flags, '{}')))
                      AND NOT ('FOREIGN_CARRIER' = ANY(COALESCE(c.risk_flags, '{}')))
                    LIMIT %s
                )
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 35,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'FOREIGN_LINKED_OFFICER')
                FROM flagged f WHERE c.dot_number = f.dot_number
            """)

        # ==================================================
        # GROUP 4: Authority flags
        # ==================================================

        # 4a. AUTHORITY_REVOKED_REISSUED (15 pts)
        log.info("Applying AUTHORITY_REVOKED_REISSUED flags...")
        batch_update(conn, "AUTH_REVOKED", """
            WITH flagged AS (
                SELECT DISTINCT ah.dot_number
                FROM authority_history ah
                WHERE (ah.common_rev_pend = 'Y' OR ah.contract_rev_pend = 'Y' OR ah.broker_rev_pend = 'Y')
                  AND ah.dot_number IN (
                      SELECT dot_number FROM carriers
                      WHERE NOT ('AUTHORITY_REVOKED_REISSUED' = ANY(COALESCE(risk_flags, '{}')))
                  )
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 15,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'AUTHORITY_REVOKED_REISSUED')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 4b. NEW_AUTHORITY (15 pts) — authority less than 1 year old
        log.info("Applying NEW_AUTHORITY flags...")
        batch_update(conn, "NEW_AUTHORITY", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE authority_grant_date > CURRENT_DATE - INTERVAL '1 year'
                  AND authority_grant_date IS NOT NULL
                  AND NOT ('NEW_AUTHORITY' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 15,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'NEW_AUTHORITY')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # ==================================================
        # GROUP 5: Safety flags
        # ==================================================

        # 5a. FATAL_CRASHES (25 pts)
        log.info("Applying FATAL_CRASHES flags...")
        batch_update(conn, "FATAL_CRASHES", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE fatal_crashes > 0
                  AND NOT ('FATAL_CRASHES' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 25,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'FATAL_CRASHES')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 5b. HIGH_CRASH_COUNT (15 pts) — 3+ crashes, non-fatal
        log.info("Applying HIGH_CRASH_COUNT flags...")
        batch_update(conn, "HIGH_CRASH_COUNT", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE total_crashes >= 3
                  AND fatal_crashes = 0
                  AND NOT ('HIGH_CRASH_COUNT' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 15,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'HIGH_CRASH_COUNT')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 5c. HIGH_VEHICLE_OOS (20 pts) — vehicle OOS rate > 30%
        log.info("Applying HIGH_VEHICLE_OOS flags...")
        batch_update(conn, "HIGH_VEHICLE_OOS", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE vehicle_oos_rate > 30
                  AND total_inspections > 0
                  AND NOT ('HIGH_VEHICLE_OOS' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 20,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'HIGH_VEHICLE_OOS')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 5d. HIGH_DRIVER_OOS (15 pts) — driver OOS rate > 20%
        log.info("Applying HIGH_DRIVER_OOS flags...")
        batch_update(conn, "HIGH_DRIVER_OOS", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE driver_oos_rate > 20
                  AND total_inspections > 0
                  AND NOT ('HIGH_DRIVER_OOS' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 15,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'HIGH_DRIVER_OOS')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 5e. HIGH_ELD_VIOLATION_RATE (25 pts)
        if has_violations:
            log.info("Applying HIGH_ELD_VIOLATION_RATE flags...")
            simple_update(conn, "HIGH_ELD_VIOLATION_RATE", """
                UPDATE carriers c SET
                    risk_score = COALESCE(risk_score, 0) + 25,
                    risk_flags = array_append(COALESCE(risk_flags, '{}'), 'HIGH_ELD_VIOLATION_RATE')
                WHERE (
                    (total_inspections >= 3 AND eld_violations::float / total_inspections > 0.3)
                    OR
                    (eld_violations >= 15 AND total_inspections < 3)
                )
                  AND NOT ('HIGH_ELD_VIOLATION_RATE' = ANY(COALESCE(c.risk_flags, '{}')))
            """)
        else:
            log.info("No violation records found — skipping ELD flags")

        # ==================================================
        # GROUP 6: Insurance lapse
        # ==================================================

        # INSURANCE_LAPSE (20 pts) — no currently-active policy, AUTHORIZED carriers only
        log.info("Applying INSURANCE_LAPSE flags...")
        batch_update(conn, "INSURANCE_LAPSE", """
            WITH flagged AS (
                SELECT DISTINCT c.dot_number
                FROM carriers c
                WHERE c.operating_status ILIKE 'AUTHORIZED%%'
                  AND NOT EXISTS (
                      SELECT 1 FROM insurance_history ih
                      WHERE ih.dot_number = c.dot_number
                        AND ih.effective_date <= CURRENT_DATE
                        AND (ih.cancl_effective_date IS NULL
                             OR ih.cancl_effective_date > CURRENT_DATE)
                  )
                  AND EXISTS (
                      SELECT 1 FROM insurance_history ih3
                      WHERE ih3.dot_number = c.dot_number
                  )
                  AND NOT ('INSURANCE_LAPSE' = ANY(COALESCE(c.risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 20,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'INSURANCE_LAPSE')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # ==================================================
        # GROUP 7: PPP loan flags
        # ==================================================

        # 7a. LARGE_PPP_LOAN (20 pts) — PPP loan > $100K
        log.info("Applying LARGE_PPP_LOAN flags...")
        batch_update(conn, "LARGE_PPP_LOAN", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE ppp_loan_total > 100000
                  AND NOT ('LARGE_PPP_LOAN' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 20,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'LARGE_PPP_LOAN')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 7b. PPP_LOAN (10 pts) — any PPP loan (not already flagged LARGE)
        log.info("Applying PPP_LOAN flags...")
        batch_update(conn, "PPP_LOAN", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE ppp_loan_count > 0
                  AND NOT ('LARGE_PPP_LOAN' = ANY(COALESCE(risk_flags, '{}')))
                  AND NOT ('PPP_LOAN' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 10,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'PPP_LOAN')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 7c. PPP_FORGIVEN_CLUSTER (15 pts) — PPP forgiven at multi-carrier address
        log.info("Applying PPP_FORGIVEN_CLUSTER flags...")
        batch_update(conn, "PPP_FORGIVEN_CLUSTER", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE ppp_forgiven_total > 0
                  AND address_hash IN (
                      SELECT address_hash FROM address_clusters WHERE carrier_count >= 3
                  )
                  AND NOT ('PPP_FORGIVEN_CLUSTER' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 15,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'PPP_FORGIVEN_CLUSTER')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # ==================================================
        # GROUP 8: Address quality flags
        # ==================================================

        # 8a. PO_BOX_ADDRESS (15 pts) — carriers should have physical domicile
        log.info("Applying PO_BOX_ADDRESS flags...")
        batch_update(conn, "PO_BOX_ADDRESS", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE (physical_address ILIKE '%%P.O.%%'
                    OR physical_address ILIKE '%%P O BOX%%'
                    OR physical_address ILIKE '%%PO BOX%%'
                    OR physical_address ILIKE '%%POB %%'
                    OR physical_address ILIKE '%%P.O BOX%%'
                    OR physical_address ILIKE 'BOX %%')
                  AND NOT ('PO_BOX_ADDRESS' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 15,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'PO_BOX_ADDRESS')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # 8b. NO_PHYSICAL_ADDRESS (10 pts)
        log.info("Applying NO_PHYSICAL_ADDRESS flags...")
        batch_update(conn, "NO_PHYSICAL_ADDRESS", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE (physical_address IS NULL OR TRIM(physical_address) = '')
                  AND NOT ('NO_PHYSICAL_ADDRESS' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 10,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'NO_PHYSICAL_ADDRESS')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # ==================================================
        # GROUP 9: Inactive status at clustered address
        # ==================================================

        log.info("Applying INACTIVE_STATUS flags...")
        batch_update(conn, "INACTIVE_STATUS", """
            WITH flagged AS (
                SELECT dot_number FROM carriers
                WHERE operating_status_code = 'I'
                  AND address_hash IN (
                      SELECT address_hash FROM address_clusters WHERE carrier_count >= 3
                  )
                  AND NOT ('INACTIVE_STATUS' = ANY(COALESCE(risk_flags, '{}')))
                LIMIT %s
            )
            UPDATE carriers c SET
                risk_score = COALESCE(risk_score, 0) + 10,
                risk_flags = array_append(COALESCE(risk_flags, '{}'), 'INACTIVE_STATUS')
            FROM flagged f WHERE c.dot_number = f.dot_number
        """)

        # ==================================================
        # Final stats
        # ==================================================

        with conn.cursor() as cur:
            cur.execute("""
                SELECT unnest(risk_flags) AS flag, COUNT(*)
                FROM carriers WHERE risk_flags IS NOT NULL AND array_length(risk_flags, 1) > 0
                GROUP BY flag ORDER BY count DESC
            """)
            flags = cur.fetchall()

        log.info("=== Final Risk Flag Distribution ===")
        for flag, count in flags:
            log.info("  %-30s %d", flag, count)

        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM carriers WHERE risk_score >= 50
            """)
            high_risk = cur.fetchone()[0]
        log.info("High-risk carriers (score >= 50): %d", high_risk)

    finally:
        conn.close()

    log.info("=== Risk Flags Complete ===")


if __name__ == "__main__":
    main()
