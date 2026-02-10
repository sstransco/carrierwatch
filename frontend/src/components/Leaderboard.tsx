import { useState } from "react";
import { useFetch } from "../hooks/useApi";
import type { AddressCluster } from "../types";

const US_STATES = [
  "", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

interface LeaderboardProps {
  onFlyTo: (lng: number, lat: number, zoom?: number) => void;
}

function countClass(count: number): string {
  if (count >= 25) return "count-critical";
  if (count >= 10) return "count-high";
  if (count >= 5) return "count-medium";
  return "count-low";
}

export default function Leaderboard({ onFlyTo }: LeaderboardProps) {
  const [stateFilter, setStateFilter] = useState("");

  const params = new URLSearchParams({ limit: "100" });
  if (stateFilter) params.set("state", stateFilter);
  const { data: clusters, loading, error, retry } = useFetch<AddressCluster[]>(
    `/api/addresses/top-flagged?${params}`
  );

  const handleClick = (cluster: AddressCluster) => {
    if (cluster.latitude && cluster.longitude) {
      onFlyTo(cluster.longitude, cluster.latitude, 14);
    }
  };

  return (
    <div>
      <div className="filter-group">
        <label>Filter by state</label>
        <select
          className="filter-select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">All States</option>
          {US_STATES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="skeleton-rows">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton" style={{ width: 20, height: 14 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton skeleton-text" style={{ width: "80%", marginBottom: 4 }} />
                <div className="skeleton skeleton-text" style={{ width: "50%", height: 10 }} />
              </div>
              <div className="skeleton skeleton-badge" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="error-state">
          <div className="error-title">Failed to load</div>
          <p>{error}</p>
          <button className="retry-btn" onClick={retry}>Retry</button>
        </div>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Address</th>
              <th>Count</th>
              <th>Crashes</th>
            </tr>
          </thead>
          <tbody>
            {(clusters || []).map((c, i) => (
              <tr key={c.address_hash} onClick={() => handleClick(c)}>
                <td>{i + 1}</td>
                <td>
                  <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
                    {c.address || "Unknown"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {c.city}, {c.state} {c.zip}
                  </div>
                </td>
                <td>
                  <span className={`leaderboard-count ${countClass(c.carrier_count)}`}>
                    {c.carrier_count}
                  </span>
                </td>
                <td>{c.total_crashes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
