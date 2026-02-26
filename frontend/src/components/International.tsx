import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { InternationalStats, InternationalCarrier } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";

const COUNTRY_NAMES: Record<string, string> = {
  CA: "Canada", MX: "Mexico", GT: "Guatemala", SV: "El Salvador",
  HN: "Honduras", CR: "Costa Rica", NI: "Nicaragua", BZ: "Belize",
  PA: "Panama", CO: "Colombia", GB: "United Kingdom", CN: "China",
  IN: "India", PK: "Pakistan", DO: "Dominican Republic", BR: "Brazil",
  DE: "Germany", FR: "France", AU: "Australia", JP: "Japan",
  ZA: "South Africa", NG: "Nigeria", KE: "Kenya", GH: "Ghana",
  EG: "Egypt", IL: "Israel", AE: "UAE", SA: "Saudi Arabia",
  PH: "Philippines", BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal",
  TH: "Thailand", VN: "Vietnam", KR: "South Korea", TW: "Taiwan",
  NZ: "New Zealand", AR: "Argentina", CL: "Chile", PE: "Peru",
  EC: "Ecuador", VE: "Venezuela", UY: "Uruguay", PY: "Paraguay",
  BO: "Bolivia", JM: "Jamaica", TT: "Trinidad & Tobago", HT: "Haiti",
  CU: "Cuba", PR: "Puerto Rico", GY: "Guyana", SR: "Suriname",
  IT: "Italy", ES: "Spain", PT: "Portugal", NL: "Netherlands",
  BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden",
  NO: "Norway", DK: "Denmark", FI: "Finland", PL: "Poland",
  RO: "Romania", UA: "Ukraine", RU: "Russia", TR: "Turkey",
  GR: "Greece", IE: "Ireland", CZ: "Czechia", HU: "Hungary",
};

function countryName(code: string): string {
  return COUNTRY_NAMES[code] || code;
}

function riskClass(score: number): string {
  if (score >= 70) return "risk-critical";
  if (score >= 50) return "risk-high";
  if (score >= 30) return "risk-medium";
  if (score > 0) return "risk-low";
  return "risk-none";
}

