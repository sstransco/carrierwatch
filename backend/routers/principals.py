from __future__ import annotations

from fastapi import APIRouter, Query

from database import get_conn

router = APIRouter(prefix="/api/principals", tags=["principals"])


@router.get("/search")
async def search_principals(
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(20, ge=1, le=50),
):
    """Search officers by name with fuzzy matching."""
    pool = await get_conn()
    q_norm = q.strip().lower()

    rows = await pool.fetch(
        """
        SELECT officer_name_normalized,
               COUNT(DISTINCT dot_number) AS carrier_count,
               array_agg(DISTINCT dot_number ORDER BY dot_number) AS dot_numbers
        FROM carrier_principals
        WHERE officer_name_normalized % $1
           OR officer_name_normalized ILIKE '%' || $1 || '%'
        GROUP BY officer_name_normalized
        ORDER BY similarity(officer_name_normalized, $1) DESC, carrier_count DESC
        LIMIT $2
        """,
        q_norm, limit,
    )

    return [
        {
            "officer_name": r["officer_name_normalized"],
            "carrier_count": r["carrier_count"],
            "dot_numbers": list(r["dot_numbers"][:20]),
        }
        for r in rows
    ]


@router.get("/top")
async def top_principals(
    min_carriers: int = Query(5, ge=2, le=100),
    limit: int = Query(50, ge=1, le=200),
    state: str | None = None,
):
    """Leaderboard: officers linked to the most carriers."""
    pool = await get_conn()

    if state:
        rows = await pool.fetch(
            """
            SELECT cp.officer_name_normalized,
                   COUNT(DISTINCT cp.dot_number) AS carrier_count,
                   array_agg(DISTINCT c.operating_status) AS statuses,
                   SUM(COALESCE(c.risk_score, 0)) AS total_risk,
                   array_agg(DISTINCT cp.dot_number ORDER BY cp.dot_number) AS dot_numbers
            FROM carrier_principals cp
            JOIN carriers c ON c.dot_number = cp.dot_number
            WHERE c.physical_state = $1
            GROUP BY cp.officer_name_normalized
            HAVING COUNT(DISTINCT cp.dot_number) >= $2
            ORDER BY carrier_count DESC
            LIMIT $3
            """,
            state.upper(), min_carriers, limit,
        )
    else:
        # Use materialized view for fast unfiltered leaderboard
        rows = await pool.fetch(
            """
            SELECT occ.officer_name_normalized,
                   occ.carrier_count,
                   occ.dot_numbers
            FROM officer_carrier_counts occ
            WHERE occ.carrier_count >= $1
            ORDER BY occ.carrier_count DESC
            LIMIT $2
            """,
            min_carriers, limit,
        )

    return [
        {
            "officer_name": r["officer_name_normalized"],
            "carrier_count": r["carrier_count"],
            "statuses": list(set(s for s in r["statuses"] if s)) if "statuses" in r.keys() else [],
            "total_risk": r.get("total_risk") or 0,
            "dot_numbers": list(r["dot_numbers"][:25]),
        }
        for r in rows
    ]


@router.get("/carrier/{dot_number}")
async def carrier_principals(dot_number: int):
    """Get all officers/principals for a specific carrier."""
    pool = await get_conn()

    rows = await pool.fetch(
        """
        SELECT cp.officer_name, cp.officer_name_normalized, cp.officer_position,
               cp.phone, cp.email,
               COALESCE(occ.carrier_count, 1) - 1 AS other_carrier_count,
               COALESCE(occ.dot_numbers, ARRAY[]::integer[]) AS all_dot_numbers
        FROM carrier_principals cp
        LEFT JOIN officer_carrier_counts occ
            ON occ.officer_name_normalized = cp.officer_name_normalized
        WHERE cp.dot_number = $1
        ORDER BY cp.officer_position
        """,
        dot_number,
    )

    return [
        {
            "officer_name": r["officer_name"],
            "officer_name_normalized": r["officer_name_normalized"],
            "position": r["officer_position"],
            "phone": r["phone"],
            "email": r["email"],
            "other_carrier_count": r["other_carrier_count"],
            "other_dot_numbers": [d for d in list(r["all_dot_numbers"])[:50] if d != dot_number],
        }
        for r in rows
    ]
