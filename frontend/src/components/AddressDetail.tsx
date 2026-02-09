import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { AddressCluster, CarrierSummary } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function statusClass(status: string | null): string {
  if (!status) return "";
  if (status === "AUTHORIZED") return "status-authorized";
  if (status.includes("OUT") || status.includes("REVOKED")) return "status-revoked";
  return "status-inactive";
}

export default function AddressDetailPage() {
  const { addressHash } = useParams<{ addressHash: string }>();
  const [cluster, setCluster] = useState<AddressCluster | null>(null);
  const [carriers, setCarriers] = useState<CarrierSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!addressHash) return;
    fetch(`${API_URL}/api/addresses/${addressHash}`)
      .then((r) => r.json())
      .then((data) => {
        setCluster(data.cluster);
        setCarriers(data.carriers);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [addressHash]);

  if (loading) return <div className="detail-page"><div className="loading">Loading...</div></div>;
  if (!cluster) {
    return (
      <div className="detail-page">
        <Link to="/" className="detail-back">← Back to map</Link>
        <p>Address not found</p>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <Link to="/" className="detail-back">← Back to map</Link>

      <div className="detail-header">
        <h1>{cluster.address || "Unknown Address"}</h1>
        <div className="dot-badge">{cluster.city}, {cluster.state} {cluster.zip}</div>
      </div>

      <div className="detail-grid" style={{ marginBottom: 24 }}>
        <div className="detail-card">
          <h3>Address Summary</h3>
          <div className="detail-row"><span className="label">Total Carriers</span><span className="value">{cluster.carrier_count}</span></div>
          <div className="detail-row"><span className="label">Active Carriers</span><span className="value">{cluster.active_count}</span></div>
          <div className="detail-row"><span className="label">Total Crashes</span><span className="value">{cluster.total_crashes}</span></div>
          <div className="detail-row"><span className="label">Avg Vehicle OOS Rate</span><span className="value">{cluster.avg_vehicle_oos_rate.toFixed(1)}%</span></div>
        </div>
      </div>

      {cluster.carrier_count >= 5 && (
        <div className="colocated-warning">
          {cluster.carrier_count} carriers registered at this address.
          This concentration of registrations is a potential indicator of chameleon carrier activity.
        </div>
      )}

      <h2 style={{ marginBottom: 12 }}>
        All Carriers at this Address ({carriers.length})
      </h2>

      {carriers.map((c) => (
        <Link
          key={c.dot_number}
          to={`/carrier/${c.dot_number}`}
          className="carrier-list-item"
        >
          <div>
            <div style={{ fontWeight: 500 }}>{c.legal_name}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              DOT# {c.dot_number} · {c.power_units} units · {c.drivers} drivers
              {c.total_crashes > 0 && ` · ${c.total_crashes} crashes`}
            </div>
          </div>
          <span className={`status-badge ${statusClass(c.operating_status)}`}>
            {c.operating_status || "?"}
          </span>
        </Link>
      ))}
    </div>
  );
}
