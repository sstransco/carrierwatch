import { useEffect, useState } from "react";
import type { TopRiskCarrier } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const RISK_FLAGS = [
  { value: "", label: "All Flags" },
  { value: "FOREIGN_CARRIER", label: "Foreign Carrier" },
  { value: "FOREIGN_LINKED_OFFICER", label: "Foreign Linked Officer" },
  { value: "FOREIGN_LINKED_ADDRESS", label: "Foreign Linked Address" },
  { value: "FOREIGN_MAILING", label: "Foreign Mailing" },
  { value: "FATAL_CRASHES", label: "Fatal Crashes" },
  { value: "HIGH_ELD_VIOLATION_RATE", label: "High ELD Rate" },
  { value: "ELD_VIOLATIONS_5_PLUS", label: "ELD Violations 5+" },
  { value: "OFFICER_25_PLUS", label: "Officer 25+ Carriers" },
  { value: "OFFICER_10_PLUS", label: "Officer 10+ Carriers" },
  { value: "LARGE_PPP_LOAN", label: "Large PPP Loan" },
  { value: "INSURANCE_LAPSE", label: "Insurance Lapse" },
  { value: "HIGH_VEHICLE_OOS", label: "High Vehicle OOS" },
  { value: "HIGH_DRIVER_OOS", label: "High Driver OOS" },
  { value: "AUTHORITY_REVOKED_REISSUED", label: "Authority Revoked" },
  { value: "PO_BOX_ADDRESS", label: "PO Box Address" },
];

interface RiskLeaderboardProps {
  onFlyTo: (lng: number, lat: number, zoom?: number) => void;
}

function riskClass(score: number): string {
  if (score >= 70) return "risk-critical";
  if (score >= 50) return "risk-high";
  if (score >= 30) return "risk-medium";
  if (score > 0) return "risk-low";
  return "risk-none";
}

export default function RiskLeaderboard({ onFlyTo }: RiskLeaderboardProps) {
  const [state, setState] = useState<string>("");
  const [flag, setFlag] = useState<string>("");
  const [carriers, setCarriers] = useState<TopRiskCarrier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "50", min_score: "30" });
    if (state) params.set("state", state);
    if (flag) params.set("flag", flag);
    fetch(`${API_URL}/api/carriers/top-risk?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => { setCarriers(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [state, flag]);

  const handleClick = (carrier: TopRiskCarrier) => {
    if (carrier.latitude && carrier.longitude) {
      onFlyTo(carrier.longitude, carrier.latitude, 12);
    }
  };

  return (
    <div>
      <div className="filter-group">
        <label>Filter by State</label>
        <select
          className="filter-select"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">All States</option>
          {STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label>Filter by Risk Flag</label>
        <select
          className="filter-select"
          value={flag}
          onChange={(e) => setFlag(e.target.value)}
        >
          {RISK_FLAGS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="skeleton-rows">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton" style={{ width: 20, height: 14 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton skeleton-text" style={{ width: "70%", marginBottom: 4 }} />
                <div className="skeleton skeleton-text" style={{ width: "45%", height: 10 }} />
              </div>
              <div className="skeleton skeleton-badge" style={{ width: 36 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="error-state">
          <div className="error-title">Failed to load</div>
          <p>{error}</p>
          <button className="retry-btn" onClick={() => { setState(state); setFlag(flag); }}>Retry</button>
        </div>
      ) : carriers.length === 0 ? (
        <div className="loading" style={{ textAlign: "center", padding: "20px 0" }}>
          No carriers found{state ? ` in ${state}` : ""}{flag ? ` with ${flag.replace(/_/g, " ").toLowerCase()}` : ""}
        </div>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Carrier</th>
              <th>Risk</th>
              <th>Fleet</th>
              <th>Crashes</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((c, i) => (
              <tr key={c.dot_number} onClick={() => handleClick(c)}>
                <td>{i + 1}</td>
                <td>
                  <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
                    {c.legal_name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    DOT# {c.dot_number} {c.physical_state ? `\u00b7 ${c.physical_state}` : ""}
                    {c.operating_status ? ` \u00b7 ${c.operating_status}` : ""}
                  </div>
                </td>
                <td>
                  <span className={`risk-badge-sm ${riskClass(c.risk_score)}`}>
                    {c.risk_score}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {c.power_units}
                </td>
                <td style={{ fontSize: 12, color: c.total_crashes > 0 ? "var(--danger)" : "var(--text-secondary)" }}>
                  {c.total_crashes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
