import { useState } from "react";

const US_STATES = [
  "", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export default function Filters() {
  const [state, setState] = useState("");
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [minFleet, setMinFleet] = useState("");
  const [maxFleet, setMaxFleet] = useState("");
  const [minOverlap, setMinOverlap] = useState("");

  const handleApply = () => {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (status) params.set("status", status);
    if (rating) params.set("rating", rating);
    if (minFleet) params.set("min_fleet", minFleet);
    if (maxFleet) params.set("max_fleet", maxFleet);
    if (minOverlap) params.set("min_overlap", minOverlap);

    // This could trigger a map filter or carrier list reload
    console.log("Filters applied:", Object.fromEntries(params));
  };

  const handleReset = () => {
    setState("");
    setStatus("");
    setRating("");
    setMinFleet("");
    setMaxFleet("");
    setMinOverlap("");
  };

  return (
    <div>
      <div className="filter-group">
        <label>State</label>
        <select className="filter-select" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All States</option>
          {US_STATES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label>Operating Status</label>
        <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="AUTHORIZED">Authorized</option>
          <option value="NOT AUTHORIZED">Not Authorized</option>
          <option value="OUT-OF-SERVICE">Out of Service</option>
        </select>
      </div>

      <div className="filter-group">
        <label>Safety Rating</label>
        <select className="filter-select" value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">Any Rating</option>
          <option value="Satisfactory">Satisfactory</option>
          <option value="Conditional">Conditional</option>
          <option value="Unsatisfactory">Unsatisfactory</option>
        </select>
      </div>

      <div className="filter-group">
        <label>Fleet Size (power units)</label>
        <div className="filter-row">
          <input
            className="filter-input"
            type="number"
            placeholder="Min"
            value={minFleet}
            onChange={(e) => setMinFleet(e.target.value)}
          />
          <input
            className="filter-input"
            type="number"
            placeholder="Max"
            value={maxFleet}
            onChange={(e) => setMaxFleet(e.target.value)}
          />
        </div>
      </div>

      <div className="filter-group">
        <label>Min carriers at same address</label>
        <input
          className="filter-input"
          type="number"
          placeholder="e.g. 5"
          value={minOverlap}
          onChange={(e) => setMinOverlap(e.target.value)}
        />
      </div>

      <button className="filter-btn" onClick={handleApply}>
        Apply Filters
      </button>
      <button className="filter-btn filter-btn-outline" onClick={handleReset}>
        Reset
      </button>
    </div>
  );
}
