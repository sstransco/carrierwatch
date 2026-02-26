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

export interface ChameleonPair {
  id: number;
  predecessor_dot: number;
  successor_dot: number;
  predecessor_name: string | null;
  successor_name: string | null;
  deactivation_date: string | null;
  activation_date: string | null;
  days_gap: number | null;
  match_signals: string[];
  signal_count: number;
  confidence: string;
}

export interface FraudRing {
  ring_id: number;
  carrier_dots: number[];
  officer_names: string[];
  shared_addresses: string[];
  carrier_count: number;
  active_count: number;
  total_crashes: number;
  total_fatalities: number;
  combined_risk: number;
  confidence: string;
}

export interface InsuranceCompanyStats {
  insurance_company: string;
  carriers_insured: number;
  total_policies: number;
  cancellations: number;
  cancellation_rate: number;
  high_risk_carriers: number;
  avg_carrier_risk: number;
  total_crashes: number;
}

export interface FraudIntelStats {
  total_chameleon_pairs: number;
  high_confidence_pairs: number;
  medium_confidence_pairs: number;
  total_fraud_rings: number;
  high_confidence_rings: number;
  carriers_in_rings: number;
  insurance_companies: number;
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
  chameleon_pairs: ChameleonPair[];
  fraud_rings: FraudRing[];
  peer_crash_percentile: number | null;
  peer_oos_percentile: number | null;
  fleet_size_bucket: string | null;
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
  latitude: number | null;
  longitude: number | null;
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

export interface CountryBreakdown {
  country: string;
  carrier_count: number;
  active_count: number;
  high_risk_count: number;
  avg_risk: number;
  total_crashes: number;
}

export interface InternationalStats {
  total_foreign: number;
  linked_officer: number;
  linked_address: number;
  foreign_mailing: number;
  high_risk_foreign: number;
  countries: CountryBreakdown[];
}

export interface InternationalCarrier {
  dot_number: number;
  legal_name: string;
  physical_country: string;
  physical_state: string | null;
  risk_score: number;
  risk_flags: string[];
  power_units: number;
  total_crashes: number;
  operating_status: string | null;
  latitude: number | null;
  longitude: number | null;
}
