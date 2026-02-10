import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_URL } from "../hooks/useApi";
import type { PrincipalLeaderboardEntry } from "../types";

const STATES = [
  "", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export default function PrincipalsLeaderboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState<PrincipalLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<PrincipalLeaderboardEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const state = searchParams.get("state") || "";
  const minCarriers = parseInt(searchParams.get("min") || "5", 10);

  const loadEntries = () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ min_carriers: String(minCarriers), limit: "100" });
    if (state) params.set("state", state);

    fetch(`${API_URL}/api/principals/top?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setEntries(data);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { loadEntries(); }, [state, minCarriers]);

  const doSearch = () => {
    if (search.trim().length < 2) return;
    setSearchLoading(true);
    fetch(`${API_URL}/api/principals/search?q=${encodeURIComponent(search.trim())}&limit=20`)
      .then((r) => r.json())
      .then((data) => {
        setSearchResults(data);
        setSearchLoading(false);
      })
      .catch(() => setSearchLoading(false));
  };

  return (
    <div className="detail-page">
      <Link to="/" className="detail-back">&larr; Back to map</Link>

      <div className="detail-header">
        <h1>Company Officers Leaderboard</h1>
        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
          Officers/principals registered with the most FMCSA carriers
        </p>
      </div>

      {/* Search */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <h3>Search Officers</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search by officer name..."
            style={{
              flex: 1,
              padding: "8px 12px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: 14,
            }}
          />
          <button
            onClick={doSearch}
            style={{
              padding: "8px 16px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Search
          </button>
        </div>
        {searchLoading && <div className="loading" style={{ marginTop: 8 }}>Searching...</div>}
        {searchResults && searchResults.length === 0 && (
          <div className="history-empty" style={{ marginTop: 8 }}>No officers found</div>
        )}
        {searchResults && searchResults.length > 0 && (
          <div className="history-scroll" style={{ marginTop: 8 }}>
            <table className="history-table">
              <thead>
                <tr><th>Officer Name</th><th>Carriers</th><th>DOT Numbers</th></tr>
              </thead>
              <tbody>
                {searchResults.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.officer_name}</td>
                    <td style={r.carrier_count >= 10 ? { color: "var(--danger)", fontWeight: 700 } : r.carrier_count >= 5 ? { color: "var(--warning)" } : undefined}>
                      {r.carrier_count}
                    </td>
                    <td>
                      {r.dot_numbers.slice(0, 5).map((d, j) => (
                        <span key={d}>
                          {j > 0 && ", "}
                          <Link to={`/carrier/${d}`} style={{ color: "var(--accent)" }}>{d}</Link>
                        </span>
                      ))}
                      {r.dot_numbers.length > 5 && <span style={{ color: "var(--text-secondary)" }}> +{r.dot_numbers.length - 5} more</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <select
          value={state}
          onChange={(e) => {
            const p = new URLSearchParams(searchParams);
            if (e.target.value) p.set("state", e.target.value);
            else p.delete("state");
            setSearchParams(p);
          }}
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
          value={minCarriers}
          onChange={(e) => {
            const p = new URLSearchParams(searchParams);
            p.set("min", e.target.value);
            setSearchParams(p);
          }}
          style={{
            padding: "6px 12px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-primary)",
          }}
        >
          <option value="3">3+ carriers</option>
          <option value="5">5+ carriers</option>
          <option value="10">10+ carriers</option>
          <option value="25">25+ carriers</option>
        </select>
      </div>

      {/* Leaderboard */}
      {loading ? (
        <div className="skeleton-rows">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton" style={{ width: 24, height: 14 }} />
              <div className="skeleton skeleton-text" style={{ flex: 1, marginBottom: 0 }} />
              <div className="skeleton skeleton-badge" style={{ width: 36 }} />
              <div className="skeleton skeleton-text" style={{ width: 60, marginBottom: 0 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="error-state">
          <div className="error-title">Failed to load leaderboard</div>
          <p>{error}</p>
          <button className="retry-btn" onClick={loadEntries}>Retry</button>
        </div>
      ) : entries.length === 0 ? (
        <div className="history-empty">No officers found with {minCarriers}+ carriers{state ? ` in ${state}` : ""}</div>
      ) : (
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Officer Name</th>
                <th>Carriers</th>
                <th>Total Risk Score</th>
                <th>Carrier Statuses</th>
                <th>DOT Numbers</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={e.carrier_count >= 25 ? { background: "rgba(239,68,68,0.08)" } : e.carrier_count >= 10 ? { background: "rgba(245,158,11,0.06)" } : undefined}>
                  <td style={{ fontWeight: 700, color: "var(--text-secondary)" }}>{i + 1}</td>
                  <td style={{ fontWeight: 500 }}>{e.officer_name}</td>
                  <td style={e.carrier_count >= 25 ? { color: "var(--danger)", fontWeight: 700 } : e.carrier_count >= 10 ? { color: "var(--warning)", fontWeight: 600 } : undefined}>
                    {e.carrier_count}
                  </td>
                  <td style={e.total_risk >= 100 ? { color: "var(--danger)" } : undefined}>
                    {e.total_risk}
                  </td>
                  <td>
                    {e.statuses.map((s, j) => (
                      <span key={j} style={{
                        display: "inline-block",
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 11,
                        marginRight: 4,
                        background: s === "AUTHORIZED" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                        color: s === "AUTHORIZED" ? "var(--success)" : "var(--danger)",
                      }}>
                        {s}
                      </span>
                    ))}
                  </td>
                  <td>
                    {e.dot_numbers.slice(0, 5).map((d, j) => (
                      <span key={d}>
                        {j > 0 && ", "}
                        <Link to={`/carrier/${d}`} style={{ color: "var(--accent)" }}>{d}</Link>
                      </span>
                    ))}
                    {e.dot_numbers.length > 5 && <span style={{ color: "var(--text-secondary)" }}> +{e.dot_numbers.length - 5} more</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
