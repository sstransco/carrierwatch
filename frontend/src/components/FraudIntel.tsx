import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FraudIntelStats, ChameleonPair, FraudRing, InsuranceCompanyStats } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";

type Tab = "chameleons" | "rings" | "insurance";

function confidenceClass(c: string): string {
  if (c === "high") return "risk-critical";
  if (c === "medium") return "risk-high";
  return "risk-medium";
}

function signalLabel(s: string): string {
  const labels: Record<string, string> = {
    address: "Same Address",
    officer: "Shared Officer",
    phone: "Same Phone",
  };
  return labels[s] || s;
}

export default function FraudIntel() {
  const [stats, setStats] = useState<FraudIntelStats | null>(null);
  const [tab, setTab] = useState<Tab>("chameleons");
  const [chameleons, setChameleons] = useState<ChameleonPair[]>([]);
  const [rings, setRings] = useState<FraudRing[]>([]);
  const [insurance, setInsurance] = useState<InsuranceCompanyStats[]>([]);
  const [confFilter, setConfFilter] = useState<string>("");
  const [insSort, setInsSort] = useState("carriers_insured");
  const [loading, setLoading] = useState(true);

  // Load stats
  useEffect(() => {
    fetch(`${API_URL}/api/fraud-intel/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Load tab data
  useEffect(() => {
    if (tab === "chameleons") {
      const params = new URLSearchParams({ limit: "100" });
      if (confFilter) params.set("confidence", confFilter);
      fetch(`${API_URL}/api/fraud-intel/chameleons?${params}`)
        .then((r) => r.json())
        .then(setChameleons)
        .catch(console.error);
    } else if (tab === "rings") {
      const params = new URLSearchParams({ limit: "100" });
      if (confFilter) params.set("confidence", confFilter);
      fetch(`${API_URL}/api/fraud-intel/rings?${params}`)
        .then((r) => r.json())
        .then(setRings)
        .catch(console.error);
    } else if (tab === "insurance") {
      const params = new URLSearchParams({ limit: "100", sort: insSort, min_carriers: "50" });
      fetch(`${API_URL}/api/fraud-intel/insurance?${params}`)
        .then((r) => r.json())
        .then(setInsurance)
        .catch(console.error);
    }
  }, [tab, confFilter, insSort]);

  if (loading) {
    return (
      <div className="detail-page">
        <div className="detail-container" style={{ textAlign: "center", padding: 60 }}>
          Loading fraud intelligence...
        </div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div className="detail-container" style={{ maxWidth: 1200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <Link to="/" className="back-link">Map</Link>
          <h1 style={{ margin: 0, fontSize: 22 }}>Fraud Intelligence</h1>
        </div>

        {/* Stats cards */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            <div className="stat-card">
              <div className="stat-value">{stats.total_chameleon_pairs.toLocaleString()}</div>
              <div className="stat-label">Chameleon Pairs</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.high_confidence_pairs.toLocaleString()}</div>
              <div className="stat-label">High Confidence</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total_fraud_rings.toLocaleString()}</div>
              <div className="stat-label">Fraud Rings</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.carriers_in_rings.toLocaleString()}</div>
              <div className="stat-label">Carriers in Rings</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.insurance_companies.toLocaleString()}</div>
              <div className="stat-label">Insurance Cos.</div>
            </div>
          </div>
        )}

        {/* Tab nav */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          {(["chameleons", "rings", "insurance"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "10px 20px",
                background: "none",
                border: "none",
                borderBottom: tab === t ? "2px solid #60a5fa" : "2px solid transparent",
                color: tab === t ? "#60a5fa" : "#888",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: tab === t ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {t === "chameleons" ? "Chameleon Carriers" : t === "rings" ? "Fraud Rings" : "Insurance Companies"}
            </button>
          ))}
        </div>

        {/* Filter row */}
        {(tab === "chameleons" || tab === "rings") && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <select
              value={confFilter}
              onChange={(e) => setConfFilter(e.target.value)}
              style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333", borderRadius: 4, padding: "4px 8px", fontSize: 13 }}
            >
              <option value="">All confidence</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        )}

        {tab === "insurance" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <select
              value={insSort}
              onChange={(e) => setInsSort(e.target.value)}
              style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333", borderRadius: 4, padding: "4px 8px", fontSize: 13 }}
            >
              <option value="carriers_insured">Most Carriers</option>
              <option value="cancellation_rate">Highest Cancellation Rate</option>
              <option value="high_risk_carriers">Most High-Risk Carriers</option>
              <option value="avg_carrier_risk">Highest Avg Risk</option>
              <option value="total_crashes">Most Crashes</option>
            </select>
          </div>
        )}

        {/* Chameleons tab */}
        {tab === "chameleons" && (
          <div>
            <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
              Chameleon carriers shut down and reopen under new DOT numbers to evade safety records.
              Pairs are matched by shared address, officers, and phone numbers.
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Predecessor</th>
                  <th>Successor</th>
                  <th>Gap</th>
                  <th>Signals</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {chameleons.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/carrier/${c.predecessor_dot}`} className="carrier-link">
                        {c.predecessor_name || `DOT ${c.predecessor_dot}`}
                      </Link>
                      <div style={{ color: "#666", fontSize: 11 }}>DOT {c.predecessor_dot}</div>
                    </td>
                    <td>
                      <Link to={`/carrier/${c.successor_dot}`} className="carrier-link">
                        {c.successor_name || `DOT ${c.successor_dot}`}
                      </Link>
                      <div style={{ color: "#666", fontSize: 11 }}>DOT {c.successor_dot}</div>
                    </td>
                    <td>{c.days_gap != null ? `${c.days_gap}d` : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {c.match_signals.map((s) => (
                          <span key={s} className="flag-badge" style={{ fontSize: 10 }}>
                            {signalLabel(s)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={`risk-badge ${confidenceClass(c.confidence)}`}>
                        {c.confidence.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
                {chameleons.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "#666", padding: 30 }}>No chameleon pairs found. Run the detection pipeline first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Fraud rings tab */}
        {tab === "rings" && (
          <div>
            <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
              Fraud rings are groups of 3+ carriers connected by sharing 2+ officers.
              Higher combined risk and more carriers indicate larger organized fraud networks.
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ring</th>
                  <th>Carriers</th>
                  <th>Active</th>
                  <th>Officers</th>
                  <th>Crashes</th>
                  <th>Fatalities</th>
                  <th>Combined Risk</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rings.map((r) => (
                  <tr key={r.ring_id}>
                    <td>#{r.ring_id}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 200 }}>
                        {r.carrier_dots.slice(0, 5).map((d) => (
                          <Link key={d} to={`/carrier/${d}`} className="carrier-link" style={{ fontSize: 11 }}>
                            {d}
                          </Link>
                        ))}
                        {r.carrier_dots.length > 5 && (
                          <span style={{ color: "#666", fontSize: 11 }}>+{r.carrier_dots.length - 5} more</span>
                        )}
                      </div>
                    </td>
                    <td>{r.active_count}/{r.carrier_count}</td>
                    <td>
                      <div style={{ maxWidth: 150, fontSize: 11, color: "#aaa" }}>
                        {r.officer_names.slice(0, 3).join(", ")}
                        {r.officer_names.length > 3 && ` +${r.officer_names.length - 3}`}
                      </div>
                    </td>
                    <td>{r.total_crashes}</td>
                    <td style={{ color: r.total_fatalities > 0 ? "#ef4444" : "inherit" }}>
                      {r.total_fatalities}
                    </td>
                    <td>{r.combined_risk.toLocaleString()}</td>
                    <td>
                      <span className={`risk-badge ${confidenceClass(r.confidence)}`}>
                        {r.confidence.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
                {rings.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", color: "#666", padding: 30 }}>No fraud rings found. Run the detection pipeline first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Insurance tab */}
        {tab === "insurance" && (
          <div>
            <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
              Insurance company analysis shows which insurers cover the most high-risk carriers
              and have the highest policy cancellation rates.
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Insurance Company</th>
                  <th>Carriers</th>
                  <th>Policies</th>
                  <th>Cancel Rate</th>
                  <th>High Risk</th>
                  <th>Avg Risk</th>
                  <th>Crashes</th>
                </tr>
              </thead>
              <tbody>
                {insurance.map((ins) => (
                  <tr key={ins.insurance_company}>
                    <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ins.insurance_company}
                    </td>
                    <td>{ins.carriers_insured.toLocaleString()}</td>
                    <td>{ins.total_policies.toLocaleString()}</td>
                    <td style={{ color: ins.cancellation_rate > 50 ? "#ef4444" : ins.cancellation_rate > 30 ? "#f59e0b" : "inherit" }}>
                      {ins.cancellation_rate}%
                    </td>
                    <td>{ins.high_risk_carriers.toLocaleString()}</td>
                    <td>{ins.avg_carrier_risk}</td>
                    <td>{ins.total_crashes.toLocaleString()}</td>
                  </tr>
                ))}
                {insurance.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", color: "#666", padding: 30 }}>No insurance data. Run the migration and refresh the materialized view first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
