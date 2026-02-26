import { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_URL } from "../hooks/useApi";

interface OriginEntry {
  code: string;
  name: string;
  region: string;
  officer_count: number;
  carrier_count: number;
  avg_risk: number;
}

interface StateEntry {
  state: string;
  officer_count: number;
  carrier_count: number;
  avg_risk: number;
}

interface OfficerEntry {
  officer_name: string;
  carrier_count: number;
  total_risk: number;
  statuses: string[];
  dot_numbers: number[];
}

interface SearchResult {
  surname: string;
  code: string | null;
  name: string | null;
  region: string | null;
  confidence: number;
  found: boolean;
  closest_match?: string;
  suggestions?: { surname: string; code: string; name: string }[];
}

interface DemoStats {
  total_surnames: number;
  total_origins: number;
  total_regions: number;
  carriers_classified: number;
}

const REGION_ORDER = [
  "East Asian", "South Asian", "Southeast Asian",
  "Latino", "Anglo", "European", "Slavic", "Scandinavian",
  "Middle Eastern", "African",
];

const REGION_COLORS: Record<string, string> = {
  "East Asian": "#f9ca24",
  "South Asian": "#e056fd",
  "Southeast Asian": "#6ab04c",
  "Latino": "#f0932b",
  "Anglo": "#7ed6df",
  "European": "#686de0",
  "Slavic": "#22a6b3",
  "Scandinavian": "#30336b",
  "Middle Eastern": "#eb4d4b",
  "African": "#badc58",
};

const ORIGIN_COLORS: Record<string, string> = {
  JP: "#ff6b6b", KR: "#ee5a24", CN: "#f9ca24", VN: "#6ab04c", PH: "#20bf6b",
  IN: "#e056fd", GR: "#686de0", GE: "#4834d4", IT: "#be2edd", NL: "#22a6b3",
  DE: "#7ed6df", HU: "#535c68", PL: "#6ab04c", RU: "#22a6b3", UA: "#c7ecee",
  FI: "#30336b", AM: "#eb4d4b", TR: "#f0932b", AR: "#ff7979", PT: "#f6e58d",
  ES: "#f0932b", IE: "#badc58", GB: "#7ed6df", NG: "#f9ca24", ET: "#ffbe76",
};

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",
  KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",
  MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",
  NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",
  NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
  DC:"District of Columbia",
};

function groupByRegion(origins: OriginEntry[]) {
  const groups: Record<string, OriginEntry[]> = {};
  for (const o of origins) {
    if (!groups[o.region]) groups[o.region] = [];
    groups[o.region].push(o);
  }
  for (const region of Object.keys(groups)) {
    groups[region].sort((a, b) => b.officer_count - a.officer_count);
  }
  return groups;
}

