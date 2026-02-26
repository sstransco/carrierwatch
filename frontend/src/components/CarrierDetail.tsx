import { Fragment, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { CarrierDetail as CarrierDetailType, Principal, BatchCarrier } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";

function statusClass(status: string | null): string {
  if (!status) return "";
  if (status === "AUTHORIZED") return "status-authorized";
  if (status.includes("OUT") || status.includes("REVOKED")) return "status-revoked";
  return "status-inactive";
}

function riskLevel(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: "CRITICAL", cls: "risk-critical" };
  if (score >= 50) return { label: "HIGH", cls: "risk-high" };
  if (score >= 30) return { label: "MEDIUM", cls: "risk-medium" };
  if (score >= 10) return { label: "LOW", cls: "risk-low" };
  return { label: "NONE", cls: "risk-none" };
}

function formatFlag(flag: string): string {
  return flag
    .replace(/_/g, " ")
    .replace(/ADDRESS OVERLAP (\d+)/, "Address shared by $1 carriers")
    .replace("FATAL CRASHES", "Fatal crash history")
    .replace("HIGH CRASH COUNT", "3+ crashes on record")
    .replace("HIGH VEHICLE OOS", "Vehicle OOS rate > 30%")
    .replace("HIGH DRIVER OOS", "Driver OOS rate > 20%")
    .replace("NEW AUTHORITY", "Authority < 1 year old")
    .replace("INACTIVE STATUS", "Inactive at cluster address")
    .replace("LARGE PPP LOAN", "PPP loan > $100K")
    .replace("PPP LOAN", "Received PPP loan")
    .replace("PPP FORGIVEN CLUSTER", "PPP forgiven at carrier cluster")
    .replace("PO BOX ADDRESS", "PO Box used as physical address")
    .replace("NO PHYSICAL ADDRESS", "No physical address on file")
    .replace("INSURANCE LAPSE", "Insurance coverage lapsed")
    .replace("AUTHORITY REVOKED REISSUED", "Authority revoked then reissued")
    .replace("OFFICER 25 PLUS", "Officer linked to 25+ carriers")
    .replace("OFFICER 10 PLUS", "Officer linked to 10+ carriers")
    .replace("OFFICER 5 PLUS", "Officer linked to 5+ carriers")
    .replace("ELD VIOLATIONS 5 PLUS", "5+ ELD/HOS violations")
    .replace("HIGH ELD VIOLATION RATE", "High ELD violation rate per inspection")
    .replace("FOREIGN LINKED ADDRESS", "Shares address with foreign carrier")
    .replace("FOREIGN LINKED OFFICER", "Shares officer with foreign carrier")
    .replace("FOREIGN MAILING", "Domestic carrier with foreign mailing address")
    .replace("FOREIGN CARRIER", "Foreign-registered carrier")
    .replace("CHAMELEON SUCCESSOR", "Chameleon: reopened under new DOT")
    .replace("CHAMELEON PREDECESSOR", "Chameleon: predecessor carrier")
    .replace("FRAUD RING", "Part of fraud ring network")
    .replace(/ADDRESS OVERLAP (\d+)\+/, "Address shared by $1+ carriers");
}

const WEATHER: Record<number, string> = {
  1: "Clear", 2: "Rain", 3: "Sleet/Hail", 4: "Snow",
  5: "Fog/Smoke", 6: "Crosswinds", 7: "Blowing Sand", 8: "Other", 9: "Unknown",
};
const LIGHTING: Record<number, string> = {
  1: "Daylight", 2: "Dark (Unlit)", 3: "Dark (Lit)", 4: "Dawn",
  5: "Dusk", 6: "Unknown", 8: "Other", 9: "Unknown",
};
const ROAD_SURFACE: Record<number, string> = {
  1: "Dry", 2: "Wet", 3: "Snow/Slush", 4: "Ice",
  5: "Sand/Dirt/Oil", 6: "Standing Water", 7: "Muddy", 8: "Other", 9: "Unknown",
};

