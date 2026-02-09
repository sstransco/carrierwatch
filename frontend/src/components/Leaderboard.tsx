import { useEffect, useState } from "react";
import type { AddressCluster } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
  const [clusters, setClusters] = useState<AddressCluster[]>([]);
  const [stateFilter, setStateFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (stateFilter) params.set("state", stateFilter);

    fetch(`${API_URL}/api/addresses/top-flagged?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setClusters(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [stateFilter]);

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
        <div className="loading">Loading flagged addresses...</div>
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
            {clusters.map((c, i) => (
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
