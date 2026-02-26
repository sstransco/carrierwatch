from __future__ import annotations

from fastapi import APIRouter, Query

from database import get_conn

router = APIRouter(prefix="/api/demographics", tags=["demographics"])


@router.get("/overview")
async def demographics_overview():
    """Overview: origin counts grouped by region with totals."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT so.country_code, so.country_name, so.region,
               COUNT(DISTINCT cp.officer_name_normalized) AS officer_count,
               COUNT(DISTINCT cp.dot_number) AS carrier_count,
               COALESCE(AVG(c.risk_score), 0)::int AS avg_risk
        FROM surname_origins so
        JOIN carrier_principals cp
            ON so.surname = lower(reverse(split_part(reverse(cp.officer_name_normalized), ' ', 1)))
        JOIN carriers c ON c.dot_number = cp.dot_number
        GROUP BY so.country_code, so.country_name, so.region
        ORDER BY officer_count DESC
        """
    )
    return [
        {
            "code": r["country_code"].strip(),
            "name": r["country_name"],
            "region": r["region"],
            "officer_count": r["officer_count"],
            "carrier_count": r["carrier_count"],
            "avg_risk": r["avg_risk"],
        }
        for r in rows
    ]


@router.get("/by-state")
async def demographics_by_state(
    origin: str | None = None,
):
    """Breakdown by state, optionally filtered to a specific origin."""
    pool = await get_conn()

    if origin:
        rows = await pool.fetch(
            """
            SELECT c.physical_state AS state,
                   COUNT(DISTINCT cp.officer_name_normalized) AS officer_count,
                   COUNT(DISTINCT cp.dot_number) AS carrier_count,
                   COALESCE(AVG(c.risk_score), 0)::int AS avg_risk
            FROM carrier_principals cp
            JOIN carriers c ON c.dot_number = cp.dot_number
            JOIN surname_origins so
                ON so.surname = lower(reverse(split_part(reverse(cp.officer_name_normalized), ' ', 1)))
            WHERE so.country_code = $1
              AND c.physical_state IS NOT NULL
              AND c.physical_state != ''
            GROUP BY c.physical_state
            ORDER BY officer_count DESC
            """,
            origin.upper().strip(),
        )
    else:
        rows = await pool.fetch(
            """
            SELECT c.physical_state AS state,
                   COUNT(DISTINCT cp.officer_name_normalized) AS officer_count,
                   COUNT(DISTINCT cp.dot_number) AS carrier_count,
                   COALESCE(AVG(c.risk_score), 0)::int AS avg_risk
            FROM carrier_principals cp
            JOIN carriers c ON c.dot_number = cp.dot_number
            WHERE c.physical_state IS NOT NULL
              AND c.physical_state != ''
            GROUP BY c.physical_state
            ORDER BY officer_count DESC
            """
        )

    return [
        {
            "state": r["state"],
            "officer_count": r["officer_count"],
            "carrier_count": r["carrier_count"],
            "avg_risk": r["avg_risk"],
        }
        for r in rows
    ]


@router.get("/by-state/{state}")
async def demographics_state_detail(state: str):
    """Origin breakdown for a specific state — for pie chart."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT so.country_code, so.country_name, so.region,
               COUNT(DISTINCT cp.officer_name_normalized) AS officer_count,
               COUNT(DISTINCT cp.dot_number) AS carrier_count,
               COALESCE(AVG(c.risk_score), 0)::int AS avg_risk
        FROM carrier_principals cp
        JOIN carriers c ON c.dot_number = cp.dot_number
        JOIN surname_origins so
            ON so.surname = lower(reverse(split_part(reverse(cp.officer_name_normalized), ' ', 1)))
        WHERE c.physical_state = $1
        GROUP BY so.country_code, so.country_name, so.region
        ORDER BY officer_count DESC
        """,
        state.upper().strip(),
    )
    return [
        {
            "code": r["country_code"].strip(),
            "name": r["country_name"],
            "region": r["region"],
            "officer_count": r["officer_count"],
            "carrier_count": r["carrier_count"],
            "avg_risk": r["avg_risk"],
        }
        for r in rows
    ]


