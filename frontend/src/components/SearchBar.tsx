import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface SearchBarProps {
  onFlyTo: (lng: number, lat: number, zoom?: number) => void;
}

export default function SearchBar({ onFlyTo }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setResults([]);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/carriers/search?q=${encodeURIComponent(q)}&limit=15`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (query.trim().length > 0) {
      debounceRef.current = window.setTimeout(() => search(query.trim()), 200);
    } else {
      setResults([]);
      setOpen(false);
    }
    return () => { if (debounceRef.current !== null) window.clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = async (result: SearchResult) => {
    setOpen(false);
    setQuery(result.legal_name);

    // Fetch carrier to get location
    try {
      const res = await fetch(`${API_URL}/api/carriers/${result.dot_number}`);
      if (res.ok) {
        const carrier = await res.json();
        if (carrier.latitude && carrier.longitude) {
          onFlyTo(carrier.longitude, carrier.latitude, 14);
        }
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="search-container" ref={containerRef}>
      <input
        className="search-input"
        type="text"
        placeholder="Search by DOT#, MC#, or carrier name..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <div
              key={r.dot_number}
              className="search-result-item"
              onClick={() => handleSelect(r)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="search-result-name">{r.legal_name}</div>
                {r.risk_score > 0 && (
                  <span className={`risk-badge-sm ${r.risk_score >= 70 ? "risk-critical" : r.risk_score >= 50 ? "risk-high" : r.risk_score >= 30 ? "risk-medium" : "risk-low"}`}>
                    {r.risk_score}
                  </span>
                )}
              </div>
              <div className="search-result-meta">
                DOT# {r.dot_number}
                {r.physical_city && ` · ${r.physical_city}, ${r.physical_state}`}
                {r.operating_status && ` · ${r.operating_status}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
