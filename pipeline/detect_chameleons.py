"""
CarrierWatch — Chameleon carrier detection pipeline.

Detects carriers that shut down and reopen under new DOT numbers to evade
safety records. Matches predecessor→successor pairs using:
  1. Same address_hash (same physical address)
  2. Shared officers (via carrier_principals)
  3. Same phone number
  4. Temporal proximity (deactivation → activation within 365 days)

Scoring:
  - 1 signal  → low confidence
  - 2 signals → medium confidence
  - 3+ signals → high confidence

Usage:
    cd pipeline && DATABASE_URL=postgresql://... python3 detect_chameleons.py
"""
from __future__ import annotations

import logging

import psycopg2
import psycopg2.extras

from config import DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# Only consider deactivations within this many days before a new activation
MAX_GAP_DAYS = 365

# Batch size for inserts
BATCH_SIZE = 5000


def detect_chameleon_pairs(conn):
    """
    Find predecessor→successor chameleon pairs.

    Strategy:
    1. Find all inactive carriers (deactivated) with known deactivation signals
    2. For each, find newly-activated carriers within MAX_GAP_DAYS that share
       address, officers, or phone
    3. Score each pair by number of matching signals
    """
    cur = conn.cursor()

    # Clear existing pairs
    log.info("Clearing existing chameleon_pairs...")
    cur.execute("TRUNCATE chameleon_pairs RESTART IDENTITY")
    conn.commit()

    # Step 1: Find address-based matches
    # Inactive carrier at address X, active carrier at address X, activated within gap
    log.info("Detecting address-based chameleon pairs...")
    cur.execute("""
        INSERT INTO chameleon_pairs (predecessor_dot, successor_dot, deactivation_date, activation_date, days_gap, match_signals, signal_count, confidence)
        SELECT
            pred.dot_number AS predecessor_dot,
            succ.dot_number AS successor_dot,
            pred.authority_grant_date AS deactivation_date,
            succ.authority_grant_date AS activation_date,
            EXTRACT(DAY FROM succ.authority_grant_date - pred.authority_grant_date)::integer AS days_gap,
            ARRAY['address'] AS match_signals,
            1 AS signal_count,
            'low' AS confidence
        FROM carriers pred
        JOIN carriers succ ON pred.address_hash = succ.address_hash
            AND pred.dot_number != succ.dot_number
        WHERE pred.operating_status_code != 'A'
          AND succ.operating_status ILIKE 'AUTHORIZED%%'
          AND pred.address_hash IS NOT NULL
          AND succ.authority_grant_date IS NOT NULL
          AND pred.authority_grant_date IS NOT NULL
          AND succ.authority_grant_date > pred.authority_grant_date
          AND succ.authority_grant_date - pred.authority_grant_date <= %s
        ON CONFLICT DO NOTHING
    """, (MAX_GAP_DAYS,))
    addr_pairs = cur.rowcount
    conn.commit()
    log.info("  Address-based pairs: %d", addr_pairs)

    # Step 2: Find officer-based matches
    # Different carriers sharing an officer, one inactive → one active, within gap
    log.info("Detecting officer-based chameleon pairs...")
    cur.execute("""
        WITH officer_pairs AS (
            SELECT DISTINCT
                cp1.dot_number AS predecessor_dot,
                cp2.dot_number AS successor_dot
            FROM carrier_principals cp1
            JOIN carrier_principals cp2
                ON cp1.officer_name_normalized = cp2.officer_name_normalized
                AND cp1.dot_number != cp2.dot_number
            JOIN carriers pred ON cp1.dot_number = pred.dot_number
            JOIN carriers succ ON cp2.dot_number = succ.dot_number
            WHERE pred.operating_status_code != 'A'
              AND succ.operating_status ILIKE 'AUTHORIZED%%'
              AND succ.authority_grant_date IS NOT NULL
              AND pred.authority_grant_date IS NOT NULL
              AND succ.authority_grant_date > pred.authority_grant_date
              AND succ.authority_grant_date - pred.authority_grant_date <= %s
        )
        INSERT INTO chameleon_pairs (predecessor_dot, successor_dot, deactivation_date, activation_date, days_gap, match_signals, signal_count, confidence)
        SELECT
            op.predecessor_dot,
            op.successor_dot,
            pred.authority_grant_date,
            succ.authority_grant_date,
            EXTRACT(DAY FROM succ.authority_grant_date - pred.authority_grant_date)::integer,
            ARRAY['officer'],
            1,
            'low'
        FROM officer_pairs op
        JOIN carriers pred ON op.predecessor_dot = pred.dot_number
        JOIN carriers succ ON op.successor_dot = succ.dot_number
        WHERE NOT EXISTS (
            SELECT 1 FROM chameleon_pairs cp
            WHERE cp.predecessor_dot = op.predecessor_dot
              AND cp.successor_dot = op.successor_dot
        )
        ON CONFLICT DO NOTHING
    """, (MAX_GAP_DAYS,))
    officer_pairs_new = cur.rowcount
    conn.commit()
    log.info("  Officer-based new pairs: %d", officer_pairs_new)

    # Step 3: Merge signals — update existing pairs that also share officers
    log.info("Merging officer signal into existing address pairs...")
    cur.execute("""
        WITH officer_links AS (
            SELECT DISTINCT
                cp1.dot_number AS predecessor_dot,
                cp2.dot_number AS successor_dot
            FROM carrier_principals cp1
            JOIN carrier_principals cp2
                ON cp1.officer_name_normalized = cp2.officer_name_normalized
                AND cp1.dot_number != cp2.dot_number
        )
        UPDATE chameleon_pairs cp SET
            match_signals = array_append(match_signals, 'officer'),
            signal_count = signal_count + 1
        FROM officer_links ol
        WHERE cp.predecessor_dot = ol.predecessor_dot
          AND cp.successor_dot = ol.successor_dot
          AND NOT ('officer' = ANY(cp.match_signals))
    """)
    officer_merged = cur.rowcount
    conn.commit()
    log.info("  Merged officer signal: %d pairs upgraded", officer_merged)

    # Step 4: Phone-based signal
    log.info("Merging phone signal...")
    cur.execute("""
        UPDATE chameleon_pairs cp SET
            match_signals = array_append(match_signals, 'phone'),
            signal_count = signal_count + 1
        FROM carriers pred, carriers succ
        WHERE cp.predecessor_dot = pred.dot_number
          AND cp.successor_dot = succ.dot_number
          AND pred.phone IS NOT NULL
          AND pred.phone != ''
          AND pred.phone = succ.phone
          AND NOT ('phone' = ANY(cp.match_signals))
    """)
    phone_merged = cur.rowcount
    conn.commit()
    log.info("  Phone signal merged: %d pairs", phone_merged)

    # Step 5: Update confidence levels
    log.info("Setting confidence levels...")
    cur.execute("""
        UPDATE chameleon_pairs SET confidence = CASE
            WHEN signal_count >= 3 THEN 'high'
            WHEN signal_count >= 2 THEN 'medium'
            ELSE 'low'
        END
    """)
    conn.commit()

    # Stats
    cur.execute("""
        SELECT confidence, COUNT(*), AVG(signal_count)::numeric(3,1)
        FROM chameleon_pairs
        GROUP BY confidence
        ORDER BY confidence
    """)
    for conf, cnt, avg_sig in cur.fetchall():
        log.info("  %s: %d pairs (avg %.1f signals)", conf, cnt, float(avg_sig))

    cur.execute("SELECT COUNT(*) FROM chameleon_pairs")
    total = cur.fetchone()[0]
    log.info("Total chameleon pairs: %d", total)
    return total


