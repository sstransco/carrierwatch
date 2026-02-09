from __future__ import annotations

from fastapi import APIRouter, Query

from database import get_conn

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/carriers/{dot_number}/inspections")
async def get_inspections(
    dot_number: int,
    limit: int = Query(50, ge=1, le=200),
):
    """Get inspection records for a carrier."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT inspection_id, report_state, report_number, insp_date,
               insp_level_id, location_desc, viol_total, oos_total,
               driver_viol_total, driver_oos_total,
               vehicle_viol_total, vehicle_oos_total,
               hazmat_viol_total, hazmat_oos_total, post_acc_ind
        FROM inspections
        WHERE dot_number = $1
        ORDER BY insp_date DESC
        LIMIT $2
        """,
        dot_number, limit,
    )
    return [
        {
            "inspection_id": r["inspection_id"],
            "report_state": r["report_state"],
            "report_number": r["report_number"],
            "date": str(r["insp_date"]) if r["insp_date"] else None,
            "level": r["insp_level_id"],
            "location": r["location_desc"],
            "violations": r["viol_total"],
            "oos_total": r["oos_total"],
            "driver_violations": r["driver_viol_total"],
            "driver_oos": r["driver_oos_total"],
            "vehicle_violations": r["vehicle_viol_total"],
            "vehicle_oos": r["vehicle_oos_total"],
            "hazmat_violations": r["hazmat_viol_total"],
            "hazmat_oos": r["hazmat_oos_total"],
            "post_crash": r["post_acc_ind"] == "Y",
        }
        for r in rows
    ]


@router.get("/carriers/{dot_number}/crashes")
async def get_crashes(
    dot_number: int,
    limit: int = Query(50, ge=1, le=200),
):
    """Get crash records for a carrier."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT crash_id, report_state, report_date, location, city, state,
               fatalities, injuries, tow_away, hazmat_released,
               federal_recordable, weather_condition_id,
               light_condition_id, road_surface_condition_id
        FROM crashes
        WHERE dot_number = $1
        ORDER BY report_date DESC
        LIMIT $2
        """,
        dot_number, limit,
    )
    return [
        {
            "crash_id": r["crash_id"],
            "report_state": r["report_state"],
            "date": str(r["report_date"]) if r["report_date"] else None,
            "location": r["location"],
            "city": r["city"],
            "state": r["state"],
            "fatalities": r["fatalities"],
            "injuries": r["injuries"],
            "tow_away": r["tow_away"],
            "hazmat_released": r["hazmat_released"] == "Y",
            "federal_recordable": r["federal_recordable"] == "Y",
            "weather": r["weather_condition_id"],
            "lighting": r["light_condition_id"],
            "road_surface": r["road_surface_condition_id"],
        }
        for r in rows
    ]


@router.get("/carriers/{dot_number}/authority")
async def get_authority(dot_number: int):
    """Get authority history for a carrier."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT docket_number, legal_name, dba_name,
               common_stat, contract_stat, broker_stat,
               common_app_pend, contract_app_pend, broker_app_pend,
               common_rev_pend, contract_rev_pend, broker_rev_pend,
               property_chk, passenger_chk, hhg_chk,
               private_auth_chk, enterprise_chk,
               bus_street, bus_city, bus_state, bus_zip
        FROM authority_history
        WHERE dot_number = $1
        ORDER BY id DESC
        """,
        dot_number,
    )
    return [
        {
            "docket_number": r["docket_number"],
            "legal_name": r["legal_name"],
            "dba_name": r["dba_name"],
            "common_authority": r["common_stat"],
            "contract_authority": r["contract_stat"],
            "broker_authority": r["broker_stat"],
            "common_app_pending": r["common_app_pend"] == "Y",
            "contract_app_pending": r["contract_app_pend"] == "Y",
            "broker_app_pending": r["broker_app_pend"] == "Y",
            "common_rev_pending": r["common_rev_pend"] == "Y",
            "contract_rev_pending": r["contract_rev_pend"] == "Y",
            "broker_rev_pending": r["broker_rev_pend"] == "Y",
            "property": r["property_chk"] == "X",
            "passenger": r["passenger_chk"] == "X",
            "household_goods": r["hhg_chk"] == "X",
            "private": r["private_auth_chk"] == "X",
            "enterprise": r["enterprise_chk"] == "X",
            "address": r["bus_street"],
            "city": r["bus_city"],
            "state": r["bus_state"],
            "zip": r["bus_zip"],
        }
        for r in rows
    ]


@router.get("/carriers/{dot_number}/insurance")
async def get_insurance(
    dot_number: int,
    limit: int = Query(50, ge=1, le=200),
):
    """Get insurance history for a carrier."""
    pool = await get_conn()
    rows = await pool.fetch(
        """
        SELECT docket_number, ins_form_code, ins_cancl_form,
               policy_no, min_cov_amount, ins_class_code,
               effective_date, cancl_effective_date, cancl_method,
               insurance_company
        FROM insurance_history
        WHERE dot_number = $1
        ORDER BY effective_date DESC NULLS LAST
        LIMIT $2
        """,
        dot_number, limit,
    )
    return [
        {
            "docket_number": r["docket_number"],
            "form_type": r["ins_form_code"],
            "cancellation_form": r["ins_cancl_form"],
            "policy_number": r["policy_no"],
            "coverage_amount": float(r["min_cov_amount"]) if r["min_cov_amount"] else None,
            "class_code": r["ins_class_code"],
            "effective_date": str(r["effective_date"]) if r["effective_date"] else None,
            "cancellation_date": str(r["cancl_effective_date"]) if r["cancl_effective_date"] else None,
            "cancellation_method": r["cancl_method"],
            "insurance_company": r["insurance_company"],
            "is_active": r["cancl_effective_date"] is None,
        }
        for r in rows
    ]
