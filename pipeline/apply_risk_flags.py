"""
CarrierWatch — Apply all risk flags that require carrier table updates.

Run this AFTER geocoding completes to avoid deadlocks.
Applies: officer-based flags, authority revocation flags, ELD violation flags.
Safe to re-run — checks for existing flags before applying.
"""
from __future__ import annotations

import logging

import psycopg2

from config import DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


def batch_update(conn, label, sql, batch_size=5000):
    """Run a batched UPDATE to avoid long locks."""
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


def main():
    log.info("=== Applying Risk Flags ===")
    conn = psycopg2.connect(DATABASE_URL)

    try:
        # 1. Officer 25+ carriers
        log.info("Applying OFFICER_25_PLUS flags...")
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

        # 2. Officer 10+ carriers
        log.info("Applying OFFICER_10_PLUS flags...")
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

        # 3. Officer 5+ carriers
        log.info("Applying OFFICER_5_PLUS flags...")
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

        # 4. Authority revoked/reissued
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

        # 5. ELD violations 5+ (only if violations data exists)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM inspection_violations")
            viol_count = cur.fetchone()[0]

        if viol_count > 0:
            log.info("Applying ELD_VIOLATIONS_5_PLUS flags...")
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE carriers c SET
                        risk_score = COALESCE(risk_score, 0) + 25,
                        risk_flags = array_append(COALESCE(risk_flags, '{}'), 'ELD_VIOLATIONS_5_PLUS')
                    WHERE c.eld_violations >= 5
                      AND NOT ('ELD_VIOLATIONS_5_PLUS' = ANY(COALESCE(c.risk_flags, '{}')))
                """)
                eld_flagged = cur.rowcount
                conn.commit()
                log.info("  ELD_VIOLATIONS_5_PLUS: %d", eld_flagged)
        else:
            log.info("No violation records found — skipping ELD flags")

        # Final stats
        with conn.cursor() as cur:
            cur.execute("""
                SELECT unnest(risk_flags) AS flag, COUNT(*)
                FROM carriers WHERE risk_flags IS NOT NULL AND array_length(risk_flags, 1) > 0
                GROUP BY flag ORDER BY count DESC
            """)
            flags = cur.fetchall()

        log.info("=== Final Risk Flag Distribution ===")
        for flag, count in flags:
            log.info("  %s: %d", flag, count)

    finally:
        conn.close()

    log.info("=== Risk Flags Complete ===")


if __name__ == "__main__":
    main()