def apply_chameleon_risk_flags(conn):
    """Add CHAMELEON_SUCCESSOR flag to carriers that appear as successors in medium/high pairs."""
    cur = conn.cursor()

    log.info("Applying CHAMELEON_SUCCESSOR risk flags...")

    # Flag successors in medium/high confidence pairs
    cur.execute("""
        WITH flagged AS (
            SELECT DISTINCT successor_dot AS dot_number
            FROM chameleon_pairs
            WHERE confidence IN ('medium', 'high')
        )
        UPDATE carriers c SET
            risk_score = COALESCE(risk_score, 0) + 30,
            risk_flags = array_append(COALESCE(risk_flags, '{}'), 'CHAMELEON_SUCCESSOR')
        FROM flagged f
        WHERE c.dot_number = f.dot_number
          AND NOT ('CHAMELEON_SUCCESSOR' = ANY(COALESCE(c.risk_flags, '{}')))
    """)
    flagged = cur.rowcount
    conn.commit()
    log.info("  CHAMELEON_SUCCESSOR: %d carriers flagged", flagged)

    # Flag predecessors in medium/high confidence pairs
    cur.execute("""
        WITH flagged AS (
            SELECT DISTINCT predecessor_dot AS dot_number
            FROM chameleon_pairs
            WHERE confidence IN ('medium', 'high')
        )
        UPDATE carriers c SET
            risk_score = COALESCE(risk_score, 0) + 20,
            risk_flags = array_append(COALESCE(risk_flags, '{}'), 'CHAMELEON_PREDECESSOR')
        FROM flagged f
        WHERE c.dot_number = f.dot_number
          AND NOT ('CHAMELEON_PREDECESSOR' = ANY(COALESCE(c.risk_flags, '{}')))
    """)
    pred_flagged = cur.rowcount
    conn.commit()
    log.info("  CHAMELEON_PREDECESSOR: %d carriers flagged", pred_flagged)

    return flagged + pred_flagged


def main():
    log.info("=" * 60)
    log.info("CarrierWatch — Chameleon Carrier Detection")
    log.info("=" * 60)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    try:
        total_pairs = detect_chameleon_pairs(conn)
        if total_pairs > 0:
            flagged = apply_chameleon_risk_flags(conn)
            log.info("Total carriers flagged: %d", flagged)
        else:
            log.info("No chameleon pairs detected")
    finally:
        conn.close()

    log.info("=" * 60)
    log.info("Chameleon detection complete!")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
