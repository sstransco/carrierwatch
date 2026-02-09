from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class CarrierSummary(BaseModel):
    dot_number: int
    legal_name: str
    dba_name: str | None = None
    physical_city: str | None = None
    physical_state: str | None = None
    operating_status: str | None = None
    power_units: int = 0
    drivers: int = 0
    safety_rating: str | None = None
    total_crashes: int = 0
    vehicle_oos_rate: float = 0
    risk_score: int = 0
    latitude: float | None = None
    longitude: float | None = None


class PPPLoan(BaseModel):
    loan_amount: float = 0
    forgiveness_amount: float = 0
    forgiveness_date: str | None = None
    loan_status: str | None = None
    jobs_reported: int = 0
    lender: str | None = None
    date_approved: str | None = None
    match_confidence: str | None = None


class CarrierDetail(BaseModel):
    dot_number: int
    mc_number: str | None = None
    legal_name: str
    dba_name: str | None = None
    carrier_operation: str | None = None
    hm_flag: str | None = None
    pc_flag: str | None = None
    physical_address: str | None = None
    physical_city: str | None = None
    physical_state: str | None = None
    physical_zip: str | None = None
    mailing_address: str | None = None
    mailing_city: str | None = None
    mailing_state: str | None = None
    mailing_zip: str | None = None
    phone: str | None = None
    power_units: int = 0
    drivers: int = 0
    operating_status: str | None = None
    authority_grant_date: date | None = None
    authority_status: str | None = None
    common_authority: str | None = None
    contract_authority: str | None = None
    broker_authority: str | None = None
    safety_rating: str | None = None
    safety_rating_date: date | None = None
    insurance_bipd_on_file: int = 0
    insurance_bipd_required: int = 0
    total_inspections: int = 0
    total_crashes: int = 0
    fatal_crashes: int = 0
    injury_crashes: int = 0
    tow_crashes: int = 0
    vehicle_oos_rate: float = 0
    driver_oos_rate: float = 0
    hazmat_oos_rate: float = 0
    address_hash: str | None = None
    risk_score: int = 0
    risk_flags: list[str] = []
    ppp_loan_count: int = 0
    ppp_loan_total: float = 0
    ppp_forgiven_total: float = 0
    ppp_loans: list[PPPLoan] = []
    latitude: float | None = None
    longitude: float | None = None
    colocated_carriers: list[CarrierSummary] = []


class AddressCluster(BaseModel):
    address_hash: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    carrier_count: int
    active_count: int = 0
    total_crashes: int = 0
    avg_vehicle_oos_rate: float = 0
    latitude: float | None = None
    longitude: float | None = None


class StatsResponse(BaseModel):
    total_carriers: int
    active_carriers: int
    geocoded_carriers: int
    total_clusters: int
    flagged_clusters_5plus: int
    flagged_clusters_10plus: int
    top_cluster_count: int
    states_covered: int
    high_risk_carriers: int = 0
    carriers_with_ppp: int = 0
    total_ppp_matched: float = 0


class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int
    limit: int
    pages: int


class SearchResult(BaseModel):
    dot_number: int
    legal_name: str
    dba_name: str | None = None
    physical_city: str | None = None
    physical_state: str | None = None
    operating_status: str | None = None
    risk_score: int = 0
    match_type: str  # "dot", "mc", "name"
