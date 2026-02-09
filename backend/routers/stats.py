from __future__ import annotations

import time

from fastapi import APIRouter

from database import get_conn
from models import StatsResponse

router = APIRouter(prefix="/api", tags=["stats"])

# Simple in-memory cache: {key: (value, expiry_time)}
_cache: dict[str, tuple] = {}
CACHE_TTL = 60  # seconds


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

    total = await pool.fetchval("SELECT COUNT(*) FROM carriers")
    active = await pool.fetchval(
        "SELECT COUNT(*) FROM carriers WHERE operating_status_code = 'A'"
    )
    geocoded = await pool.fetchval(
        "SELECT COUNT(*) FROM carriers WHERE location IS NOT NULL"
    )
    clusters = await pool.fetchval("SELECT COUNT(*) FROM address_clusters")
    flagged_5 = await pool.fetchval(
        "SELECT COUNT(*) FROM address_clusters WHERE carrier_count >= 5"
    )
    flagged_10 = await pool.fetchval(
        "SELECT COUNT(*) FROM address_clusters WHERE carrier_count >= 10"
    )
    top_count = await pool.fetchval(
        "SELECT COALESCE(MAX(carrier_count), 0) FROM address_clusters"
    )
    states = await pool.fetchval(
        """SELECT COUNT(DISTINCT physical_state) FROM carriers
           WHERE physical_state IN (
             'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
             'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
             'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
             'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
             'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
             'DC','PR','VI','GU','AS','MP'
           )"""
    )
    high_risk = await pool.fetchval(
        "SELECT COUNT(*) FROM carriers WHERE risk_score >= 50"
    )
    carriers_ppp = await pool.fetchval(
        "SELECT COUNT(*) FROM carriers WHERE ppp_loan_count > 0"
    )
    total_ppp = await pool.fetchval(
        "SELECT COALESCE(SUM(ppp_loan_total), 0) FROM carriers WHERE ppp_loan_count > 0"
    )

    result = StatsResponse(
        total_carriers=total or 0,
        active_carriers=active or 0,
        geocoded_carriers=geocoded or 0,
        total_clusters=clusters or 0,
        flagged_clusters_5plus=flagged_5 or 0,
        flagged_clusters_10plus=flagged_10 or 0,
        top_cluster_count=top_count or 0,
        states_covered=states or 0,
        high_risk_carriers=high_risk or 0,
        carriers_with_ppp=carriers_ppp or 0,
        total_ppp_matched=float(total_ppp or 0),
    )

    cache_set("stats", result)
    return result