function DotList({ dots }: { dots: number[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? dots : dots.slice(0, 5);
  const remaining = dots.length - 5;
  return (
    <>
      {shown.map((d, j) => (
        <span key={d}>
          {j > 0 && ", "}
          <Link to={`/carrier/${d}`} style={{ color: "var(--accent)" }}>{d}</Link>
        </span>
      ))}
      {remaining > 0 && !expanded && (
        <span onClick={() => setExpanded(true)} style={{ color: "var(--accent)", cursor: "pointer", marginLeft: 4 }}>
          +{remaining} more
        </span>
      )}
    </>
  );
}

/* ── Pie Chart (pure SVG) ── */
function PieChart({ data, size = 240 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  let cumAngle = -Math.PI / 2;

  const slices = data.filter(d => d.value > 0).map((d) => {
    const pct = d.value / total;
    const angle = pct * 2 * Math.PI;
    const startX = cx + r * Math.cos(cumAngle);
    const startY = cy + r * Math.sin(cumAngle);
    cumAngle += angle;
    const endX = cx + r * Math.cos(cumAngle);
    const endY = cy + r * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const midAngle = cumAngle - angle / 2;
    const labelR = r * 0.65;
    const labelX = cx + labelR * Math.cos(midAngle);
    const labelY = cy + labelR * Math.sin(midAngle);

    const path = pct >= 0.999
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`
      : `M ${cx} ${cy} L ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY} Z`;

    return { ...d, pct, path, labelX, labelY };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((s, i) => (
        <g key={i}>
          <path d={s.path} fill={s.color} stroke="var(--bg-primary)" strokeWidth="1.5">
            <title>{s.label}: {s.value.toLocaleString()} ({(s.pct * 100).toFixed(1)}%)</title>
          </path>
          {s.pct >= 0.04 && (
            <text x={s.labelX} y={s.labelY} textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontSize={s.pct >= 0.08 ? 11 : 9} fontWeight={600} style={{ pointerEvents: "none" }}>
              {(s.pct * 100).toFixed(0)}%
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function PieLegend({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {data.filter(d => d.value > 0).slice(0, 15).map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
          <span style={{ color: "var(--text-primary)" }}>{d.label}</span>
          <span style={{ color: "var(--text-secondary)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
            {d.value.toLocaleString()} ({(d.value / total * 100).toFixed(1)}%)
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Main Component ── */
export default function Demographics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [origins, setOrigins] = useState<OriginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DemoStats | null>(null);
  const [states, setStates] = useState<StateEntry[]>([]);
  const [statesLoading, setStatesLoading] = useState(false);
  const [stateDetail, setStateDetail] = useState<OriginEntry[]>([]);
  const [stateDetailLoading, setStateDetailLoading] = useState(false);
  const [officers, setOfficers] = useState<OfficerEntry[]>([]);
  const [officersLoading, setOfficersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const tab = searchParams.get("tab") || "overview";
  const selectedOrigin = searchParams.get("origin") || "";
  const selectedState = searchParams.get("state") || "";

  const setTab = useCallback((t: string) => {
    const p = new URLSearchParams(searchParams);
    p.set("tab", t);
    setSearchParams(p);
  }, [searchParams, setSearchParams]);

  // Load overview data
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/demographics/overview`).then(r => r.json()),
      fetch(`${API_URL}/api/demographics/stats`).then(r => r.json()).catch(() => null),
    ]).then(([originsData, statsData]) => {
      setOrigins(originsData);
      setStats(statsData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Load state data when By State tab is active
  useEffect(() => {
    if (tab !== "states") return;
    setStatesLoading(true);
    const params = selectedOrigin ? `?origin=${selectedOrigin}` : "";
    fetch(`${API_URL}/api/demographics/by-state${params}`)
      .then(r => r.json())
      .then(data => { setStates(data); setStatesLoading(false); })
      .catch(() => setStatesLoading(false));
  }, [tab, selectedOrigin]);

  // Load state detail (pie chart data) when a state is selected
  useEffect(() => {
    if (!selectedState || tab !== "states") { setStateDetail([]); return; }
    setStateDetailLoading(true);
    fetch(`${API_URL}/api/demographics/by-state/${selectedState}`)
      .then(r => r.json())
      .then(data => { setStateDetail(data); setStateDetailLoading(false); })
      .catch(() => setStateDetailLoading(false));
  }, [selectedState, tab]);

  // Load officers when origin is selected in explore tab
  useEffect(() => {
    if (tab !== "explore" || !selectedOrigin) { setOfficers([]); return; }
    setOfficersLoading(true);
    const stParam = selectedState ? `&state=${selectedState}` : "";
    fetch(`${API_URL}/api/demographics/top-officers?origin=${selectedOrigin}&limit=100${stParam}`)
      .then(r => r.json())
      .then(data => { setOfficers(data); setOfficersLoading(false); })
      .catch(() => setOfficersLoading(false));
  }, [tab, selectedOrigin, selectedState]);

  const doSearch = () => {
    if (searchQuery.trim().length < 2) return;
    setSearchLoading(true);
    setSearchResult(null);
    fetch(`${API_URL}/api/demographics/search?q=${encodeURIComponent(searchQuery.trim())}`)
      .then(r => r.json())
      .then(data => { setSearchResult(data); setSearchLoading(false); })
      .catch(() => setSearchLoading(false));
  };

  const totalOfficers = origins.reduce((s, o) => s + o.officer_count, 0);
  const groups = groupByRegion(origins);

  // Pie chart data for overview
  const regionPieData = REGION_ORDER.filter(r => groups[r]?.length).map(region => ({
    label: region,
    value: groups[region].reduce((s, o) => s + o.officer_count, 0),
    color: REGION_COLORS[region] || "#555",
  }));

  const statePieData = stateDetail.map(o => ({
    label: o.name,
    value: o.officer_count,
    color: ORIGIN_COLORS[o.code] || REGION_COLORS[o.region] || "#555",
  }));

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "states", label: "By State" },
    { id: "explore", label: "Explore Origin" },
    { id: "search", label: "Lookup" },
    { id: "methodology", label: "Methodology" },
  ];

  return (
    <div className="detail-page">
      <Link to="/" className="detail-back">&larr; Back to map</Link>

      <div className="detail-header">
        <h1>Officer Demographics Explorer</h1>
        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", maxWidth: 700, lineHeight: 1.5 }}>
          Statistical analysis of FMCSA carrier officer surname origins across 25 national categories
          and 10 regional groups. Every officer is classified — zero unknowns.
        </p>
      </div>

      {/* Stats bar */}
      {!loading && stats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div className="stat-chip"><strong>{origins.length}</strong> origins</div>
          <div className="stat-chip"><strong>{totalOfficers.toLocaleString()}</strong> officers classified</div>
          <div className="stat-chip"><strong>{(stats.carriers_classified || 0).toLocaleString()}</strong> carriers mapped</div>
          <div className="stat-chip"><strong>{(stats.total_surnames || 0).toLocaleString()}</strong> surnames in model</div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 8, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 16px",
              background: tab === t.id ? "var(--accent)" : "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: tab === t.id ? "#fff" : "var(--text-primary)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="skeleton-rows">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton skeleton-text" style={{ flex: 1 }} />
              <div className="skeleton skeleton-badge" style={{ width: 60 }} />
            </div>
          ))}
        </div>
      ) : tab === "overview" ? (
        /* ═══════════════════════════════════════════════════
           TAB: Overview — Region breakdown with pie chart
           ═══════════════════════════════════════════════════ */
        <div>
          {/* Pie chart + legend */}
          <div className="detail-card" style={{ marginBottom: 20, display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
            <PieChart data={regionPieData} size={260} />
            <div>
              <h3 style={{ margin: "0 0 12px" }}>Officer Distribution by Region</h3>
              <PieLegend data={regionPieData} />
            </div>
          </div>

          {/* Region tables */}
          {REGION_ORDER.filter(r => groups[r]?.length).map(region => (
            <div key={region} className="detail-card" style={{ marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: REGION_COLORS[region], display: "inline-block" }} />
                {region}
                <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 400 }}>
                  {groups[region].reduce((s, o) => s + o.officer_count, 0).toLocaleString()} officers
                </span>
              </h3>
              <div className="history-scroll">
                <table className="history-table">
                  <thead>
                    <tr><th>Origin</th><th>Code</th><th>Officers</th><th>Carriers</th><th>Avg Risk</th><th></th></tr>
                  </thead>
                  <tbody>
                    {groups[region].map(o => (
                      <tr key={o.code}>
                        <td style={{ fontWeight: 500 }}>{o.name}</td>
                        <td style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}>{o.code}</td>
                        <td>{o.officer_count.toLocaleString()}</td>
                        <td>{o.carrier_count.toLocaleString()}</td>
                        <td style={o.avg_risk >= 50 ? { color: "var(--danger)" } : o.avg_risk >= 25 ? { color: "var(--warning)" } : undefined}>
                          {o.avg_risk}
                        </td>
                        <td>
                          <button
                            onClick={() => {
                              const p = new URLSearchParams(searchParams);
                              p.set("origin", o.code);
                              p.set("tab", "explore");
                              setSearchParams(p);
                            }}
                            style={{
                              padding: "2px 10px", background: "var(--bg-secondary)",
                              border: "1px solid var(--border)", borderRadius: 4,
                              color: "var(--accent)", cursor: "pointer", fontSize: 12,
                            }}
                          >
                            Explore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : tab === "states" ? (
        /* ═══════════════════════════════════════════════════
           TAB: By State — State-level demographics
           ═══════════════════════════════════════════════════ */
        <div>
          {/* Origin filter */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={selectedOrigin}
              onChange={e => {
                const p = new URLSearchParams(searchParams);
                if (e.target.value) p.set("origin", e.target.value); else p.delete("origin");
                p.delete("state");
                setSearchParams(p);
              }}
              style={{
                padding: "6px 12px", background: "var(--bg-secondary)",
                border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)", minWidth: 200,
              }}
            >
              <option value="">All Origins</option>
              {origins.map(o => (
                <option key={o.code} value={o.code}>{o.name} ({o.code})</option>
              ))}
            </select>
            {selectedOrigin && (
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                Showing state breakdown for: <strong style={{ color: "var(--text-primary)" }}>{origins.find(o => o.code === selectedOrigin)?.name || selectedOrigin}</strong>
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {/* State table */}
            <div style={{ flex: "1 1 400px" }}>
              {statesLoading ? (
                <div className="skeleton-rows">
                  {[...Array(10)].map((_, i) => (
                    <div key={i} className="skeleton-row">
                      <div className="skeleton skeleton-text" style={{ flex: 1 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="history-scroll" style={{ maxHeight: 600 }}>
                  <table className="history-table">
                    <thead>
                      <tr><th>#</th><th>State</th><th>Officers</th><th>Carriers</th><th>Avg Risk</th></tr>
                    </thead>
                    <tbody>
                      {states.filter(s => s.state && s.state.length === 2).map((s, i) => (
                        <tr
                          key={s.state}
                          onClick={() => {
                            const p = new URLSearchParams(searchParams);
                            p.set("state", s.state);
                            setSearchParams(p);
                          }}
                          style={{
                            cursor: "pointer",
                            background: selectedState === s.state ? "rgba(99,102,241,0.1)" : undefined,
                          }}
                        >
                          <td style={{ fontWeight: 700, color: "var(--text-secondary)" }}>{i + 1}</td>
                          <td style={{ fontWeight: 500 }}>
                            {STATE_NAMES[s.state] || s.state}
                            <span style={{ color: "var(--text-secondary)", fontSize: 11, marginLeft: 6 }}>{s.state}</span>
                          </td>
                          <td>{s.officer_count.toLocaleString()}</td>
                          <td>{s.carrier_count.toLocaleString()}</td>
                          <td style={s.avg_risk >= 50 ? { color: "var(--danger)" } : s.avg_risk >= 25 ? { color: "var(--warning)" } : undefined}>
                            {s.avg_risk}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* State pie chart detail */}
            {selectedState && (
              <div style={{ flex: "0 0 340px" }}>
                <div className="detail-card">
                  <h3 style={{ margin: "0 0 12px" }}>
                    {STATE_NAMES[selectedState] || selectedState} — Origin Breakdown
                  </h3>
                  {stateDetailLoading ? (
                    <div className="loading">Loading...</div>
                  ) : stateDetail.length === 0 ? (
                    <div className="history-empty">No data</div>
                  ) : (
                    <>
                      <PieChart data={statePieData} size={220} />
                      <div style={{ marginTop: 12 }}>
                        <PieLegend data={statePieData} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : tab === "explore" ? (
        /* ═══════════════════════════════════════════════════
           TAB: Explore Origin — Officers by origin
           ═══════════════════════════════════════════════════ */
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={selectedOrigin}
              onChange={e => {
                const p = new URLSearchParams(searchParams);
                if (e.target.value) p.set("origin", e.target.value); else p.delete("origin");
                setSearchParams(p);
              }}
              style={{
                padding: "6px 12px", background: "var(--bg-secondary)",
                border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)", minWidth: 220,
              }}
            >
              <option value="">Select an origin...</option>
              {origins.map(o => (
                <option key={o.code} value={o.code}>{o.name} ({o.code}) -- {o.officer_count.toLocaleString()} officers</option>
              ))}
            </select>
            <select
              value={selectedState}
              onChange={e => {
                const p = new URLSearchParams(searchParams);
                if (e.target.value) p.set("state", e.target.value); else p.delete("state");
                setSearchParams(p);
              }}
              style={{
                padding: "6px 12px", background: "var(--bg-secondary)",
                border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-primary)",
              }}
            >
              <option value="">All States</option>
              {Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            {selectedOrigin && (() => {
              const info = origins.find(o => o.code === selectedOrigin);
              return info ? (
                <>
                  <div className="stat-chip"><strong>{info.officer_count.toLocaleString()}</strong> officers</div>
                  <div className="stat-chip"><strong>{info.carrier_count.toLocaleString()}</strong> carriers</div>
                  <div className="stat-chip"><strong>{info.avg_risk}</strong> avg risk</div>
                  <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Region: {info.region}</span>
                </>
              ) : null;
            })()}
          </div>

          {!selectedOrigin ? (
            <div className="history-empty">Select an origin above to see top officers</div>
          ) : officersLoading ? (
            <div className="skeleton-rows">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton-row">
                  <div className="skeleton skeleton-text" style={{ flex: 1 }} />
                  <div className="skeleton skeleton-badge" style={{ width: 40 }} />
                </div>
              ))}
            </div>
          ) : officers.length === 0 ? (
            <div className="history-empty">No officers found with 2+ carriers</div>
          ) : (
            <div className="history-scroll">
              <table className="history-table">
                <thead>
                  <tr><th>#</th><th>Officer Name</th><th>Carriers</th><th>Total Risk</th><th>Statuses</th><th>DOT Numbers</th></tr>
                </thead>
                <tbody>
                  {officers.map((e, i) => (
                    <tr key={i} style={e.carrier_count >= 25 ? { background: "rgba(239,68,68,0.08)" } : e.carrier_count >= 10 ? { background: "rgba(245,158,11,0.06)" } : undefined}>
                      <td style={{ fontWeight: 700, color: "var(--text-secondary)" }}>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>
                        <Link to={`/network/${encodeURIComponent(e.officer_name)}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                          {e.officer_name}
                        </Link>
                      </td>
                      <td style={e.carrier_count >= 25 ? { color: "var(--danger)", fontWeight: 700 } : e.carrier_count >= 10 ? { color: "var(--warning)", fontWeight: 600 } : undefined}>
                        {e.carrier_count}
                      </td>
                      <td style={e.total_risk >= 100 ? { color: "var(--danger)" } : undefined}>{e.total_risk}</td>
                      <td>
                        {e.statuses.map((s, j) => (
                          <span key={j} style={{
                            display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 11, marginRight: 4,
                            background: s === "AUTHORIZED" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                            color: s === "AUTHORIZED" ? "var(--success)" : "var(--danger)",
                          }}>{s}</span>
                        ))}
                      </td>
                      <td><DotList dots={e.dot_numbers} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === "search" ? (
        /* ═══════════════════════════════════════════════════
           TAB: Lookup — Classify a surname
           ═══════════════════════════════════════════════════ */
        <div>
          <div className="detail-card" style={{ marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px" }}>Surname Origin Lookup</h3>
            <p style={{ color: "var(--text-secondary)", margin: "0 0 12px", fontSize: 14 }}>
              Enter a surname to see its predicted national origin based on character pattern analysis.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch()}
                placeholder="Enter a surname (e.g., Patel, Nguyen, Mueller)..."
                style={{
                  flex: 1, padding: "10px 14px", background: "var(--bg-secondary)",
                  border: "1px solid var(--border)", borderRadius: 6,
                  color: "var(--text-primary)", fontSize: 15,
                }}
              />
              <button
                onClick={doSearch}
                style={{
                  padding: "10px 24px", background: "var(--accent)", border: "none",
                  borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 15, fontWeight: 600,
                }}
              >
                Classify
              </button>
            </div>
          </div>

          {searchLoading && <div className="loading">Classifying...</div>}

          {searchResult && (
            <div className="detail-card">
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
                <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "monospace" }}>
                  {searchResult.surname.toUpperCase()}
                </span>
                {searchResult.code && (
                  <span style={{
                    padding: "4px 14px", borderRadius: 6, fontSize: 14, fontWeight: 600,
                    background: ORIGIN_COLORS[searchResult.code] || REGION_COLORS[searchResult.region || ""] || "var(--bg-secondary)",
                    color: "#fff",
                  }}>
                    {searchResult.name} ({searchResult.code})
                  </span>
                )}
              </div>

              {searchResult.code ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Predicted Origin</span>
                      <div style={{ fontWeight: 600 }}>{searchResult.name}</div>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Region</span>
                      <div style={{ fontWeight: 600 }}>{searchResult.region}</div>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Confidence</span>
                      <div style={{ fontWeight: 600, color: searchResult.confidence >= 0.5 ? "var(--success)" : searchResult.confidence >= 0.3 ? "var(--warning)" : "var(--danger)" }}>
                        {(searchResult.confidence * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Match Type</span>
                      <div style={{ fontWeight: 600 }}>{searchResult.found ? "Exact" : "Fuzzy"}</div>
                    </div>
                  </div>
                  {!searchResult.found && searchResult.closest_match && (
                    <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                      Closest match in database: <strong>{searchResult.closest_match}</strong>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      const p = new URLSearchParams(searchParams);
                      p.set("tab", "explore");
                      p.set("origin", searchResult.code!);
                      setSearchParams(p);
                    }}
                    style={{
                      padding: "6px 16px", background: "var(--accent)", border: "none",
                      borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 13,
                      alignSelf: "flex-start", marginTop: 8,
                    }}
                  >
                    Explore {searchResult.name} officers
                  </button>
                </div>
              ) : (
                <div style={{ color: "var(--text-secondary)" }}>
                  This surname was not found in the classification database.
                </div>
              )}
            </div>
          )}

          {/* Sample lookups */}
          <div className="detail-card" style={{ marginTop: 20 }}>
            <h3 style={{ margin: "0 0 12px" }}>Try These</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Patel", "Nguyen", "Kim", "Garcia", "Mueller", "Nakamura", "Kowalski", "Okafor", "Hassan", "Papadopoulos"].map(name => (
                <button
                  key={name}
                  onClick={() => { setSearchQuery(name); setSearchLoading(true); setSearchResult(null);
                    fetch(`${API_URL}/api/demographics/search?q=${name}`)
                      .then(r => r.json())
                      .then(data => { setSearchResult(data); setSearchLoading(false); })
                      .catch(() => setSearchLoading(false));
                  }}
                  style={{
                    padding: "4px 12px", background: "var(--bg-secondary)",
                    border: "1px solid var(--border)", borderRadius: 4,
                    color: "var(--accent)", cursor: "pointer", fontSize: 13,
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : tab === "methodology" ? (
        /* ═══════════════════════════════════════════════════
           TAB: Methodology — Full technical description
           ═══════════════════════════════════════════════════ */
        <div style={{ maxWidth: 800 }}>
          <div className="detail-card" style={{ marginBottom: 20 }}>
            <h2 style={{ margin: "0 0 16px" }}>Methodology</h2>

            <h3 style={{ margin: "16px 0 8px", color: "var(--accent)" }}>Overview</h3>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
              CarrierWatch's Officer Demographics Explorer classifies the predicted national origin of every FMCSA-registered
              carrier officer's surname. This is done using a character n-gram Naive Bayes classifier — a well-established
              technique in computational linguistics, census research, and epidemiological studies for inferring probable
              ethnicity from surname spelling patterns.
            </p>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
              The system runs entirely offline with zero external API costs. No personal data beyond the publicly available
              FMCSA Census File is used. The classifier makes probabilistic predictions based on spelling patterns alone —
              it does not use given names, addresses, or any other demographic signals.
            </p>

            <h3 style={{ margin: "24px 0 8px", color: "var(--accent)" }}>How It Works</h3>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <strong>1. Training data.</strong> A curated reference dataset of ~9,000 surnames across 25 specific national
              origins and 10 regional fallback groups. Sources include Wikipedia country-specific surname lists,
              Forebears.io top-1000 lists for India and Russia, and the U.S. Census Bureau's top-12,000 surnames
              (classified by suffix heuristics into origin buckets).
            </p>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
              <strong>2. Feature extraction.</strong> Each surname is decomposed into overlapping character n-grams
              (bigrams, trigrams, and 4-grams) with boundary markers. For example, "Patel" becomes: ^P, ^Pa, Pa, Pat,
              at, ate, te, tel, el, el$, l$. These patterns capture the character-level structure that makes surnames
              from different origins distinctive.
            </p>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
              <strong>3. Classification.</strong> Multinomial Naive Bayes with Laplace smoothing (alpha=0.5) computes the
              log-probability of each surname belonging to each origin category, then normalizes via softmax to produce
              calibrated confidence scores. If the top specific-category confidence exceeds 35%, that origin is assigned.
              Otherwise, the surname falls back to a broader regional classifier (e.g., "Latino" instead of "Mexican vs. Colombian").
            </p>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
              <strong>4. Zero unknowns.</strong> Every surname receives a classification. The hierarchical fallback system
              ensures that even ambiguous names are assigned to a meaningful regional group. There is no "Unknown" category.
            </p>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
              <strong>5. Carrier mapping.</strong> Each carrier's "dominant origin" is computed from its officers' surname
              classifications (highest-confidence match) and stored for map overlay visualization.
            </p>

            <h3 style={{ margin: "24px 0 8px", color: "var(--accent)" }}>25 Specific Categories</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {[
                "Japanese (JP)", "Korean (KR)", "Chinese (CN)", "Vietnamese (VN)", "Filipino (PH)",
                "Indian (IN)", "Greek (GR)", "Georgian (GE)", "Italian (IT)", "Dutch (NL)",
                "German (DE)", "Hungarian (HU)", "Polish (PL)", "Russian (RU)", "Ukrainian (UA)",
                "Finnish (FI)", "Armenian (AM)", "Turkish (TR)", "Arabic (AR)",
                "Portuguese (PT)", "Spanish (ES)", "Irish (IE)", "British (GB)",
                "Nigerian (NG)", "Ethiopian (ET)",
              ].map(cat => (
                <span key={cat} style={{
                  padding: "2px 8px", background: "var(--bg-secondary)", border: "1px solid var(--border)",
                  borderRadius: 4, fontSize: 12, color: "var(--text-primary)",
                }}>{cat}</span>
              ))}
            </div>

            <h3 style={{ margin: "24px 0 8px", color: "var(--accent)" }}>10 Regional Fallback Groups</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {REGION_ORDER.map(r => (
                <span key={r} style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                  background: REGION_COLORS[r], color: "#fff",
                }}>{r}</span>
              ))}
            </div>

            <h3 style={{ margin: "24px 0 8px", color: "var(--accent)" }}>Accuracy Characteristics</h3>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Accuracy varies significantly by origin. Origins with highly distinctive surname patterns achieve
              near-perfect accuracy:
            </p>
            <ul style={{ color: "var(--text-secondary)", lineHeight: 1.8, paddingLeft: 20 }}>
              <li><strong>Very high accuracy (&gt;95%):</strong> Vietnamese (Nguyen, Tran, Pham), Korean (Kim, Park, Choi), Japanese (Tanaka, Suzuki, Watanabe), Greek (-opoulos, -akis, -idis), Armenian (-yan, -ian)</li>
              <li><strong>High accuracy (80-95%):</strong> Indian (Patel, Sharma, Kumar), Polish (-ski, -wicz), Russian (-ov, -ev, -in), Finnish (-nen, -la), Italian (-ini, -elli, -etti)</li>
              <li><strong>Moderate accuracy (60-80%):</strong> German, Dutch, Turkish, Arabic, Nigerian</li>
              <li><strong>Lower accuracy:</strong> Anglo vs. American overlap is inherently high — names like "Smith" or "Johnson" appear across multiple English-speaking populations. These fall to the "Anglo" regional group.</li>
            </ul>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginTop: 8 }}>
              When the specific-category classifier is uncertain (confidence &lt; 35%), the regional fallback ensures a
              meaningful classification. For example, "Hernandez" might be uncertain between Spanish, Mexican, or Colombian
              at the specific level — but it will always be classified as "Latino" at the regional level with high confidence.
            </p>

            <h3 style={{ margin: "24px 0 8px", color: "var(--accent)" }}>Limitations and Caveats</h3>
            <ul style={{ color: "var(--text-secondary)", lineHeight: 1.8, paddingLeft: 20 }}>
              <li>Surname origin is a <em>statistical prediction</em>, not a statement about any individual's actual ethnicity, nationality, or identity.</li>
              <li>Names can change through marriage, transliteration, or personal choice — the classifier sees only the final registered spelling.</li>
              <li>Multi-ethnic or diaspora surnames may be classified to the region of highest statistical association.</li>
              <li>The FMCSA officer name field is often uppercase, abbreviated, or misspelled — the classifier normalizes to lowercase and extracts the last token as the surname.</li>
              <li>This tool is intended for aggregate statistical analysis of carrier ownership demographics, not for making decisions about individuals.</li>
            </ul>

            <h3 style={{ margin: "24px 0 8px", color: "var(--accent)" }}>Data Sources</h3>
            <ul style={{ color: "var(--text-secondary)", lineHeight: 1.8, paddingLeft: 20 }}>
              <li><strong>FMCSA Census File</strong> (DOT DataHub, dataset az4n-8mr2): 4.47M officer records, 3.39M unique normalized names</li>
              <li><strong>Training surnames:</strong> Wikipedia country surname lists, Forebears.io, U.S. Census Bureau surname frequency data</li>
              <li><strong>Model:</strong> Multinomial Naive Bayes, character n-grams (2,3,4), Laplace smoothing (0.5), ~9,000 training names</li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
