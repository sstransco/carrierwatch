from __future__ import annotations

import csv
import io

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from database import get_conn
from models import CarrierDetail, CarrierSummary, PaginatedResponse, PPPLoan, SearchResult, TopRiskCarrier

router = APIRouter(prefix="/api/carriers", tags=["carriers"])


@router.get("/search", response_model=list[SearchResult])
async def search_carriers(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
):
    """Autocomplete search by DOT number, MC number, or legal name."""
    pool = await get_conn()
    results = []

    q = q.strip()

    # Try DOT number match
    if q.isdigit():
        rows = await pool.fetch(
            """
            SELECT dot_number, legal_name, dba_name, physical_city, physical_state,
                   operating_status, COALESCE(risk_score, 0) AS risk_score
            FROM carriers
            WHERE dot_number::text LIKE $1 || '%'
            ORDER BY dot_number
            LIMIT $2
            """,
            q, limit,
        )
        for r in rows:
            results.append(SearchResult(
                dot_number=r["dot_number"],
                legal_name=r["legal_name"],
                dba_name=r["dba_name"],
                physical_city=r["physical_city"],
                physical_state=r["physical_state"],
                operating_status=r["operating_status"],
                risk_score=r["risk_score"],
                match_type="dot",
            ))
        return results

    # Try MC number match
    if q.upper().startswith("MC") or q.upper().startswith("MC-"):
        mc = q.upper().replace("MC-", "").replace("MC", "").strip()
        if mc:
            rows = await pool.fetch(
                """
                SELECT dot_number, legal_name, dba_name, physical_city, physical_state,
                       operating_status, COALESCE(risk_score, 0) AS risk_score
                FROM carriers
                WHERE mc_number LIKE $1 || '%'
                ORDER BY dot_number
                LIMIT $2
                """,
                mc, limit,
            )
            for r in rows:
                results.append(SearchResult(
                    dot_number=r["dot_number"],
                    legal_name=r["legal_name"],
                    dba_name=r["dba_name"],
                    physical_city=r["physical_city"],
                    physical_state=r["physical_state"],
                    operating_status=r["operating_status"],
                    risk_score=r["risk_score"],
                    match_type="mc",
                ))
            return results

    # Name search with trigram similarity
    rows = await pool.fetch(
        """
        SELECT dot_number, legal_name, dba_name, physical_city, physical_state,
               operating_status, COALESCE(risk_score, 0) AS risk_score,
               similarity(legal_name, $1) AS sim
        FROM carriers
        WHERE legal_name % $1 OR legal_name ILIKE '%' || $1 || '%'
        ORDER BY sim DESC, legal_name
        LIMIT $2
        """,
        q.upper(), limit,
    )
    for r in rows:
        results.append(SearchResult(
            dot_number=r["dot_number"],
            legal_name=r["legal_name"],
            dba_name=r["dba_name"],
            physical_city=r["physical_city"],
            physical_state=r["physical_state"],
            operating_status=r["operating_status"],
            risk_score=r["risk_score"],
            match_type="name",
        ))

    return results


@router.get("/batch")
async def batch_carriers(
    dots: str = Query(..., description="Comma-separated DOT numbers"),
):
    """Batch lookup basic carrier info by DOT numbers (max 50)."""
    pool = await get_conn()
    dot_list = [int(d.strip()) for d in dots.split(",") if d.strip().isdigit()][:50]
    if not dot_list:
        return []

    rows = await pool.fetch(
        """
        SELECT dot_number, legal_name, operating_status,
               COALESCE(risk_score, 0) AS risk_score,
               COALESCE(power_units, 0) AS power_units,
               physical_state
        FROM carriers
        WHERE dot_number = ANY($1::integer[])
        ORDER BY risk_score DESC
        """,
        dot_list,
    )

    return [
        {
            "dot_number": r["dot_number"],
            "legal_name": r["legal_name"],
            "operating_status": r["operating_status"],
            "risk_score": r["risk_score"],
            "power_units": r["power_units"],
            "physical_state": r["physical_state"],
        }
        for r in rows
    ]


