from __future__ import annotations

from fastapi import APIRouter

from database import get_conn

router = APIRouter(prefix="/api/spotlight", tags=["spotlight"])


@router.get("/address-mills")
async def address_mills():
    """Top address mills — addresses with the most carriers."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT address_hash, address, city, state, zip,
               carrier_count, active_count, total_crashes,
               latitude, longitude
        FROM address_clusters
        ORDER BY carrier_count DESC
        LIMIT 25
        """
    )
    return [dict(r) for r in rows]


@router.get("/zombie-carriers")
async def zombie_carriers():
    """Carriers with massive crash histories but minimal current operations."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT dot_number, legal_name, physical_state, operating_status,
               power_units, drivers, total_crashes, fatal_crashes,
               COALESCE(risk_score, 0) AS risk_score,
               risk_flags,
               insurance_bipd_on_file
        FROM carriers
        WHERE total_crashes >= 100
          AND power_units <= 10
          AND operating_status LIKE 'AUTHORIZED%'
        ORDER BY fatal_crashes DESC, total_crashes DESC
        LIMIT 25
        """
    )
    return [
        {
            **dict(r),
            "risk_flags": list(r["risk_flags"]) if r["risk_flags"] else [],
        }
        for r in rows
    ]


@router.get("/ppp-suspicious")
async def ppp_suspicious():
    """Suspicious PPP loans — large loans to tiny carriers."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT c.dot_number, c.legal_name, c.physical_state,
               c.power_units, c.drivers,
               p.loan_amount, p.forgiveness_amount, p.jobs_reported, p.loan_status,
               COALESCE(c.risk_score, 0) AS risk_score
        FROM carriers c
        JOIN ppp_loans p ON p.dot_number = c.dot_number
        WHERE c.power_units <= 5 AND p.loan_amount > 500000
        ORDER BY p.loan_amount DESC
        LIMIT 25
        """
    )
    return [dict(r) for r in rows]


@router.get("/officer-empires")
async def officer_empires():
    """Officers controlling the most carriers."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT occ.officer_name_normalized AS officer_name,
               occ.carrier_count,
               (
                   SELECT COUNT(DISTINCT c.address_hash)
                   FROM carrier_principals cp2
                   JOIN carriers c ON c.dot_number = cp2.dot_number
                   WHERE cp2.officer_name_normalized = occ.officer_name_normalized
                     AND c.address_hash IS NOT NULL
               ) AS address_count,
               (
                   SELECT SUM(COALESCE(c.total_crashes, 0))
                   FROM carrier_principals cp3
                   JOIN carriers c ON c.dot_number = cp3.dot_number
                   WHERE cp3.officer_name_normalized = occ.officer_name_normalized
               ) AS total_crashes,
               (
                   SELECT SUM(COALESCE(c.fatal_crashes, 0))
                   FROM carrier_principals cp4
                   JOIN carriers c ON c.dot_number = cp4.dot_number
                   WHERE cp4.officer_name_normalized = occ.officer_name_normalized
               ) AS fatal_crashes
        FROM officer_carrier_counts occ
        WHERE occ.carrier_count >= 50
        ORDER BY occ.carrier_count DESC
        LIMIT 25
        """
    )
    return [dict(r) for r in rows]


@router.get("/summary")
async def spotlight_summary():
    """Aggregate stats for the spotlight page."""
    pool = await get_conn()
    row = await pool.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM carriers WHERE risk_score >= 50) AS high_risk_count,
            (SELECT SUM(fatal_crashes) FROM carriers WHERE risk_score >= 50) AS high_risk_fatalities,
            (SELECT SUM(total_crashes) FROM carriers WHERE risk_score >= 50) AS high_risk_crashes,
            (SELECT COUNT(*) FROM address_clusters WHERE carrier_count >= 25) AS large_clusters,
            (SELECT COUNT(DISTINCT officer_name_normalized) FROM officer_carrier_counts WHERE carrier_count >= 10) AS prolific_officers,
            (SELECT SUM(loan_amount) FROM ppp_loans WHERE dot_number IS NOT NULL) AS total_ppp_to_carriers
        """
    )
    return dict(row)