export default function International() {
  const { countryCode } = useParams<{ countryCode?: string }>();
  const [stats, setStats] = useState<InternationalStats | null>(null);
  const [carriers, setCarriers] = useState<InternationalCarrier[]>([]);
  const [linked, setLinked] = useState<InternationalCarrier[]>([]);
  const country = countryCode?.toUpperCase() || "";
  const [linkType, setLinkType] = useState("officer");
  const [loading, setLoading] = useState(true);

  // Load stats on mount
  useEffect(() => {
    fetch(`${API_URL}/api/international/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Load top foreign carriers (filtered by country from URL)
  useEffect(() => {
    const params = new URLSearchParams({ limit: "100", min_risk: "0" });
    if (country) params.set("country", country);
    fetch(`${API_URL}/api/international/carriers?${params}`)
      .then((r) => r.json())
      .then(setCarriers)
      .catch(console.error);
  }, [country]);

  // Load linked US carriers
  useEffect(() => {
    const params = new URLSearchParams({ limit: "50", link_type: linkType });
    fetch(`${API_URL}/api/international/linked?${params}`)
      .then((r) => r.json())
      .then(setLinked)
      .catch(console.error);
  }, [linkType]);

  const countryStats = stats?.countries.find((c) => c.country === country);

  if (loading) {
    return (
      <div className="detail-page">
        <div className="loading">Loading international carrier data...</div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      {country ? (
        <Link to="/international" className="detail-back">&larr; All Countries</Link>
      ) : (
        <Link to="/" className="detail-back">&larr; Back to map</Link>
      )}

      <div className="detail-header">
        {country ? (
          <>
            <h1>{countryName(country)} <span style={{ fontSize: 18, color: "var(--text-muted)" }}>{country}</span></h1>
            {countryStats && (
              <p style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                {countryStats.carrier_count.toLocaleString()} carriers registered &middot; {countryStats.active_count.toLocaleString()} active &middot; {countryStats.total_crashes.toLocaleString()} crashes
              </p>
            )}
          </>
        ) : (
          <>
            <h1>Foreign-Registered Carriers</h1>
            {stats && (
              <p style={{ color: "var(--text-secondary)", marginTop: 4 }}>
                {stats.total_foreign.toLocaleString()} foreign carriers across {stats.countries.length} countries
              </p>
            )}
          </>
        )}
      </div>

      {/* Stats Cards */}
      {country && countryStats ? (
        <div className="detail-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#e11d48" }}>{countryStats.carrier_count.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Carriers</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--success)" }}>{countryStats.active_count.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Active</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--danger)" }}>{countryStats.high_risk_count.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>High Risk</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--warning)" }}>{Math.round(countryStats.avg_risk)}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Avg Risk Score</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: countryStats.total_crashes > 0 ? "var(--danger)" : "var(--text-secondary)" }}>{countryStats.total_crashes.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Crashes</div>
          </div>
        </div>
      ) : stats && !country ? (
        <div className="detail-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#e11d48" }}>{stats.total_foreign.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Foreign Carriers</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--warning)" }}>{stats.linked_officer.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>US Linked via Officers</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--danger)" }}>{stats.high_risk_foreign.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>High Risk Foreign</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>{stats.foreign_mailing.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Foreign Mailing Addr</div>
          </div>
        </div>
      ) : null}

      {/* Country Breakdown — only on overview page */}
      {!country && stats && stats.countries.length > 0 && (
        <div className="detail-card" style={{ marginBottom: 24 }}>
          <h2 style={{ marginBottom: 12 }}>Country Breakdown</h2>
          <div className="history-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Country</th>
                  <th>Carriers</th>
                  <th>Active</th>
                  <th>High Risk</th>
                  <th>Avg Risk</th>
                  <th>Crashes</th>
                </tr>
              </thead>
              <tbody>
                {stats.countries.map((c, i) => (
                  <tr key={c.country}>
                    <td>{i + 1}</td>
                    <td>
                      <Link to={`/international/${c.country}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                        <strong>{countryName(c.country)}</strong>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>{c.country}</span>
                      </Link>
                    </td>
                    <td>{c.carrier_count.toLocaleString()}</td>
                    <td>{c.active_count.toLocaleString()}</td>
                    <td style={{ color: c.high_risk_count > 0 ? "var(--danger)" : "inherit" }}>
                      {c.high_risk_count.toLocaleString()}
                    </td>
                    <td>
                      <span className={`risk-badge-sm ${riskClass(c.avg_risk)}`}>{Math.round(c.avg_risk)}</span>
                    </td>
                    <td style={{ color: c.total_crashes > 0 ? "var(--danger)" : "inherit" }}>
                      {c.total_crashes.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Foreign Carriers */}
      <div className="detail-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2>{country ? `${countryName(country)} Carriers` : "Top Foreign Carriers by Risk"}</h2>
          {!country && (
            <select
              className="filter-select"
              value=""
              onChange={(e) => { if (e.target.value) window.location.href = `/international/${e.target.value}`; }}
              style={{ width: "auto", minWidth: 140 }}
            >
              <option value="">All Countries</option>
              {stats?.countries.map((c) => (
                <option key={c.country} value={c.country}>{countryName(c.country)} ({c.carrier_count.toLocaleString()})</option>
              ))}
            </select>
          )}
        </div>
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Carrier</th>
                <th>Country</th>
                <th>Risk</th>
                <th>Fleet</th>
                <th>Crashes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {carriers.map((c, i) => (
                <tr key={c.dot_number}>
                  <td>{i + 1}</td>
                  <td>
                    <Link to={`/carrier/${c.dot_number}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                      {c.legal_name}
                    </Link>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>DOT# {c.dot_number}</div>
                  </td>
                  <td>
                    <span style={{ color: "#e11d48", fontWeight: 600 }}>{c.physical_country}</span>
                  </td>
                  <td>
                    <span className={`risk-badge-sm ${riskClass(c.risk_score)}`}>{c.risk_score}</span>
                  </td>
                  <td>{c.power_units}</td>
                  <td style={{ color: c.total_crashes > 0 ? "var(--danger)" : "inherit" }}>
                    {c.total_crashes}
                  </td>
                  <td style={{ fontSize: 11, color: c.operating_status === "AUTHORIZED" ? "var(--success)" : "var(--text-muted)" }}>
                    {c.operating_status || "Unknown"}
                  </td>
                </tr>
              ))}
              {carriers.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>No carriers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* US Carriers Linked to Foreign Operators — overview only */}
      {!country && <div className="detail-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2>US Carriers Linked to Foreign Operators</h2>
          <select
            className="filter-select"
            value={linkType}
            onChange={(e) => setLinkType(e.target.value)}
            style={{ width: "auto", minWidth: 160 }}
          >
            <option value="officer">Linked via Officer ({stats?.linked_officer.toLocaleString()})</option>
            <option value="address">Linked via Address ({stats?.linked_address.toLocaleString()})</option>
            <option value="mailing">Foreign Mailing ({stats?.foreign_mailing.toLocaleString()})</option>
          </select>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {linkType === "officer" && "US-registered carriers whose officers also appear on foreign carrier registrations. Potential fraud ring indicator."}
          {linkType === "address" && "US-registered carriers sharing a physical address with a foreign carrier."}
          {linkType === "mailing" && "Carriers with a US physical address but a foreign mailing address."}
        </p>
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Carrier</th>
                <th>State</th>
                <th>Risk</th>
                <th>Fleet</th>
                <th>Crashes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {linked.map((c, i) => (
                <tr key={c.dot_number}>
                  <td>{i + 1}</td>
                  <td>
                    <Link to={`/carrier/${c.dot_number}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                      {c.legal_name}
                    </Link>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>DOT# {c.dot_number}</div>
                  </td>
                  <td>{c.physical_state || "—"}</td>
                  <td>
                    <span className={`risk-badge-sm ${riskClass(c.risk_score)}`}>{c.risk_score}</span>
                  </td>
                  <td>{c.power_units}</td>
                  <td style={{ color: c.total_crashes > 0 ? "var(--danger)" : "inherit" }}>
                    {c.total_crashes}
                  </td>
                  <td style={{ fontSize: 11, color: c.operating_status === "AUTHORIZED" ? "var(--success)" : "var(--text-muted)" }}>
                    {c.operating_status || "Unknown"}
                  </td>
                </tr>
              ))}
              {linked.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>No linked carriers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}
