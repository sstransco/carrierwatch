from __future__ import annotations

import time

from fastapi import APIRouter

from database import get_conn
from models import StatsResponse

router = APIRouter(prefix="/api", tags=["stats"])

# Simple in-memory cache: {key: (value, expiry_time)}
_cache: dict[str, tuple] = {}
CACHE_TTL = 300  # seconds


def cache_get(key: str):
    entry = _cache.get(key)
    if entry and entry[1] > time.time():
        return entry[0]
    return None


def cache_set(key: str, value, ttl: int = CACHE_TTL):
    _cache[key] = (value, time.time() + ttl)


@router.get("/stats", response_model=StatsResponse)
async def get_stats():
    """Get dashboard-level statistics."""
    cached = cache_get("stats")
    if cached:
        return cached

    pool = await get_conn()

    # Single query to compute all carrier stats in one table scan
    row = await pool.fetchrow("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE operating_status_code = 'A') AS active,
            COUNT(*) FILTER (WHERE location IS NOT NULL) AS geocoded,
            COUNT(DISTINCT physical_state) FILTER (WHERE physical_state IN (
                'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
                'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
                'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
                'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
                'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
                'DC','PR','VI','GU','AS','MP'
            )) AS states,
            COUNT(*) FILTER (WHERE risk_score >= 50) AS high_risk,
            COUNT(*) FILTER (WHERE ppp_loan_count > 0) AS carriers_ppp,
            COALESCE(SUM(ppp_loan_total) FILTER (WHERE ppp_loan_count > 0), 0) AS total_ppp
        FROM carriers
    """)

    cluster_row = await pool.fetchrow("""
        SELECT
            COUNT(*) AS total_clusters,
            COUNT(*) FILTER (WHERE carrier_count >= 5) AS flagged_5,
            COUNT(*) FILTER (WHERE carrier_count >= 10) AS flagged_10,
            COALESCE(MAX(carrier_count), 0) AS top_count
        FROM address_clusters
    """)

    result = StatsResponse(
        total_carriers=row["total"] or 0,
        active_carriers=row["active"] or 0,
        geocoded_carriers=row["geocoded"] or 0,
        total_clusters=cluster_row["total_clusters"] or 0,
        flagged_clusters_5plus=cluster_row["flagged_5"] or 0,
        flagged_clusters_10plus=cluster_row["flagged_10"] or 0,
        top_cluster_count=cluster_row["top_count"] or 0,
        states_covered=row["states"] or 0,
        high_risk_carriers=row["high_risk"] or 0,
        carriers_with_ppp=row["carriers_ppp"] or 0,
        total_ppp_matched=float(row["total_ppp"] or 0),
    )

    cache_set("stats", result)
    return result
