import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_URL } from "../hooks/useApi";

const STATES = [
  "", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const TRAINING_TYPES = ["", "Class A", "Class B", "Passenger", "School Bus", "Hazmat"];

interface CDLSchool {
  id: number;
  provider_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  training_types: string[];
  provider_type: string | null;
  status: string | null;
  address_hash: string | null;
}

interface CDLStats {
  total_schools: number;
  states_covered: number;
  at_carrier_addresses: number;
  top_states: { state: string; count: number }[];
  training_types: { type: string; count: number }[];
}

export default function CDLSchoolsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [schools, setSchools] = useState<CDLSchool[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<CDLStats | null>(null);
  const [search, setSearch] = useState(searchParams.get("q") || "");

  const state = searchParams.get("state") || "";
  const type = searchParams.get("type") || "";
  const page = parseInt(searchParams.get("page") || "1", 10);

  useEffect(() => {
    fetch(`${API_URL}/api/cdl-schools/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const loadSchools = () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (state) params.set("state", state);
    if (type) params.set("training_type", type);
    if (search.trim()) params.set("q", search.trim());

    fetch(`${API_URL}/api/cdl-schools?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSchools(data.items);
        setTotal(data.total);
        setPages(data.pages);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { loadSchools(); }, [state, type, page, search]);

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("page");
    setSearchParams(p);
  };

  return (
    <div className="detail-page">
      <Link to="/" className="detail-back">&larr; Back to map</Link>

      <div className="detail-header">
        <h1>CDL Training Schools</h1>
        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
          FMCSA-registered Entry-Level Driver Training (ELDT) providers
        </p>
      </div>

      {/* Stats summary */}
      {stats && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div className="stat-chip"><strong>{stats.total_schools.toLocaleString()}</strong> schools</div>
          <div className="stat-chip"><strong>{stats.states_covered}</strong> states</div>
          {stats.training_types.map((t) => (
            <div key={t.type} className="stat-chip">
              <strong>{t.count.toLocaleString()}</strong> {t.type}
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search provider name..."
          style={{
            padding: "6px 12px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-primary)",
            fontSize: 14,
            minWidth: 200,
          }}
        />
        <select
          value={state}
          onChange={(e) => updateParam("state", e.target.value)}
          style={{
            padding: "6px 12px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-primary)",
          }}
        >
          <option value="">All States</option>
          {STATES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={type}
          onChange={(e) => updateParam("type", e.target.value)}
          style={{
            padding: "6px 12px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-primary)",
          }}
        >
          <option value="">All Types</option>
          {TRAINING_TYPES.filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Results */}
      <div style={{ marginBottom: 8, color: "var(--text-secondary)", fontSize: 13 }}>
        {total.toLocaleString()} results {state ? `in ${state}` : ""} {type ? `for ${type}` : ""}
      </div>

      {loading ? (
        <div className="skeleton-rows">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton skeleton-text" style={{ flex: 1, marginBottom: 0 }} />
              <div className="skeleton skeleton-text" style={{ width: 80, marginBottom: 0 }} />
              <div className="skeleton skeleton-badge" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="error-state">
          <div className="error-title">Failed to load schools</div>
          <p>{error}</p>
          <button className="retry-btn" onClick={loadSchools}>Retry</button>
        </div>
      ) : schools.length === 0 ? (
        <div className="history-empty">No schools found</div>
      ) : (
        <>
          <div className="history-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Provider Name</th>
                  <th>Location</th>
                  <th>Training Types</th>
                  <th>Phone</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500 }}>{s.provider_name}</td>
                    <td>
                      {s.city}{s.state ? `, ${s.state}` : ""} {s.zip || ""}
                      {s.address && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{s.address}</div>}
                    </td>
                    <td>
                      {s.training_types.map((t, i) => (
                        <span key={i} style={{
                          display: "inline-block", padding: "1px 6px", borderRadius: 4,
                          fontSize: 11, marginRight: 4, marginBottom: 2,
                          background: t === "Class A" ? "rgba(59,130,246,0.15)" : t === "Hazmat" ? "rgba(239,68,68,0.15)" : "rgba(100,116,139,0.15)",
                          color: t === "Class A" ? "#60a5fa" : t === "Hazmat" ? "var(--danger)" : "var(--text-secondary)",
                        }}>
                          {t}
                        </span>
                      ))}
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{s.phone || "\u2014"}</td>
                    <td>
                      <span style={{
                        padding: "1px 6px", borderRadius: 4, fontSize: 11,
                        background: s.status === "active" || !s.status ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
                        color: s.status === "active" || !s.status ? "var(--success)" : "var(--warning)",
                      }}>
                        {s.status || "active"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center", alignItems: "center" }}>
              <button
                disabled={page <= 1}
                onClick={() => updateParam("page", String(page - 1))}
                style={{
                  padding: "6px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border)",
                  borderRadius: 6, color: page <= 1 ? "var(--text-secondary)" : "var(--text-primary)", cursor: page <= 1 ? "default" : "pointer",
                }}
              >
                Prev
              </button>
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                Page {page} of {pages}
              </span>
              <button
                disabled={page >= pages}
                onClick={() => updateParam("page", String(page + 1))}
                style={{
                  padding: "6px 12px", background: "var(--bg-secondary)", border: "1px solid var(--border)",
                  borderRadius: 6, color: page >= pages ? "var(--text-secondary)" : "var(--text-primary)", cursor: page >= pages ? "default" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