@router.get("/search")
async def demographics_search(
    q: str = Query(..., min_length=2, max_length=100),
):
    """Classify a single surname and return its predicted origin."""
    pool = await get_conn()
    surname = q.strip().lower().split()[-1]  # extract last name

    row = await pool.fetchrow(
        """
        SELECT surname, country_code, country_name, region, confidence
        FROM surname_origins
        WHERE surname = $1
        """,
        surname,
    )

    if row:
        return {
            "surname": row["surname"],
            "code": row["country_code"].strip(),
            "name": row["country_name"],
            "region": row["region"],
            "confidence": round(row["confidence"], 4),
            "found": True,
        }

    # Try fuzzy match
    rows = await pool.fetch(
        """
        SELECT surname, country_code, country_name, region, confidence
        FROM surname_origins
        WHERE surname % $1
        ORDER BY similarity(surname, $1) DESC
        LIMIT 5
        """,
        surname,
    )

    if rows:
        return {
            "surname": surname,
            "code": rows[0]["country_code"].strip(),
            "name": rows[0]["country_name"],
            "region": rows[0]["region"],
            "confidence": round(rows[0]["confidence"], 4),
            "found": False,
            "closest_match": rows[0]["surname"],
            "suggestions": [
                {"surname": r["surname"], "code": r["country_code"].strip(), "name": r["country_name"]}
                for r in rows
            ],
        }

    return {"surname": surname, "found": False, "code": None, "name": None, "region": None}


@router.get("/top-officers")
async def demographics_top_officers(
    origin: str = Query(..., min_length=2, max_length=4),
    state: str | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    """Top officers for a specific origin, optionally filtered by state."""
    pool = await get_conn()

    conditions = [
        "so.country_code = $1"
    ]
    params: list = [origin.upper().strip()]
    idx = 2

    if state:
        conditions.append(f"c.physical_state = ${idx}")
        params.append(state.upper().strip())
        idx += 1

    params.append(limit)
    where_clause = " AND ".join(conditions)

    rows = await pool.fetch(
        f"""
        SELECT cp.officer_name_normalized,
               COUNT(DISTINCT cp.dot_number) AS carrier_count,
               SUM(COALESCE(c.risk_score, 0)) AS total_risk,
               array_agg(DISTINCT c.operating_status) AS statuses,
               array_agg(DISTINCT cp.dot_number ORDER BY cp.dot_number) AS dot_numbers
        FROM carrier_principals cp
        JOIN carriers c ON c.dot_number = cp.dot_number
        JOIN surname_origins so
            ON so.surname = lower(reverse(split_part(reverse(cp.officer_name_normalized), ' ', 1)))
        WHERE {where_clause}
        GROUP BY cp.officer_name_normalized
        HAVING COUNT(DISTINCT cp.dot_number) >= 2
        ORDER BY carrier_count DESC
        LIMIT ${idx}
        """,
        *params,
    )

    return [
        {
            "officer_name": r["officer_name_normalized"],
            "carrier_count": r["carrier_count"],
            "total_risk": r["total_risk"] or 0,
            "statuses": list(set(s for s in r["statuses"] or [] if s)),
            "dot_numbers": list(r["dot_numbers"][:25]),
        }
        for r in rows
    ]


@router.get("/stats")
async def demographics_stats():
    """High-level stats for the demographics overview."""
    pool = await get_conn()
    row = await pool.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM surname_origins) AS total_surnames,
            (SELECT COUNT(DISTINCT country_code) FROM surname_origins) AS total_origins,
            (SELECT COUNT(DISTINCT region) FROM surname_origins) AS total_regions,
            (SELECT COUNT(*) FROM carriers WHERE dominant_origin IS NOT NULL) AS carriers_classified
        """
    )
    return {
        "total_surnames": row["total_surnames"],
        "total_origins": row["total_origins"],
        "total_regions": row["total_regions"],
        "carriers_classified": row["carriers_classified"],
    }