interface CrashRecord {
  crash_id: number;
  date: string;
  city: string;
  state: string;
  location: string | null;
  fatalities: number;
  injuries: number;
  tow_away: number;
  hazmat_released: boolean;
  federal_recordable: boolean;
  weather: number | null;
  lighting: number | null;
  road_surface: number | null;
}

function CrashesTable({ items }: { items: CrashRecord[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="history-scroll"><table className="history-table">
      <thead><tr><th>Date</th><th>Location</th><th>Fatal</th><th>Injuries</th><th>Tow</th><th>HazMat</th><th></th></tr></thead>
      <tbody>
        {items.map((r, i) => {
          const isExpanded = expandedId === i;
          return (
            <Fragment key={i}>
              <tr
                onClick={() => setExpandedId(isExpanded ? null : i)}
                style={{
                  cursor: "pointer",
                  ...(r.fatalities > 0 ? { background: "rgba(239,68,68,0.12)" } : {}),
                }}
              >
                <td>{r.date || "\u2014"}</td>
                <td>{r.city}{r.state ? `, ${r.state}` : ""}</td>
                <td style={r.fatalities > 0 ? { color: "var(--danger)", fontWeight: 700 } : undefined}>{r.fatalities}</td>
                <td style={r.injuries > 0 ? { color: "var(--warning)" } : undefined}>{r.injuries}</td>
                <td>{r.tow_away}</td>
                <td>{r.hazmat_released ? "YES" : "\u2014"}</td>
                <td style={{ color: "var(--text-secondary)", fontSize: 11 }}>{isExpanded ? "\u25B2" : "\u25BC"}</td>
              </tr>
              {isExpanded && (
                <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                  <td colSpan={7} style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
                      {r.weather != null && (
                        <div><span style={{ color: "var(--text-secondary)" }}>Weather: </span><span style={{ fontWeight: 500 }}>{WEATHER[r.weather] || `Code ${r.weather}`}</span></div>
                      )}
                      {r.lighting != null && (
                        <div><span style={{ color: "var(--text-secondary)" }}>Lighting: </span><span style={{ fontWeight: 500 }}>{LIGHTING[r.lighting] || `Code ${r.lighting}`}</span></div>
                      )}
                      {r.road_surface != null && (
                        <div><span style={{ color: "var(--text-secondary)" }}>Road: </span><span style={{ fontWeight: 500 }}>{ROAD_SURFACE[r.road_surface] || `Code ${r.road_surface}`}</span></div>
                      )}
                      {r.location && (
                        <div><span style={{ color: "var(--text-secondary)" }}>Location: </span><span style={{ fontWeight: 500 }}>{r.location}</span></div>
                      )}
                      {r.federal_recordable && (
                        <div><span style={{ color: "var(--danger)", fontWeight: 600 }}>Federal Recordable</span></div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table></div>
  );
}

type HistoryTab = "inspections" | "violations" | "crashes" | "authority" | "insurance";

function HistoryTabs({ dotNumber, tab, onTabChange }: { dotNumber: number; tab: HistoryTab; onTabChange: (t: HistoryTab) => void }) {
  const setTab = onTabChange;
  const [data, setData] = useState<Record<HistoryTab, unknown[] | null>>({
    inspections: null, violations: null, crashes: null, authority: null, insurance: null,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (data[tab] !== null) return;
    setLoading(true);
    fetch(`${API_URL}/api/carriers/${dotNumber}/${tab}`)
      .then((r) => r.json())
      .then((items) => {
        setData((prev) => ({ ...prev, [tab]: items }));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tab, dotNumber, data]);

  const items = data[tab] || [];

  return (
    <div className="history-section">
      <div className="history-tabs">
        {(["inspections", "violations", "crashes", "authority", "insurance"] as HistoryTab[]).map((t) => (
          <button
            key={t}
            className={`history-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "inspections" ? "Inspections" : t === "violations" ? "Violations" : t === "crashes" ? "Crashes" : t === "authority" ? "Authority" : "Insurance"}
          </button>
        ))}
      </div>
      <div className="history-tab-content">
        {loading ? (
          <div className="loading">Loading {tab}...</div>
        ) : items.length === 0 ? (
          <div className="history-empty">No {tab} records found</div>
        ) : tab === "inspections" ? (
          <div className="history-scroll"><table className="history-table">
            <thead><tr><th>Date</th><th>State</th><th>Level</th><th>Result</th><th>Violations</th><th>OOS</th></tr></thead>
            <tbody>
              {(items as { date: string; report_state: string; level: number; violations: number; oos_total: number; driver_violations: number; vehicle_violations: number; post_crash: boolean }[]).map((r, i) => (
                <tr key={i} style={r.post_crash ? { background: "rgba(239,68,68,0.08)" } : undefined}>
                  <td>{r.date || "\u2014"}</td>
                  <td>{r.report_state}</td>
                  <td>Level {r.level}</td>
                  <td>
                    {r.oos_total > 0 ? (
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "rgba(239,68,68,0.2)", color: "#ef4444" }}>OOS</span>
                    ) : r.violations > 0 ? (
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>{r.violations} Violation{r.violations > 1 ? "s" : ""}</span>
                    ) : (
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 8, fontSize: 11, fontWeight: 600, background: "rgba(34,197,94,0.2)", color: "#22c55e" }}>Clean</span>
                    )}
                  </td>
                  <td style={r.violations > 0 ? { color: "var(--warning)" } : { color: "var(--text-muted)" }}>{r.violations}</td>
                  <td style={r.oos_total > 0 ? { color: "var(--danger)", fontWeight: 700 } : { color: "var(--text-muted)" }}>{r.oos_total}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : tab === "violations" ? (
          <div className="history-scroll"><table className="history-table">
            <thead><tr><th>Date</th><th>State</th><th>Code</th><th>Description</th><th>Category</th><th>OOS</th></tr></thead>
            <tbody>
              {(items as { date: string; state: string; violation_code: string; description: string; category: string | null; oos: boolean; unit_type: string | null }[]).map((r, i) => (
                <tr key={i} style={r.oos ? { background: "rgba(239,68,68,0.08)" } : undefined}>
                  <td>{r.date || "\u2014"}</td>
                  <td>{r.state || "\u2014"}</td>
                  <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{r.violation_code}</td>
                  <td style={{ fontSize: 12, maxWidth: 300 }}>{r.description || "\u2014"}</td>
                  <td><span style={{
                    display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 11,
                    background: r.category === "ELD_HOS" ? "rgba(239,68,68,0.15)" : r.category === "VEHICLE" ? "rgba(245,158,11,0.15)" : "rgba(100,116,139,0.15)",
                    color: r.category === "ELD_HOS" ? "var(--danger)" : r.category === "VEHICLE" ? "var(--warning)" : "var(--text-secondary)",
                  }}>{r.category || "OTHER"}</span></td>
                  <td style={r.oos ? { color: "var(--danger)", fontWeight: 700 } : undefined}>{r.oos ? "YES" : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : tab === "crashes" ? (
          <CrashesTable items={items as CrashRecord[]} />
        ) : tab === "authority" ? (
          <div className="history-scroll">
            {(items as { docket_number: string; legal_name: string; common_authority: string; contract_authority: string; broker_authority: string; common_rev_pending: boolean; contract_rev_pending: boolean; broker_rev_pending: boolean; property: boolean; passenger: boolean; household_goods: boolean; address: string; city: string; state: string; zip: string }[]).map((r, i) => (
              <div key={i} className="detail-card" style={{ marginBottom: 12 }}>
                <h3>Docket: {r.docket_number || "\u2014"}</h3>
                <div className="detail-row"><span className="label">Name</span><span className="value">{r.legal_name}</span></div>
                <div className="detail-row"><span className="label">Common Auth</span><span className="value" style={r.common_rev_pending ? { color: "var(--danger)" } : undefined}>{r.common_authority || "\u2014"}{r.common_rev_pending ? " (REV PENDING)" : ""}</span></div>
                <div className="detail-row"><span className="label">Contract Auth</span><span className="value" style={r.contract_rev_pending ? { color: "var(--danger)" } : undefined}>{r.contract_authority || "\u2014"}{r.contract_rev_pending ? " (REV PENDING)" : ""}</span></div>
                <div className="detail-row"><span className="label">Broker Auth</span><span className="value" style={r.broker_rev_pending ? { color: "var(--danger)" } : undefined}>{r.broker_authority || "\u2014"}{r.broker_rev_pending ? " (REV PENDING)" : ""}</span></div>
                <div className="detail-row"><span className="label">Types</span><span className="value">{[r.property && "Property", r.passenger && "Passenger", r.household_goods && "HHG"].filter(Boolean).join(", ") || "\u2014"}</span></div>
                <div className="detail-row"><span className="label">Address</span><span className="value">{r.address}, {r.city}, {r.state} {r.zip}</span></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="history-scroll"><table className="history-table">
            <thead><tr><th>Effective</th><th>Cancelled</th><th>Company</th><th>Coverage</th><th>Policy</th><th>Status</th></tr></thead>
            <tbody>
              {(items as { effective_date: string; cancellation_date: string | null; insurance_company: string; coverage_amount: number | null; policy_number: string; is_active: boolean; cancellation_method: string | null }[]).map((r, i) => (
                <tr key={i} style={!r.is_active ? { opacity: 0.6 } : undefined}>
                  <td>{r.effective_date || "\u2014"}</td>
                  <td style={r.cancellation_date ? { color: "var(--danger)" } : undefined}>{r.cancellation_date || "\u2014"}</td>
                  <td>{r.insurance_company || "\u2014"}</td>
                  <td>{r.coverage_amount ? `$${r.coverage_amount.toLocaleString()}` : "\u2014"}</td>
                  <td style={{ fontSize: 11 }}>{r.policy_number || "\u2014"}</td>
                  <td>{r.is_active ? <span style={{ color: "var(--success)" }}>Active</span> : <span style={{ color: "var(--danger)" }}>Cancelled</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function OtherCarriersExpander({ principal }: { principal: Principal }) {
  const [expanded, setExpanded] = useState(false);
  const [carriers, setCarriers] = useState<BatchCarrier[]>([]);
  const [loading, setLoading] = useState(false);

  const handleToggle = () => {
    if (!expanded && carriers.length === 0 && principal.other_dot_numbers.length > 0) {
      setLoading(true);
      fetch(`${API_URL}/api/carriers/batch?dots=${principal.other_dot_numbers.join(",")}`)
        .then((r) => r.json())
        .then((data) => { setCarriers(data); setLoading(false); })
        .catch(() => setLoading(false));
    }
    setExpanded(!expanded);
  };

  if (principal.other_carrier_count === 0) return <span>{"\u2014"}</span>;

  return (
    <div>
      <button
        onClick={handleToggle}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: "2px 6px",
          borderRadius: 4, fontSize: 12, fontWeight: 700,
          color: principal.other_carrier_count >= 5 ? "var(--danger)" : "var(--warning)",
          textDecoration: "underline",
        }}
      >
        {principal.other_carrier_count} other {expanded ? "\u25B2" : "\u25BC"}
      </button>
      {expanded && (
        <div style={{ marginTop: 6, maxHeight: 200, overflowY: "auto" }}>
          {loading ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading...</div>
          ) : carriers.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No carrier data found</div>
          ) : (
            carriers.map((c) => (
              <Link
                key={c.dot_number}
                to={`/carrier/${c.dot_number}`}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "4px 8px", borderRadius: 4, fontSize: 11,
                  background: "rgba(255,255,255,0.03)", marginBottom: 2,
                  textDecoration: "none", color: "var(--text-primary)",
                }}
              >
                <div>
                  <span style={{ fontWeight: 500 }}>{c.legal_name}</span>
                  <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>DOT# {c.dot_number}</span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {c.risk_score > 0 && (
                    <span className={`risk-badge-sm ${c.risk_score >= 70 ? "risk-critical" : c.risk_score >= 50 ? "risk-high" : c.risk_score >= 30 ? "risk-medium" : "risk-low"}`}
                      style={{ fontSize: 10, padding: "1px 5px" }}>
                      {c.risk_score}
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{c.physical_state}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PrincipalsSection({ dotNumber }: { dotNumber: number }) {
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/principals/carrier/${dotNumber}`)
      .then((r) => r.json())
      .then((data) => {
        setPrincipals(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dotNumber]);

  if (loading) return null;
  if (principals.length === 0) return null;

  return (
    <div className="detail-card" style={{ gridColumn: "1 / -1" }}>
      <h3>Company Officers / Principals</h3>
      <div className="history-scroll">
        <table className="history-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Position</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Other Carriers</th>
            </tr>
          </thead>
          <tbody>
            {principals.map((p, i) => (
              <tr key={i} style={p.other_carrier_count >= 5 ? { background: "rgba(239,68,68,0.08)" } : undefined}>
                <td style={{ fontWeight: 500 }}>
                  {p.other_carrier_count >= 2 ? (
                    <Link to={`/network/${encodeURIComponent(p.officer_name)}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                      {p.officer_name}
                      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--accent)", verticalAlign: "middle" }} title="View network graph">&#x1f578;</span>
                    </Link>
                  ) : p.officer_name}
                </td>
                <td>{p.position || "\u2014"}</td>
                <td style={{ fontSize: 12 }}>{p.phone || "\u2014"}</td>
                <td style={{ fontSize: 12 }}>{p.email || "\u2014"}</td>
                <td><OtherCarriersExpander principal={p} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {principals.some(p => p.other_carrier_count >= 5) && (
        <div className="colocated-warning" style={{ marginTop: 8 }}>
          Officer linked to 5+ carriers — possible chameleon carrier network
        </div>
      )}
    </div>
  );
}

export default function CarrierDetailPage() {
  const { dotNumber } = useParams<{ dotNumber: string }>();
  const [carrier, setCarrier] = useState<CarrierDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeHistoryTab, setActiveHistoryTab] = useState<HistoryTab>("inspections");

  useEffect(() => {
    if (!dotNumber) return;
    setLoading(true);
    fetch(`${API_URL}/api/carriers/${dotNumber}`)
      .then((r) => {
        if (!r.ok) throw new Error("Carrier not found");
        return r.json();
      })
      .then((data) => {
        setCarrier(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [dotNumber]);

  if (loading) return (
    <div className="detail-page">
      <Link to="/" className="detail-back">&larr; Back to map</Link>
      <div className="skeleton skeleton-header" />
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <div className="skeleton skeleton-badge" />
        <div className="skeleton skeleton-badge" style={{ width: 120 }} />
      </div>
      <div className="detail-grid">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="skeleton-card">
            <div className="skeleton skeleton-text" style={{ width: "40%", marginBottom: 16 }} />
            {[1, 2, 3, 4, 5].map((r) => (
              <div key={r} className="skeleton-row">
                <div className="skeleton skeleton-text" style={{ width: "35%", marginBottom: 0 }} />
                <div className="skeleton skeleton-text" style={{ width: "25%", marginBottom: 0, marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
  if (error || !carrier) {
    return (
      <div className="detail-page">
        <Link to="/" className="detail-back">&larr; Back to map</Link>
        <div className="error-state">
          <div className="error-title">Failed to load carrier</div>
          <p>{error || "Carrier not found"}</p>
          <button className="retry-btn" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  const risk = riskLevel(carrier.risk_score);

  const scrollToCrashes = () => {
    setActiveHistoryTab("crashes");
    document.getElementById("history-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="detail-page">
      <Link to="/" className="detail-back">&larr; Back to map</Link>

      <div className="detail-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1>{carrier.legal_name}</h1>
          {carrier.risk_score > 0 && (
            <span className={`risk-badge ${risk.cls}`}>
              RISK: {risk.label} ({carrier.risk_score})
            </span>
          )}
        </div>
        {carrier.dba_name && <div style={{ color: "var(--text-secondary)", marginBottom: 4 }}>DBA: {carrier.dba_name}</div>}
        <div className="dot-badge">
          DOT# {carrier.dot_number}
          {carrier.mc_number && ` · MC# ${carrier.mc_number}`}
          {" · "}
          <span className={`status-badge ${statusClass(carrier.operating_status)}`}>
            {carrier.operating_status || "Unknown"}
          </span>
        </div>
      </div>

      {/* Risk flags banner */}
      {carrier.risk_flags.length > 0 && (
        <div className="risk-flags-banner">
          <div className="risk-flags-title">Risk Flags</div>
          <div className="risk-flags-list">
            {carrier.risk_flags.map((flag, i) => (
              <span key={i} className="risk-flag-tag">{formatFlag(flag)}</span>
            ))}
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-card">
          <h3>Company Info</h3>
          <div className="detail-row"><span className="label">Physical Address</span><span className="value">{carrier.physical_address}<br />{carrier.physical_city}, {carrier.physical_state} {carrier.physical_zip}</span></div>
          {carrier.latitude && carrier.longitude && MAPBOX_TOKEN && (
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${carrier.latitude},${carrier.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}
              >
                <img
                  src={`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${carrier.longitude},${carrier.latitude},17,0/400x180@2x?access_token=${MAPBOX_TOKEN}`}
                  alt="Satellite view"
                  style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
                  loading="lazy"
                />
              </a>
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${carrier.latitude},${carrier.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: "var(--accent)", marginTop: 4, display: "inline-block" }}
              >
                Open Google Street View &rarr;
              </a>
            </div>
          )}
          {carrier.phone && <div className="detail-row"><span className="label">Phone</span><span className="value">{carrier.phone}</span></div>}
          <div className="detail-row"><span className="label">Operation</span><span className="value">{carrier.carrier_operation || "\u2014"}</span></div>
          <div className="detail-row"><span className="label">Authority Granted</span><span className="value">{carrier.authority_grant_date || "\u2014"}</span></div>
          <div className="detail-row"><span className="label">Authority Status</span><span className="value">{carrier.authority_status || "\u2014"}</span></div>
        </div>

        <div className="detail-card">
          <h3>Fleet & Safety</h3>
          <div className="detail-row"><span className="label">Power Units</span><span className="value">{carrier.power_units}</span></div>
          <div className="detail-row"><span className="label">Drivers</span><span className="value">{carrier.drivers}</span></div>
          <div className="detail-row"><span className="label">Safety Rating</span><span className="value">{carrier.safety_rating || "None"}</span></div>
          <div className="detail-row"><span className="label">HazMat</span><span className="value">{carrier.hm_flag === "Y" ? "Yes" : "No"}</span></div>
          <div className="detail-row"><span className="label">Passenger Carrier</span><span className="value">{carrier.pc_flag === "Y" ? "Yes" : "No"}</span></div>
        </div>

        <div className="detail-card">
          <h3>Inspections & Crashes</h3>
          {/* Stat boxes */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
            <div style={{ background: "var(--bg-tertiary)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{carrier.total_inspections.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Inspections</div>
            </div>
            <div style={{ background: "var(--bg-tertiary)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: carrier.eld_violations > 0 ? "var(--warning)" : "var(--text-primary)" }}>{carrier.eld_violations + carrier.hos_violations}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>ELD/HOS Viol</div>
            </div>
            <div style={{ background: "var(--bg-tertiary)", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: carrier.vehicle_oos_rate > 30 || carrier.driver_oos_rate > 20 ? "var(--danger)" : "var(--text-primary)" }}>{carrier.vehicle_oos_rate.toFixed(0)}%</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Veh OOS Rate</div>
            </div>
            <div style={{ background: carrier.total_crashes > 0 ? "rgba(239,68,68,0.12)" : "var(--bg-tertiary)", borderRadius: 8, padding: "10px 8px", textAlign: "center", cursor: carrier.total_crashes > 0 ? "pointer" : "default" }} onClick={carrier.total_crashes > 0 ? scrollToCrashes : undefined}>
              <div style={{ fontSize: 22, fontWeight: 800, color: carrier.total_crashes > 0 ? "var(--danger)" : "var(--text-primary)" }}>{carrier.total_crashes}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Crashes</div>
            </div>
          </div>
          <div className="detail-row"><span className="label">Fatal Crashes</span><span className="value">{carrier.fatal_crashes > 0 ? <button onClick={scrollToCrashes} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 700, textDecoration: "underline" }}>{carrier.fatal_crashes}</button> : "0"}</span></div>
          <div className="detail-row"><span className="label">Injury Crashes</span><span className="value" style={carrier.injury_crashes > 0 ? { color: "var(--warning)" } : undefined}>{carrier.injury_crashes}</span></div>
          <div className="detail-row"><span className="label">Driver OOS Rate</span><span className="value" style={carrier.driver_oos_rate > 20 ? { color: "var(--danger)" } : undefined}>{carrier.driver_oos_rate.toFixed(1)}%</span></div>
          <div className="detail-row"><span className="label">HazMat OOS Rate</span><span className="value">{carrier.hazmat_oos_rate.toFixed(1)}%</span></div>
          {carrier.fleet_size_bucket && carrier.peer_crash_percentile != null && (
            <>
              <div style={{ borderTop: "1px solid var(--border)", margin: "10px 0 6px", paddingTop: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Peer Benchmarks ({carrier.fleet_size_bucket} units)</span>
              </div>
              <div className="detail-row">
                <span className="label">Crash Percentile</span>
                <span className="value" style={carrier.peer_crash_percentile >= 90 ? { color: "var(--danger)", fontWeight: 700 } : undefined}>
                  {carrier.peer_crash_percentile.toFixed(0)}th
                </span>
              </div>
              {carrier.peer_oos_percentile != null && (
                <div className="detail-row">
                  <span className="label">OOS Percentile</span>
                  <span className="value" style={carrier.peer_oos_percentile >= 90 ? { color: "var(--danger)", fontWeight: 700 } : undefined}>
                    {carrier.peer_oos_percentile.toFixed(0)}th
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="detail-card">
          <h3>Insurance</h3>
          <div className="detail-row"><span className="label">BIPD On File</span><span className="value">${(carrier.insurance_bipd_on_file || 0).toLocaleString()}</span></div>
          <div className="detail-row"><span className="label">BIPD Required</span><span className="value">${(carrier.insurance_bipd_required || 0).toLocaleString()}</span></div>
          <div className="detail-row"><span className="label">Common Authority</span><span className="value">{carrier.common_authority || "\u2014"}</span></div>
          <div className="detail-row"><span className="label">Contract Authority</span><span className="value">{carrier.contract_authority || "\u2014"}</span></div>
          <div className="detail-row"><span className="label">Broker Authority</span><span className="value">{carrier.broker_authority || "\u2014"}</span></div>
        </div>
      </div>

      {/* Company Officers */}
      <PrincipalsSection dotNumber={carrier.dot_number} />

      {/* History Tabs */}
      <div id="history-section">
        <HistoryTabs dotNumber={carrier.dot_number} tab={activeHistoryTab} onTabChange={setActiveHistoryTab} />
      </div>

      {/* PPP Loans Section */}
      {carrier.ppp_loan_count > 0 && (
        <div className="ppp-section">
          <h2>PPP Loan Data</h2>
          <div className="ppp-summary">
            <div className="ppp-stat">
              <span className="ppp-stat-value">{carrier.ppp_loan_count}</span>
              <span className="ppp-stat-label">Loans</span>
            </div>
            <div className="ppp-stat">
              <span className="ppp-stat-value">${carrier.ppp_loan_total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="ppp-stat-label">Total Borrowed</span>
            </div>
            <div className="ppp-stat">
              <span className="ppp-stat-value">${carrier.ppp_forgiven_total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="ppp-stat-label">Total Forgiven</span>
            </div>
          </div>
          {carrier.ppp_loans.length > 0 && (
            <table className="ppp-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Forgiven</th>
                  <th>Status</th>
                  <th>Jobs</th>
                  <th>Lender</th>
                  <th>Approved</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {carrier.ppp_loans.map((loan, i) => (
                  <tr key={i}>
                    <td>${loan.loan_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td>${loan.forgiveness_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td>{loan.loan_status || "\u2014"}</td>
                    <td>{loan.jobs_reported}</td>
                    <td>{loan.lender || "\u2014"}</td>
                    <td>{loan.date_approved || "\u2014"}</td>
                    <td><span className="match-badge">{loan.match_confidence || "\u2014"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {carrier.chameleon_pairs && carrier.chameleon_pairs.length > 0 && (
        <div className="colocated-section">
          <h2>Chameleon Carrier Links ({carrier.chameleon_pairs.length})</h2>
          <div className="colocated-warning">
            This carrier has been linked to potential chameleon carrier activity &mdash;
            carriers that shut down and reopen under new DOT numbers to evade safety records.
          </div>
          {carrier.chameleon_pairs.map((cp) => {
            const isPredecessor = cp.predecessor_dot === carrier.dot_number;
            const linkedDot = isPredecessor ? cp.successor_dot : cp.predecessor_dot;
            const linkedName = isPredecessor ? cp.successor_name : cp.predecessor_name;
            return (
              <Link key={cp.id} to={`/carrier/${linkedDot}`} className="carrier-list-item">
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {isPredecessor ? "Successor" : "Predecessor"}: {linkedName || `DOT ${linkedDot}`}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    DOT# {linkedDot} · {cp.days_gap != null ? `${cp.days_gap}d gap` : "unknown gap"} · {cp.match_signals.join(", ")}
                  </div>
                </div>
                <span className={`risk-badge-sm ${cp.confidence === "high" ? "risk-critical" : cp.confidence === "medium" ? "risk-high" : "risk-medium"}`}>
                  {cp.confidence.toUpperCase()}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {carrier.fraud_rings && carrier.fraud_rings.length > 0 && (
        <div className="colocated-section">
          <h2>Fraud Ring Membership ({carrier.fraud_rings.length})</h2>
          <div className="colocated-warning">
            This carrier belongs to a network of carriers connected by shared officers,
            which may indicate coordinated fraud or evasion of safety regulations.
          </div>
          {carrier.fraud_rings.map((ring) => (
            <div key={ring.ring_id} className="carrier-list-item" style={{ flexDirection: "column", alignItems: "stretch", cursor: "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 500 }}>Ring #{ring.ring_id} &mdash; {ring.carrier_count} carriers</div>
                <span className={`risk-badge-sm ${ring.confidence === "high" ? "risk-critical" : ring.confidence === "medium" ? "risk-high" : "risk-medium"}`}>
                  {ring.confidence.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                {ring.active_count} active · {ring.total_crashes} crashes · {ring.total_fatalities} fatalities · combined risk {ring.combined_risk}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                {ring.carrier_dots.filter((d) => d !== carrier.dot_number).slice(0, 8).map((d) => (
                  <Link key={d} to={`/carrier/${d}`} style={{ fontSize: 11, color: "#60a5fa" }}>
                    {d}
                  </Link>
                ))}
                {ring.carrier_dots.length > 9 && (
                  <span style={{ fontSize: 11, color: "#666" }}>+{ring.carrier_dots.length - 9} more</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {carrier.colocated_carriers.length > 0 && (
        <div className="colocated-section">
          <h2>
            Co-Located Carriers ({carrier.colocated_carriers.length} at same address)
          </h2>
          {carrier.colocated_carriers.length >= 5 && (
            <div className="colocated-warning">
              This address has {carrier.colocated_carriers.length + 1} registered carriers &mdash;
              possible chameleon carrier pattern. Multiple companies at the same address may
              indicate operators rebranding to evade safety records.
            </div>
          )}
          {carrier.colocated_carriers.map((c) => (
            <Link
              key={c.dot_number}
              to={`/carrier/${c.dot_number}`}
              className="carrier-list-item"
            >
              <div>
                <div style={{ fontWeight: 500 }}>{c.legal_name}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  DOT# {c.dot_number} · {c.power_units} units · {c.total_crashes} crashes
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {c.risk_score > 0 && (
                  <span className={`risk-badge-sm ${riskLevel(c.risk_score).cls}`}>
                    {c.risk_score}
                  </span>
                )}
                <span className={`status-badge ${statusClass(c.operating_status)}`}>
                  {c.operating_status || "?"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
