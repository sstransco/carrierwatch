import { Link } from "react-router-dom";

export default function AboutPage() {
  return (
    <div className="detail-page about-page">
      <Link to="/" className="detail-back">&larr; Back to map</Link>

      <div className="about-hero">
        <h1>Carrier<span className="accent">Watch</span></h1>
        <p className="about-tagline">
          Free public transparency tool for the U.S. trucking industry
        </p>
      </div>

      <div className="about-section">
        <h2>What is CarrierWatch?</h2>
        <p>
          CarrierWatch maps every FMCSA-registered motor carrier in the United States &mdash;
          over 4.3 million companies &mdash; and cross-references them against safety records,
          inspection data, crash history, insurance filings, and PPP loan data to identify
          fraud patterns and unsafe operators.
        </p>
        <p>
          The platform is designed to combat <strong>"chameleon carriers"</strong> &mdash; unsafe
          trucking companies that shut down and re-register under new names at the same address
          to evade safety enforcement. This is a well-documented problem that puts every driver
          on the road at risk.
        </p>
      </div>

      <div className="about-section">
        <h2>How Risk Scoring Works</h2>
        <p>
          Every carrier receives a composite risk score (0&ndash;100+) based on multiple fraud
          and safety indicators. Higher scores indicate more red flags:
        </p>
        <table className="about-table">
          <thead>
            <tr><th>Flag</th><th>Points</th><th>What It Means</th></tr>
          </thead>
          <tbody>
            <tr><td>Address Overlap (25+)</td><td>+50</td><td>25 or more carriers registered at the same physical address</td></tr>
            <tr><td>Address Overlap (10+)</td><td>+35</td><td>10&ndash;24 carriers at same address</td></tr>
            <tr><td>Address Overlap (5+)</td><td>+20</td><td>5&ndash;9 carriers at same address</td></tr>
            <tr><td>Fatal Crashes</td><td>+25</td><td>Carrier has at least one fatal crash on record</td></tr>
            <tr><td>High Crash Count</td><td>+15</td><td>3 or more crashes (non-fatal)</td></tr>
            <tr><td>High Vehicle OOS</td><td>+20</td><td>Vehicle out-of-service rate exceeds 30%</td></tr>
            <tr><td>High Driver OOS</td><td>+15</td><td>Driver out-of-service rate exceeds 20%</td></tr>
            <tr><td>New Authority</td><td>+15</td><td>Operating authority granted within the past year</td></tr>
            <tr><td>PO Box Address</td><td>+15</td><td>Uses a PO Box instead of a physical domicile address</td></tr>
            <tr><td>No Physical Address</td><td>+10</td><td>No physical address on file with FMCSA</td></tr>
            <tr><td>Large PPP Loan</td><td>+20</td><td>Received PPP loan exceeding $100,000</td></tr>
            <tr><td>PPP Loan</td><td>+10</td><td>Received any PPP loan</td></tr>
            <tr><td>PPP Forgiven at Cluster</td><td>+15</td><td>PPP loan forgiven at an address with 3+ carriers</td></tr>
            <tr><td>Inactive at Cluster</td><td>+10</td><td>Inactive carrier at an address with 3+ other carriers</td></tr>
            <tr><td>Insurance Lapse</td><td>+20</td><td>Insurance coverage has lapsed or been cancelled</td></tr>
            <tr><td>Authority Revoked/Reissued</td><td>+15</td><td>Operating authority was revoked then reissued</td></tr>
          </tbody>
        </table>
        <p className="about-note">
          Risk scores are informational indicators, not legal determinations. A high score
          means a carrier has multiple characteristics commonly associated with fraud or
          safety concerns &mdash; it does not prove wrongdoing.
        </p>
      </div>

      <div className="about-section">
        <h2>Data Sources</h2>
        <table className="about-table">
          <thead>
            <tr><th>Dataset</th><th>Source</th><th>Records</th><th>Updated</th></tr>
          </thead>
          <tbody>
            <tr><td>Carrier Census</td><td>FMCSA / DOT DataHub</td><td>4.3M+</td><td>Daily</td></tr>
            <tr><td>Vehicle Inspections</td><td>FMCSA / DOT DataHub</td><td>8.2M+</td><td>Monthly</td></tr>
            <tr><td>Crash Records</td><td>FMCSA / DOT DataHub</td><td>4.9M+</td><td>Monthly</td></tr>
            <tr><td>Insurance History</td><td>FMCSA / DOT DataHub</td><td>7.3M+</td><td>Monthly</td></tr>
            <tr><td>Authority History</td><td>FMCSA / DOT DataHub</td><td>1.8M+</td><td>Monthly</td></tr>
            <tr><td>PPP Loan Data</td><td>SBA FOIA</td><td>5.5M+</td><td>Static (Sept 2024)</td></tr>
            <tr><td>Geocoding</td><td>U.S. Census Bureau</td><td>&mdash;</td><td>On ingest</td></tr>
          </tbody>
        </table>
        <p>
          All data is sourced from public federal databases. No private or proprietary
          data is used. FMCSA data is available through the&nbsp;
          <a href="https://datahub.transportation.gov" target="_blank" rel="noopener">DOT DataHub</a>.
          PPP loan data is available through the&nbsp;
          <a href="https://data.sba.gov/dataset/ppp-foia" target="_blank" rel="noopener">SBA FOIA dataset</a>.
        </p>
      </div>

      <div className="about-section">
        <h2>What is a Chameleon Carrier?</h2>
        <p>
          A chameleon carrier is a motor carrier that has been shut down for safety violations
          but continues operating by registering a new company &mdash; often at the same address,
          with the same equipment, and sometimes with the same drivers. These operators cycle
          through company names to avoid FMCSA enforcement actions and maintain clean safety records.
        </p>
        <p>
          CarrierWatch detects this pattern by identifying addresses with unusually high numbers
          of registered carriers, especially when combined with other risk indicators like
          inactive statuses, new authorities, and crash histories.
        </p>
      </div>

      <div className="about-section">
        <h2>Why PPP Loans?</h2>
        <p>
          The Paycheck Protection Program (PPP) distributed over $800 billion in forgivable
          loans during 2020&ndash;2021. Cross-referencing PPP recipients with FMCSA carrier data
          reveals cases where carriers at the same address received multiple loans, where
          inactive carriers received loans, or where loan amounts seem disproportionate to
          the carrier's reported fleet size and driver count.
        </p>
        <p>
          PPP data alone does not indicate fraud &mdash; many legitimate carriers received loans.
          But when combined with other risk indicators, it highlights patterns worth investigating.
        </p>
      </div>

      <div className="about-section">
        <h2>For Truckers</h2>
        <p>
          If you're an owner-operator or fleet manager, CarrierWatch helps you:
        </p>
        <ul className="about-list">
          <li>Research carriers before doing business with them</li>
          <li>Check a carrier's safety record, crash history, and inspection results</li>
          <li>Verify that a carrier has active operating authority and valid insurance</li>
          <li>See if a carrier's address is shared with other companies (chameleon pattern)</li>
          <li>Look up PPP loan history for transparency</li>
        </ul>
      </div>

      <div className="about-section">
        <h2>Open Source</h2>
        <p>
          CarrierWatch is a free public service. The code, methodology, and data pipelines
          are transparent. If you find errors or have suggestions, contributions are welcome.
        </p>
      </div>
    </div>
  );
}
