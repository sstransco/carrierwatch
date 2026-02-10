export interface CarrierSummary {
  dot_number: number;
  legal_name: string;
  dba_name: string | null;
  physical_city: string | null;
  physical_state: string | null;
  operating_status: string | null;
  power_units: number;
  drivers: number;
  safety_rating: string | null;
  total_crashes: number;
  vehicle_oos_rate: number;
  risk_score: number;
  latitude: number | null;
  longitude: number | null;
}

export interface PPPLoan {
  loan_amount: number;
  forgiveness_amount: number;
  forgiveness_date: string | null;
  loan_status: string | null;
  jobs_reported: number;
  lender: string | null;
  date_approved: string | null;
  match_confidence: string | null;
}

export interface CarrierDetail extends CarrierSummary {
  mc_number: string | null;
  carrier_operation: string | null;
  hm_flag: string | null;
  pc_flag: string | null;
  physical_address: string | null;
  physical_zip: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  phone: string | null;
  authority_grant_date: string | null;
  authority_status: string | null;
  common_authority: string | null;
  contract_authority: string | null;
  broker_authority: string | null;
  safety_rating_date: string | null;
  insurance_bipd_on_file: number;
  insurance_bipd_required: number;
  total_inspections: number;
  fatal_crashes: number;
  injury_crashes: number;
  tow_crashes: number;
  driver_oos_rate: number;
  hazmat_oos_rate: number;
  eld_violations: number;
  hos_violations: number;
  address_hash: string | null;
  risk_flags: string[];
  ppp_loan_count: number;
  ppp_loan_total: number;
  ppp_forgiven_total: number;
  ppp_loans: PPPLoan[];
  colocated_carriers: CarrierSummary[];
}

export interface AddressCluster {
  address_hash: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  carrier_count: number;
  active_count: number;
  total_crashes: number;
  avg_vehicle_oos_rate: number;
  latitude: number | null;
  longitude: number | null;
}

export interface StatsResponse {
  total_carriers: number;
  active_carriers: number;
  geocoded_carriers: number;
  total_clusters: number;
  flagged_clusters_5plus: number;
  flagged_clusters_10plus: number;
  top_cluster_count: number;
  states_covered: number;
  high_risk_carriers: number;
  carriers_with_ppp: number;
  total_ppp_matched: number;
}

export interface TopRiskCarrier {
  dot_number: number;
  legal_name: string;
  physical_state: string | null;
  risk_score: number;
  risk_flags: string[];
  power_units: number;
  total_crashes: number;
  operating_status: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface SearchResult {
  dot_number: number;
  legal_name: string;
  dba_name: string | null;
  physical_city: string | null;
  physical_state: string | null;
  operating_status: string | null;
  risk_score: number;
  match_type: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface Principal {
  officer_name: string;
  officer_name_normalized: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  other_carrier_count: number;
  other_dot_numbers: number[];
}

export interface BatchCarrier {
  dot_number: number;
  legal_name: string;
  operating_status: string | null;
  risk_score: number;
  power_units: number;
  physical_state: string | null;
}

export interface PrincipalLeaderboardEntry {
  officer_name: string;
  carrier_count: number;
  statuses: string[];
  total_risk: number;
  dot_numbers: number[];
}

export interface MapLayer {
  id: string;
  label: string;
  visible: boolean;
}