@router.get("/top-risk", response_model=list[TopRiskCarrier])
async def top_risk_carriers(
    limit: int = Query(50, ge=1, le=200),
    min_score: int = Query(30, ge=0, le=100),
    state: str | None = None,
):
    """Get carriers with the highest risk scores, optionally filtered by state."""
    pool = await get_conn()

    if state:
        rows = await pool.fetch(
            """
            SELECT dot_number, legal_name, physical_state,
                   COALESCE(risk_score, 0) AS risk_score,
                   COALESCE(risk_flags, '{}') AS risk_flags,
                   COALESCE(power_units, 0) AS power_units,
                   COALESCE(total_crashes, 0) AS total_crashes,
                   operating_status,
                   ST_Y(location::geometry) AS latitude,
                   ST_X(location::geometry) AS longitude
            FROM carriers
            WHERE risk_score >= $1 AND location IS NOT NULL
              AND physical_state = $3
            ORDER BY risk_score DESC, total_crashes DESC
            LIMIT $2
            """,
            min_score, limit, state.upper(),
        )
    else:
        rows = await pool.fetch(
            """
            SELECT dot_number, legal_name, physical_state,
                   COALESCE(risk_score, 0) AS risk_score,
                   COALESCE(risk_flags, '{}') AS risk_flags,
                   COALESCE(power_units, 0) AS power_units,
                   COALESCE(total_crashes, 0) AS total_crashes,
                   operating_status,
                   ST_Y(location::geometry) AS latitude,
                   ST_X(location::geometry) AS longitude
            FROM carriers
            WHERE risk_score >= $1 AND location IS NOT NULL
            ORDER BY risk_score DESC, total_crashes DESC
            LIMIT $2
            """,
            min_score, limit,
        )

    return [
        TopRiskCarrier(
            dot_number=r["dot_number"],
            legal_name=r["legal_name"],
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


@router.get("/export")
async def export_carriers(
    format: str = Query("csv", pattern="^(csv|json)$"),
    state: str | None = None,
    min_risk: int | None = None,
    has_ppp: bool | None = None,
    limit: int = Query(1000, ge=1, le=10000),
):
    """Export carrier data as CSV or JSON download."""
    pool = await get_conn()

    conditions = []
    params = []
    idx = 1

    if state:
        conditions.append(f"physical_state = ${idx}")
        params.append(state.upper())
        idx += 1
    if min_risk is not None:
        conditions.append(f"risk_score >= ${idx}")
        params.append(min_risk)
        idx += 1
    if has_ppp:
        conditions.append("ppp_loan_count > 0")

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    rows = await pool.fetch(
        f"""
        SELECT dot_number, legal_name, dba_name, physical_address,
               physical_city, physical_state, physical_zip, phone,
               operating_status, power_units, drivers, safety_rating,
               total_inspections, total_crashes, fatal_crashes,
               vehicle_oos_rate, driver_oos_rate,
               COALESCE(risk_score, 0) AS risk_score,
               COALESCE(risk_flags, '{{}}') AS risk_flags,
               ppp_loan_count, ppp_loan_total
        FROM carriers
        {where}
        ORDER BY risk_score DESC
        LIMIT ${idx}
        """,
        *params, limit,
    )

    if format == "json":
        return [dict(r) for r in rows]

    # CSV streaming response
    output = io.StringIO()
    writer = csv.writer(output)
    if rows:
        writer.writerow(rows[0].keys())
        for r in rows:
            writer.writerow([
                ",".join(r["risk_flags"]) if k == "risk_flags" else v
                for k, v in r.items()
            ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=carrierwatch_export.csv"},
    )


@router.get("/{dot_number}/summary")
async def get_carrier_summary(dot_number: int):
    """Lightweight carrier summary for tooltips and previews."""
    pool = await get_conn()
    row = await pool.fetchrow(
        """
        SELECT dot_number, legal_name, dba_name, operating_status,
               physical_city, physical_state, power_units, drivers,
               total_crashes, total_inspections,
               COALESCE(risk_score, 0) AS risk_score,
               COALESCE(risk_flags, '{}') AS risk_flags
        FROM carriers
        WHERE dot_number = $1
        """,
        dot_number,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Carrier not found")
    return dict(row)


@router.get("/{dot_number}", response_model=CarrierDetail)
async def get_carrier(dot_number: int):
    """Get full carrier detail by DOT number."""
    pool = await get_conn()

    row = await pool.fetchrow(
        """
        SELECT c.*,
               ST_Y(location::geometry) AS latitude,
               ST_X(location::geometry) AS longitude
        FROM carriers c
        WHERE dot_number = $1
        """,
        dot_number,
    )

    if not row:
        raise HTTPException(status_code=404, detail="Carrier not found")

    carrier = CarrierDetail(
        dot_number=row["dot_number"],
        mc_number=row["mc_number"],
        legal_name=row["legal_name"],
        dba_name=row["dba_name"],
        carrier_operation=row["carrier_operation"],
        hm_flag=row["hm_flag"],
        pc_flag=row["pc_flag"],
        physical_address=row["physical_address"],
        physical_city=row["physical_city"],
        physical_state=row["physical_state"],
        physical_zip=row["physical_zip"],
        mailing_address=row["mailing_address"],
        mailing_city=row["mailing_city"],
        mailing_state=row["mailing_state"],
        mailing_zip=row["mailing_zip"],
        phone=row["phone"],
        power_units=row["power_units"] or 0,
        drivers=row["drivers"] or 0,
        operating_status=row["operating_status"],
        authority_grant_date=row["authority_grant_date"],
        authority_status=row["authority_status"],
        common_authority=row["common_authority"],
        contract_authority=row["contract_authority"],
        broker_authority=row["broker_authority"],
        safety_rating=row["safety_rating"],
        safety_rating_date=row["safety_rating_date"],
        insurance_bipd_on_file=row["insurance_bipd_on_file"] or 0,
        insurance_bipd_required=row["insurance_bipd_required"] or 0,
        total_inspections=row["total_inspections"] or 0,
        total_crashes=row["total_crashes"] or 0,
        fatal_crashes=row["fatal_crashes"] or 0,
        injury_crashes=row["injury_crashes"] or 0,
        tow_crashes=row["tow_crashes"] or 0,
        vehicle_oos_rate=float(row["vehicle_oos_rate"] or 0),
        driver_oos_rate=float(row["driver_oos_rate"] or 0),
        hazmat_oos_rate=float(row["hazmat_oos_rate"] or 0),
        eld_violations=row["eld_violations"] or 0,
        hos_violations=row["hos_violations"] or 0,
        address_hash=row["address_hash"],
        risk_score=row["risk_score"] or 0,
        risk_flags=row["risk_flags"] or [],
        ppp_loan_count=row["ppp_loan_count"] or 0,
        ppp_loan_total=float(row["ppp_loan_total"] or 0),
        ppp_forgiven_total=float(row["ppp_forgiven_total"] or 0),
        latitude=row["latitude"],
        longitude=row["longitude"],
    )

    # Get PPP loan details
    if carrier.ppp_loan_count > 0:
        ppp_rows = await pool.fetch(
            """
            SELECT loan_amount, forgiveness_amount, forgiveness_date::text,
                   loan_status, jobs_reported, lender, date_approved::text,
                   match_confidence
            FROM ppp_loans
            WHERE matched_dot_number = $1
            ORDER BY loan_amount DESC
            """,
            dot_number,
        )
        carrier.ppp_loans = [
            PPPLoan(
                loan_amount=float(r["loan_amount"] or 0),
                forgiveness_amount=float(r["forgiveness_amount"] or 0),
                forgiveness_date=r["forgiveness_date"],
                loan_status=r["loan_status"],
                jobs_reported=r["jobs_reported"] or 0,
                lender=r["lender"],
                date_approved=r["date_approved"],
                match_confidence=r["match_confidence"],
            )
            for r in ppp_rows
        ]

    # Get co-located carriers
    if row["address_hash"]:
        colocated = await pool.fetch(
            """
            SELECT dot_number, legal_name, dba_name, physical_city, physical_state,
                   operating_status, power_units, drivers, safety_rating,
                   total_crashes, vehicle_oos_rate,
                   COALESCE(risk_score, 0) AS risk_score,
                   ST_Y(location::geometry) AS latitude,
                   ST_X(location::geometry) AS longitude
            FROM carriers
            WHERE address_hash = $1 AND dot_number != $2
            ORDER BY risk_score DESC, dot_number
            LIMIT 100
            """,
            row["address_hash"], dot_number,
        )
        carrier.colocated_carriers = [
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
                risk_score=c["risk_score"],
                latitude=c["latitude"],
                longitude=c["longitude"],
            )
            for c in colocated
        ]

    return carrier


@router.get("", response_model=PaginatedResponse)
async def list_carriers(
    state: str | None = None,
    status: str | None = None,
    rating: str | None = None,
    min_fleet: int | None = None,
    max_fleet: int | None = None,
    min_overlap: int | None = None,
    has_crashes: bool | None = None,
    min_risk: int | None = None,
    has_ppp: bool | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    """Filter and list carriers with pagination."""
    pool = await get_conn()

    conditions = []
    params = []
    idx = 1

    if state:
        conditions.append(f"c.physical_state = ${idx}")
        params.append(state.upper())
        idx += 1

    if status:
        conditions.append(f"c.operating_status = ${idx}")
        params.append(status.upper())
        idx += 1

    if rating:
        conditions.append(f"c.safety_rating = ${idx}")
        params.append(rating)
        idx += 1

    if min_fleet is not None:
        conditions.append(f"c.power_units >= ${idx}")
        params.append(min_fleet)
        idx += 1

    if max_fleet is not None:
        conditions.append(f"c.power_units <= ${idx}")
        params.append(max_fleet)
        idx += 1

    if has_crashes:
        conditions.append("c.total_crashes > 0")

    if min_risk is not None:
        conditions.append(f"c.risk_score >= ${idx}")
        params.append(min_risk)
        idx += 1

    if has_ppp:
        conditions.append("c.ppp_loan_count > 0")

    if min_overlap is not None:
        conditions.append(f"""c.address_hash IN (
            SELECT address_hash FROM address_clusters WHERE carrier_count >= ${idx}
        )""")
        params.append(min_overlap)
        idx += 1

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    offset = (page - 1) * limit

    count_sql = f"SELECT COUNT(*) FROM carriers c {where}"
    total = await pool.fetchval(count_sql, *params)

    data_sql = f"""
        SELECT c.dot_number, c.legal_name, c.dba_name, c.physical_city, c.physical_state,
               c.operating_status, c.power_units, c.drivers, c.safety_rating,
               c.total_crashes, c.vehicle_oos_rate,
               COALESCE(c.risk_score, 0) AS risk_score,
               ST_Y(c.location::geometry) AS latitude,
               ST_X(c.location::geometry) AS longitude
        FROM carriers c
        {where}
        ORDER BY c.risk_score DESC NULLS LAST, c.dot_number
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    rows = await pool.fetch(data_sql, *params)

    items = [
        CarrierSummary(
            dot_number=r["dot_number"],
            legal_name=r["legal_name"],
            dba_name=r["dba_name"],
            physical_city=r["physical_city"],
            physical_state=r["physical_state"],
            operating_status=r["operating_status"],
            power_units=r["power_units"] or 0,
            drivers=r["drivers"] or 0,
            safety_rating=r["safety_rating"],
            total_crashes=r["total_crashes"] or 0,
            vehicle_oos_rate=float(r["vehicle_oos_rate"] or 0),
            risk_score=r["risk_score"],
            latitude=r["latitude"],
            longitude=r["longitude"],
        )
        for r in rows
    ]

    pages = (total + limit - 1) // limit if total > 0 else 1

    return PaginatedResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=pages,
    )
