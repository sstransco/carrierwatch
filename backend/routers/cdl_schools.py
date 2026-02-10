from __future__ import annotations

from fastapi import APIRouter, Query

from database import get_conn

router = APIRouter(prefix="/api/cdl-schools", tags=["cdl-schools"])


@router.get("")
async def list_cdl_schools(
    state: str | None = None,
    training_type: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    """List CDL training schools with filters."""
    pool = await get_conn()

    conditions = []
    params = []
    idx = 1

    if state:
        conditions.append(f"state = ${idx}")
        params.append(state.upper())
        idx += 1

    if training_type:
        conditions.append(f"${idx} = ANY(training_types)")
        params.append(training_type)
        idx += 1

    if q:
        conditions.append(f"provider_name ILIKE '%' || ${idx} || '%'")
        params.append(q.strip())
        idx += 1

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    offset = (page - 1) * limit

    total = await pool.fetchval(f"SELECT COUNT(*) FROM cdl_schools {where}", *params)

    rows = await pool.fetch(
        f"""
        SELECT id, provider_name, physical_address, city, state, zip, phone,
               training_types, provider_type, status, address_hash,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude
        FROM cdl_schools
        {where}
        ORDER BY provider_name
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, limit, offset,
    )

    items = [
        {
            "id": r["id"],
            "provider_name": r["provider_name"],
            "address": r["physical_address"],
            "city": r["city"],
            "state": r["state"],
            "zip": r["zip"],
            "phone": r["phone"],
            "training_types": r["training_types"] or [],
            "provider_type": r["provider_type"],
            "status": r["status"],
            "address_hash": r["address_hash"],
            "latitude": r["latitude"],
            "longitude": r["longitude"],
        }
        for r in rows
    ]

    pages = (total + limit - 1) // limit if total > 0 else 1
    return {"items": items, "total": total, "page": page, "limit": limit, "pages": pages}


@router.get("/at-carrier-addresses")
async def cdl_at_carrier_addresses(
    min_carriers: int = Query(3, ge=2),
    limit: int = Query(50, ge=1, le=200),
):
    """CDL schools located at addresses with multiple carriers."""
    pool = await get_conn()

    rows = await pool.fetch(
        """
        SELECT cs.id, cs.provider_name, cs.city, cs.state, cs.zip,
               cs.training_types, cs.address_hash,
               ac.carrier_count, ac.address
        FROM cdl_schools cs
        JOIN address_clusters ac ON cs.address_hash = ac.address_hash
        WHERE ac.carrier_count >= $1
        ORDER BY ac.carrier_count DESC
        LIMIT $2
        """,
        min_carriers, limit,
    )

    return [
        {
            "provider_name": r["provider_name"],
            "city": r["city"],
            "state": r["state"],
            "zip": r["zip"],
            "training_types": r["training_types"] or [],
            "address_hash": r["address_hash"],
            "carrier_count": r["carrier_count"],
            "address": r["address"],
        }
        for r in rows
    ]


@router.get("/stats")
async def cdl_stats():
    """CDL schools statistics."""
    pool = await get_conn()

    total = await pool.fetchval("SELECT COUNT(*) FROM cdl_schools")
    states = await pool.fetchval("SELECT COUNT(DISTINCT state) FROM cdl_schools WHERE state IS NOT NULL")

    top_states = await pool.fetch(
        "SELECT state, COUNT(*) as cnt FROM cdl_schools WHERE state IS NOT NULL GROUP BY state ORDER BY cnt DESC LIMIT 10"
    )

    training = await pool.fetch(
        "SELECT unnest(training_types) as t, COUNT(*) as cnt FROM cdl_schools WHERE training_types IS NOT NULL GROUP BY t ORDER BY cnt DESC"
    )

    overlap_count = await pool.fetchval(
        """
        SELECT COUNT(*)
        FROM cdl_schools cs
        JOIN address_clusters ac ON cs.address_hash = ac.address_hash
        WHERE ac.carrier_count >= 3
        """
    )

    return {
        "total_schools": total,
        "states_covered": states,
        "at_carrier_addresses": overlap_count or 0,
        "top_states": [{"state": r["state"], "count": r["cnt"]} for r in top_states],
        "training_types": [{"type": r["t"], "count": r["cnt"]} for r in training],
    }
