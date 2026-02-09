from fastapi import APIRouter, HTTPException, Query

from database import get_conn
from models import AddressCluster, CarrierSummary

router = APIRouter(prefix="/api/addresses", tags=["addresses"])


@router.get("/top-flagged", response_model=list[AddressCluster])
async def top_flagged_addresses(
    state: str | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    """Get top addresses by carrier count (potential chameleon clusters)."""
    pool = await get_conn()

    if state:
        rows = await pool.fetch(
            """
            SELECT address_hash, address, city, state, zip,
                   carrier_count, active_count, total_crashes,
                   avg_vehicle_oos_rate,
                   ST_Y(centroid::geometry) AS latitude,
                   ST_X(centroid::geometry) AS longitude
            FROM address_clusters
            WHERE state = $1
            ORDER BY carrier_count DESC
            LIMIT $2
            """,
            state.upper(), limit,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT address_hash, address, city, state, zip,
                   carrier_count, active_count, total_crashes,
                   avg_vehicle_oos_rate,
                   ST_Y(centroid::geometry) AS latitude,
                   ST_X(centroid::geometry) AS longitude
            FROM address_clusters
            ORDER BY carrier_count DESC
            LIMIT $1
            """,
            limit,
        )

    return [
        AddressCluster(
            address_hash=r["address_hash"],
            address=r["address"],
            city=r["city"],
            state=r["state"],
            zip=r["zip"],
            carrier_count=r["carrier_count"],
            active_count=r["active_count"] or 0,
            total_crashes=r["total_crashes"] or 0,
            avg_vehicle_oos_rate=float(r["avg_vehicle_oos_rate"] or 0),
            latitude=r["latitude"],
            longitude=r["longitude"],
        )
        for r in rows
    ]


@router.get("/{address_hash}", response_model=dict)
async def get_address_cluster(address_hash: str):
    """Get all carriers at a specific address."""
    pool = await get_conn()

    cluster = await pool.fetchrow(
        """
        SELECT address_hash, address, city, state, zip,
               carrier_count, active_count, total_crashes,
               avg_vehicle_oos_rate,
               ST_Y(centroid::geometry) AS latitude,
               ST_X(centroid::geometry) AS longitude
        FROM address_clusters
        WHERE address_hash = $1
        """,
        address_hash,
    )

    if not cluster:
        raise HTTPException(status_code=404, detail="Address cluster not found")

    carriers = await pool.fetch(
        """
        SELECT dot_number, legal_name, dba_name, physical_city, physical_state,
               operating_status, power_units, drivers, safety_rating,
               total_crashes, vehicle_oos_rate,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude
        FROM carriers
        WHERE address_hash = $1
        ORDER BY dot_number
        """,
        address_hash,
    )

    return {
        "cluster": AddressCluster(
            address_hash=cluster["address_hash"],
            address=cluster["address"],
            city=cluster["city"],
            state=cluster["state"],
            zip=cluster["zip"],
            carrier_count=cluster["carrier_count"],
            active_count=cluster["active_count"] or 0,
            total_crashes=cluster["total_crashes"] or 0,
            avg_vehicle_oos_rate=float(cluster["avg_vehicle_oos_rate"] or 0),
            latitude=cluster["latitude"],
            longitude=cluster["longitude"],
        ),
        "carriers": [
            CarrierSummary(
                dot_number=c["dot_number"],
                legal_name=c["legal_name"],
                dba_name=c["dba_name"],
                physical_city=c["physical_city"],
                physical_state=c["physical_state"],
                operating_status=c["operating_status"],
                power_units=c["power_units"] or 0,
                drivers=c["drivers"] or 0,
                safety_rating=c["safety_rating"],
                total_crashes=c["total_crashes"] or 0,
                vehicle_oos_rate=float(c["vehicle_oos_rate"] or 0),
                latitude=c["latitude"],
                longitude=c["longitude"],
            )
            for c in carriers
        ],
    }
