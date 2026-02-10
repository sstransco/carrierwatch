import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || "";

interface AddressMill {
  address_hash: string;
  address: string;
  city: string;
  state: string;
  carrier_count: number;
  active_count: number;
  total_crashes: number;
}

interface ZombieCarrier {
  dot_number: number;
  legal_name: string;
  physical_state: string;
  operating_status: string;
  power_units: number;
  total_crashes: number;
  fatal_crashes: number;
  risk_score: number;
  insurance_bipd_on_file: number;
}

interface PPPSuspect {
  dot_number: number;
  legal_name: string;
  physical_state: string;
  power_units: number;
  drivers: number;
  loan_amount: number;
  forgiveness_amount: number;
  jobs_reported: number;
  risk_score: number;
}

interface OfficerEmpire {
  officer_name: string;
  carrier_count: number;
  address_count: number;
  total_crashes: number;
  fatal_crashes: number;
}

interface Summary {
  high_risk_count: number;
  high_risk_fatalities: number;
  high_risk_crashes: number;
  large_clusters: number;
  prolific_officers: number;
  total_ppp_to_carriers: number;
}

function riskClass(score: number): string {
  if (score >= 70) return "risk-critical";
  if (score >= 50) return "risk-high";
  if (score >= 30) return "risk-medium";
  return "risk-low";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function FraudSpotlight() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [mills, setMills] = useState<AddressMill[]>([]);
  const [zombies, setZombies] = useState<ZombieCarrier[]>([]);
  const [ppp, setPpp] = useState<PPPSuspect[]>([]);
  const [officers, setOfficers] = useState<OfficerEmpire[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/spotlight/summary`).then((r) => r.json()),
      fetch(`${API_URL}/api/spotlight/address-mills`).then((r) => r.json()),
      fetch(`${API_URL}/api/spotlight/zombie-carriers`).then((r) => r.json()),
      fetch(`${API_URL}/api/spotlight/ppp-suspicious`).then((r) => r.json()),
      fetch(`${API_URL}/api/spotlight/officer-empires`).then((r) => r.json()),
    ])
      .then(([s, m, z, p, o]) => {
        setSummary(s);
        setMills(m);
        setZombies(z);
        setPpp(p);
        setOfficers(o);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="detail-page" style={{ maxWidth: 960 }}>
        <Link to="/" className="detail-back">&larr; Back to map</Link>
        <div className="loading" style={{ padding: 40, textAlign: "center" }}>Loading spotlight data...</div>
      </div>
    );
  }

  return (
    <div className="detail-page" style={{ maxWidth: 960 }}>
      <Link to="/" className="detail-back">&larr; Back to map</Link>

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Fraud Spotlight</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 700, lineHeight: 1.6 }}>
          The patterns below were identified by cross-referencing 4.39 million FMCSA carrier records
          with PPP loan data, officer filings, address clustering, and inspection/crash histories.
          None of this data is hidden — it's all public. It's just never been combined and visualized before.
        </p>
      </div>

      {/* Big stats */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 36 }}>
          <div className="detail-card" style={{ textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--danger)" }}>{summary.high_risk_count.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>High-Risk Carriers</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--danger)" }}>{summary.high_risk_fatalities.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>Fatalities</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--warning)" }}>{summary.large_clusters.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>Address Mills (25+)</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--warning)" }}>{summary.prolific_officers.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>Officers (10+ Carriers)</div>
          </div>
          <div className="detail-card" style={{ textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent)" }}>${(summary.total_ppp_to_carriers / 1e9).toFixed(1)}B</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>PPP to DOT Carriers</div>
          </div>
        </div>
      )}

      {/* Officer Empires */}
      <Section title="Shadow Operators — Officers Controlling Hundreds of Carriers">
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
          These individuals are listed as officers on dozens to hundreds of separate carrier companies.
          Click "View Network" to see the full web of connections.
        </p>
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr><th>Officer</th><th>Carriers</th><th>Addresses</th><th>Crashes</th><th>Fatal</th><th></th></tr>
            </thead>
            <tbody>
              {officers.map((o) => (
                <tr key={o.officer_name}>
                  <td style={{ fontWeight: 600 }}>{o.officer_name.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</td>
                  <td><strong>{o.carrier_count}</strong></td>
                  <td>{o.address_count}</td>
                  <td style={{ color: o.total_crashes > 100 ? "var(--warning)" : undefined }}>{o.total_crashes.toLocaleString()}</td>
                  <td style={{ color: o.fatal_crashes > 0 ? "var(--danger)" : undefined, fontWeight: o.fatal_crashes > 0 ? 700 : undefined }}>
                    {o.fatal_crashes}
                  </td>
                  <td>
                    <Link
                      to={`/network/${encodeURIComponent(o.officer_name)}`}
                      style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12, whiteSpace: "nowrap" }}
                    >
                      View Network &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Address Mills */}
      <Section title="Address Mills — Hundreds of Carriers at a Single Address">
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
          These addresses have an abnormally high concentration of registered carriers.
          Many are single-truck LLCs sharing one commercial address — a hallmark of chameleon carrier operations.
        </p>
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr><th>Address</th><th>City</th><th>State</th><th>Carriers</th><th>Active</th><th>Crashes</th><th></th></tr>
            </thead>
            <tbody>
              {mills.slice(0, 15).map((m) => (
                <tr key={m.address_hash}>
                  <td style={{ fontWeight: 500 }}>{m.address}</td>
                  <td>{m.city}</td>
                  <td>{m.state}</td>
                  <td><strong>{m.carrier_count}</strong></td>
                  <td>{m.active_count}</td>
                  <td style={{ color: m.total_crashes > 50 ? "var(--danger)" : m.total_crashes > 10 ? "var(--warning)" : undefined }}>
                    {m.total_crashes}
                  </td>
                  <td>
                    <Link to={`/address/${m.address_hash}`} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>
                      View &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Zombie Carriers */}
      <Section title="Zombie Carriers — Massive Crash Histories, Minimal Operations">
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
          These carriers report 10 or fewer trucks but have hundreds to thousands of crashes — including dozens of fatalities.
          Many show $0 insurance on file. Still authorized by FMCSA.
        </p>
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr><th>Carrier</th><th>State</th><th>Trucks</th><th>Crashes</th><th>Fatal</th><th>Risk</th><th>Insurance</th><th></th></tr>
            </thead>
            <tbody>
              {zombies.map((z) => (
                <tr key={z.dot_number} style={z.fatal_crashes >= 20 ? { background: "rgba(239,68,68,0.08)" } : undefined}>
                  <td style={{ fontWeight: 500 }}>{z.legal_name}</td>
                  <td>{z.physical_state}</td>
                  <td>{z.power_units}</td>
                  <td style={{ color: "var(--warning)", fontWeight: 600 }}>{z.total_crashes.toLocaleString()}</td>
                  <td style={{ color: "var(--danger)", fontWeight: 700 }}>{z.fatal_crashes}</td>
                  <td>
                    <span className={`risk-badge-sm ${riskClass(z.risk_score)}`}>{z.risk_score}</span>
                  </td>
                  <td style={{ color: z.insurance_bipd_on_file === 0 ? "var(--danger)" : undefined }}>
                    {z.insurance_bipd_on_file === 0 ? "$0" : `$${z.insurance_bipd_on_file.toLocaleString()}`}
                  </td>
                  <td>
                    <Link to={`/carrier/${z.dot_number}`} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>
                      View &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* PPP Fraud */}
      <Section title="PPP Loan Anomalies — Big Loans, Tiny Fleets">
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
          These carriers received large PPP loans relative to their registered fleet size.
          A carrier with 1 truck claiming 500 jobs and receiving $10M is, at minimum, an anomaly worth investigating.
        </p>
        <div className="history-scroll">
          <table className="history-table">
            <thead>
              <tr><th>Carrier</th><th>State</th><th>Trucks</th><th>PPP Loan</th><th>Forgiven</th><th>Jobs Claimed</th><th></th></tr>
            </thead>
            <tbody>
              {ppp.map((p) => (
                <tr key={p.dot_number}>
                  <td style={{ fontWeight: 500 }}>{p.legal_name}</td>
                  <td>{p.physical_state}</td>
                  <td>{p.power_units}</td>
                  <td style={{ fontWeight: 600 }}>${p.loan_amount.toLocaleString()}</td>
                  <td style={{ color: p.forgiveness_amount >= p.loan_amount ? "var(--success)" : undefined }}>
                    ${p.forgiveness_amount.toLocaleString()}
                  </td>
                  <td>{p.jobs_reported}</td>
                  <td>
                    <Link to={`/carrier/${p.dot_number}`} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>
                      View &rarr;
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div style={{ padding: "20px 0", borderTop: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
        <p>
          All data sourced from public FMCSA, SBA, and Census Bureau records. CarrierWatch does not make accusations of fraud —
          we surface patterns in public data that may warrant further investigation. If you believe data shown here is
          inaccurate, please contact us.
        </p>
      </div>
    </div>
  );
}
