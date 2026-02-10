import { useParams, Link } from "react-router-dom";
import { useFetch } from "../hooks/useApi";
import type { AddressCluster, CarrierSummary } from "../types";

function statusClass(status: string | null): string {
  if (!status) return "";
  if (status === "AUTHORIZED") return "status-authorized";
  if (status.includes("OUT") || status.includes("REVOKED")) return "status-revoked";
  return "status-inactive";
}

export default function AddressDetailPage() {
  const { addressHash } = useParams<{ addressHash: string }>();
  const { data, loading, error, retry } = useFetch<{ cluster: AddressCluster; carriers: CarrierSummary[] }>(
    addressHash ? `/api/addresses/${addressHash}` : null
  );

  const cluster = data?.cluster ?? null;
  const carriers = data?.carriers ?? [];

  if (loading) return (
    <div className="detail-page">
      <Link to="/" className="detail-back">&larr; Back to map</Link>
      <div className="skeleton skeleton-header" />
      <div className="skeleton skeleton-text" style={{ width: "40%" }} />
      <div className="skeleton-card" style={{ marginTop: 16 }}>
        {[1, 2, 3, 4].map((r) => (
          <div key={r} className="skeleton-row">
            <div className="skeleton skeleton-text" style={{ width: "35%", marginBottom: 0 }} />
            <div className="skeleton skeleton-text" style={{ width: "20%", marginBottom: 0, marginLeft: "auto" }} />
          </div>
        ))}
      </div>
      <div className="skeleton-rows">
        {[1, 2, 3, 4, 5].map((r) => (
          <div key={r} className="skeleton-row">
            <div className="skeleton skeleton-text" style={{ flex: 1, marginBottom: 0 }} />
            <div className="skeleton skeleton-badge" />
          </div>
        ))}
      </div>
    </div>
  );

  if (error || !cluster) {
    return (
      <div className="detail-page">
        <Link to="/" className="detail-back">&larr; Back to map</Link>
        <div className="error-state">
          <div className="error-title">Failed to load address</div>
          <p>{error || "Address not found"}</p>
          <button className="retry-btn" onClick={retry}>Retry</button>
        </div>
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
