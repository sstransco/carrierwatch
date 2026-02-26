from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from database import get_conn
from models import ChameleonPair, FraudIntelStats, FraudRing, InsuranceCompanyStats

router = APIRouter(prefix="/api/fraud-intel", tags=["fraud-intel"])


@router.get("/stats", response_model=FraudIntelStats)
async def fraud_intel_stats():
    """Overview stats for fraud intelligence dashboard."""
    pool = await get_conn()
    row = await pool.fetchrow("""
        SELECT
            (SELECT COUNT(*) FROM chameleon_pairs) AS total_chameleon_pairs,
            (SELECT COUNT(*) FROM chameleon_pairs WHERE confidence = 'high') AS high_confidence_pairs,
            (SELECT COUNT(*) FROM chameleon_pairs WHERE confidence = 'medium') AS medium_confidence_pairs,
            (SELECT COUNT(*) FROM fraud_rings) AS total_fraud_rings,
            (SELECT COUNT(*) FROM fraud_rings WHERE confidence = 'high') AS high_confidence_rings,
            (SELECT COALESCE(SUM(carrier_count), 0) FROM fraud_rings) AS carriers_in_rings,
            (SELECT COUNT(*) FROM insurance_company_stats) AS insurance_companies
    """)
    return FraudIntelStats(**dict(row))


# ── Chameleon pairs ──────────────────────────────────────────

@router.get("/chameleons", response_model=list[ChameleonPair])
async def list_chameleon_pairs(
    confidence: str | None = Query(None, regex="^(low|medium|high)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List chameleon carrier pairs, optionally filtered by confidence."""
    pool = await get_conn()

    where = ""
    args = []
    idx = 1

    if confidence:
        where = f"WHERE cp.confidence = ${idx}"
        args.append(confidence)
        idx += 1

    rows = await pool.fetch(f"""
        SELECT
            cp.id, cp.predecessor_dot, cp.successor_dot,
            pred.legal_name AS predecessor_name,
            succ.legal_name AS successor_name,
            cp.deactivation_date, cp.activation_date,
            cp.days_gap, cp.match_signals, cp.signal_count, cp.confidence
        FROM chameleon_pairs cp
        LEFT JOIN carriers pred ON cp.predecessor_dot = pred.dot_number
        LEFT JOIN carriers succ ON cp.successor_dot = succ.dot_number
        {where}
        ORDER BY cp.signal_count DESC, cp.days_gap ASC
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *args, limit, offset)

    return [ChameleonPair(**dict(r)) for r in rows]


@router.get("/chameleons/carrier/{dot_number}", response_model=list[ChameleonPair])
async def chameleon_pairs_for_carrier(dot_number: int):
    """Get all chameleon pairs involving a specific carrier (as predecessor or successor)."""
    pool = await get_conn()
    rows = await pool.fetch("""
        SELECT
            cp.id, cp.predecessor_dot, cp.successor_dot,
            pred.legal_name AS predecessor_name,
            succ.legal_name AS successor_name,
            cp.deactivation_date, cp.activation_date,
            cp.days_gap, cp.match_signals, cp.signal_count, cp.confidence
        FROM chameleon_pairs cp
        LEFT JOIN carriers pred ON cp.predecessor_dot = pred.dot_number
        LEFT JOIN carriers succ ON cp.successor_dot = succ.dot_number
        WHERE cp.predecessor_dot = $1 OR cp.successor_dot = $1
        ORDER BY cp.signal_count DESC
    """, dot_number)

    return [ChameleonPair(**dict(r)) for r in rows]


# ── Fraud rings ──────────────────────────────────────────────

@router.get("/rings", response_model=list[FraudRing])
async def list_fraud_rings(
    confidence: str | None = Query(None, regex="^(low|medium|high)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List fraud rings, optionally filtered by confidence."""
    pool = await get_conn()

    where = ""
    args = []
    idx = 1

    if confidence:
        where = f"WHERE confidence = ${idx}"
        args.append(confidence)
        idx += 1

    rows = await pool.fetch(f"""
        SELECT ring_id, carrier_dots, officer_names, shared_addresses,
               carrier_count, active_count, total_crashes, total_fatalities,
               combined_risk, confidence
        FROM fraud_rings
        {where}
        ORDER BY combined_risk DESC, carrier_count DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *args, limit, offset)

    return [FraudRing(**dict(r)) for r in rows]


@router.get("/rings/{ring_id}", response_model=FraudRing)
async def get_fraud_ring(ring_id: int):
    """Get a single fraud ring by ID."""
    pool = await get_conn()
    row = await pool.fetchrow("""
        SELECT ring_id, carrier_dots, officer_names, shared_addresses,
               carrier_count, active_count, total_crashes, total_fatalities,
               combined_risk, confidence
        FROM fraud_rings
        WHERE ring_id = $1
    """, ring_id)

    if not row:
        raise HTTPException(status_code=404, detail="Fraud ring not found")

    return FraudRing(**dict(row))


@router.get("/rings/carrier/{dot_number}", response_model=list[FraudRing])
async def fraud_rings_for_carrier(dot_number: int):
    """Get all fraud rings containing a specific carrier."""
    pool = await get_conn()
    rows = await pool.fetch("""
        SELECT ring_id, carrier_dots, officer_names, shared_addresses,
               carrier_count, active_count, total_crashes, total_fatalities,
               combined_risk, confidence
        FROM fraud_rings
        WHERE $1 = ANY(carrier_dots)
        ORDER BY combined_risk DESC
    """, dot_number)

    return [FraudRing(**dict(r)) for r in rows]


# ── Insurance companies ──────────────────────────────────────

@router.get("/insurance", response_model=list[InsuranceCompanyStats])
async def list_insurance_companies(
    sort: str = Query("carriers_insured", regex="^(carriers_insured|cancellation_rate|high_risk_carriers|avg_carrier_risk|total_crashes)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    min_carriers: int = Query(10, ge=1),
):
    """List insurance companies with stats, sorted by chosen metric."""
    pool = await get_conn()

    # Safe column names only (validated by regex above)
    rows = await pool.fetch(f"""
        SELECT insurance_company, carriers_insured, total_policies,
               cancellations, cancellation_rate, high_risk_carriers,
               avg_carrier_risk, total_crashes
        FROM insurance_company_stats
        WHERE carriers_insured >= $1
        ORDER BY {sort} DESC
        LIMIT $2 OFFSET $3
    """, min_carriers, limit, offset)

    return [InsuranceCompanyStats(**dict(r)) for r in rows]


@router.get("/insurance/{company_name}", response_model=InsuranceCompanyStats)
async def get_insurance_company(company_name: str):
    """Get stats for a specific insurance company."""
    pool = await get_conn()
    row = await pool.fetchrow("""
        SELECT insurance_company, carriers_insured, total_policies,
               cancellations, cancellation_rate, high_risk_carriers,
               avg_carrier_risk, total_crashes
        FROM insurance_company_stats
        WHERE insurance_company ILIKE $1
    """, company_name)

    if not row:
        raise HTTPException(status_code=404, detail="Insurance company not found")

    return InsuranceCompanyStats(**dict(row))
