from __future__ import annotations

import time

from fastapi import APIRouter, Query

from database import get_conn
from models import CountryBreakdown, InternationalCarrier, InternationalStats

router = APIRouter(prefix="/api/international", tags=["international"])

# Simple in-memory cache
_cache: dict[str, tuple] = {}
CACHE_TTL = 300


def cache_get(key: str):
    entry = _cache.get(key)
    if entry and entry[1] > time.time():
        return entry[0]
    return None


def cache_set(key: str, value, ttl: int = CACHE_TTL):
    _cache[key] = (value, time.time() + ttl)


@router.get("/stats", response_model=InternationalStats)
async def international_stats():
    """Aggregate stats for foreign carriers and linked US carriers."""
    cached = cache_get("intl_stats")
    if cached:
        return cached

    pool = await get_conn()

    totals = await pool.fetchrow("""
        SELECT
            COUNT(*) FILTER (
                WHERE physical_country IS NOT NULL AND physical_country != '' AND physical_country != 'US'
            ) AS total_foreign,
            COUNT(*) FILTER (
                WHERE 'FOREIGN_LINKED_OFFICER' = ANY(COALESCE(risk_flags, '{}'))
            ) AS linked_officer,
            COUNT(*) FILTER (
                WHERE 'FOREIGN_LINKED_ADDRESS' = ANY(COALESCE(risk_flags, '{}'))
            ) AS linked_address,
            COUNT(*) FILTER (
                WHERE 'FOREIGN_MAILING' = ANY(COALESCE(risk_flags, '{}'))
            ) AS foreign_mailing,
            COUNT(*) FILTER (
                WHERE physical_country IS NOT NULL AND physical_country != '' AND physical_country != 'US'
                  AND COALESCE(risk_score, 0) >= 50
            ) AS high_risk_foreign
        FROM carriers
    """)

    country_rows = await pool.fetch("""
        SELECT
            physical_country,
            COUNT(*) AS carrier_count,
            COUNT(*) FILTER (WHERE operating_status LIKE 'AUTHORIZED%') AS active_count,
            COUNT(*) FILTER (WHERE COALESCE(risk_score, 0) >= 50) AS high_risk_count,
            ROUND(AVG(COALESCE(risk_score, 0)))::integer AS avg_risk,
            SUM(COALESCE(total_crashes, 0))::integer AS total_crashes
        FROM carriers
        WHERE physical_country IS NOT NULL AND physical_country != '' AND physical_country != 'US'
        GROUP BY physical_country
        ORDER BY carrier_count DESC
    """)

    result = InternationalStats(
        total_foreign=totals["total_foreign"],
        linked_officer=totals["linked_officer"],
        linked_address=totals["linked_address"],
        foreign_mailing=totals["foreign_mailing"],
        high_risk_foreign=totals["high_risk_foreign"],
        countries=[
            CountryBreakdown(
                country=r["physical_country"],
                carrier_count=r["carrier_count"],
                active_count=r["active_count"],
                high_risk_count=r["high_risk_count"],
                avg_risk=float(r["avg_risk"] or 0),
                total_crashes=r["total_crashes"] or 0,
            )
            for r in country_rows
        ],
    )

    cache_set("intl_stats", result)
    return result


@router.get("/carriers", response_model=list[InternationalCarrier])
async def international_carriers(
    limit: int = Query(50, ge=1, le=200),
    min_risk: int = Query(0, ge=0),
    country: str | None = None,
):
    """Top foreign carriers by risk score, optionally filtered by country."""
    pool = await get_conn()

    conditions = [
        "physical_country IS NOT NULL",
        "physical_country != ''",
        "physical_country != 'US'",
        "COALESCE(risk_score, 0) >= $1",
    ]
    params: list = [min_risk]
    idx = 2

    if country:
        conditions.append(f"physical_country = ${idx}")
        params.append(country.upper())
        idx += 1

    params.append(limit)
    where = " AND ".join(conditions)

    rows = await pool.fetch(f"""
        SELECT dot_number, legal_name, physical_country, physical_state,
               COALESCE(risk_score, 0) AS risk_score,
               COALESCE(risk_flags, '{{}}') AS risk_flags,
               COALESCE(power_units, 0) AS power_units,
               COALESCE(total_crashes, 0) AS total_crashes,
               operating_status,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude
        FROM carriers
        WHERE {where} AND location IS NOT NULL
        ORDER BY risk_score DESC, total_crashes DESC
        LIMIT ${idx}
    """, *params)

    return [
        InternationalCarrier(
            dot_number=r["dot_number"],
            legal_name=r["legal_name"],
            physical_country=r["physical_country"],
            physical_state=r["physical_state"],
            risk_score=r["risk_score"],
            risk_flags=r["risk_flags"],
            power_units=r["power_units"],
            total_crashes=r["total_crashes"],
            operating_status=r["operating_status"],
            latitude=r["latitude"],
            longitude=r["longitude"],
        )
        for r in rows
    ]


@router.get("/linked", response_model=list[InternationalCarrier])
async def linked_carriers(
    limit: int = Query(50, ge=1, le=200),
    link_type: str = Query("officer", pattern="^(officer|address|mailing)$"),
    country: str | None = None,
):
    """US carriers linked to foreign operators via officers, addresses, or mailing."""
    pool = await get_conn()

    flag_map = {
        "officer": "FOREIGN_LINKED_OFFICER",
        "address": "FOREIGN_LINKED_ADDRESS",
        "mailing": "FOREIGN_MAILING",
    }
    flag = flag_map[link_type]

    conditions = [
        f"$1 = ANY(COALESCE(risk_flags, '{{}}'))",
    ]
    params: list = [flag]
    idx = 2

    if country:
        # For linked carriers, filter by the country of the foreign carrier they're linked to
        # For mailing type, filter by mailing_country; for officer/address, we filter US carriers
        if link_type == "mailing":
            conditions.append(f"mailing_country = ${idx}")
        else:
            # Can't directly filter by linked country without a join,
            # so this filters by state instead if provided
            conditions.append(f"physical_state = ${idx}")
        params.append(country.upper())
        idx += 1

    params.append(limit)
    where = " AND ".join(conditions)

    rows = await pool.fetch(f"""
        SELECT dot_number, legal_name,
               COALESCE(physical_country, 'US') AS physical_country,
               physical_state,
               COALESCE(risk_score, 0) AS risk_score,
               COALESCE(risk_flags, '{{}}') AS risk_flags,
               COALESCE(power_units, 0) AS power_units,
               COALESCE(total_crashes, 0) AS total_crashes,
               operating_status,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude
        FROM carriers
        WHERE {where} AND location IS NOT NULL
        ORDER BY risk_score DESC, total_crashes DESC
        LIMIT ${idx}
    """, *params)

    return [
        InternationalCarrier(
            dot_number=r["dot_number"],
            legal_name=r["legal_name"],
            physical_country=r["physical_country"],
            physical_state=r["physical_state"],
            risk_score=r["risk_score"],
            risk_flags=r["risk_flags"],
            power_units=r["power_units"],
            total_crashes=r["total_crashes"],
            operating_status=r["operating_status"],
            latitude=r["latitude"],
            longitude=r["longitude"],
        )
        for r in rows
    ]
