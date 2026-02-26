import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";

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

  const handleLocate = (e: React.MouseEvent, result: SearchResult) => {
    e.stopPropagation();
    if (result.latitude && result.longitude) {
      setOpen(false);
      setQuery(result.legal_name);
      onFlyTo(result.longitude, result.latitude, 14);
    }
  };

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery(result.legal_name);
    window.location.href = `/carrier/${result.dot_number}`;
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
                <div className="search-result-name" style={{ flex: 1 }}>{r.legal_name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {r.latitude && r.longitude && (
                    <button
                      onClick={(e) => handleLocate(e, r)}
                      title="Locate on map"
                      style={{
                        background: "none", border: "1px solid var(--border, #2e3344)",
                        borderRadius: 4, padding: "2px 6px", cursor: "pointer",
                        color: "var(--accent, #3b82f6)", fontSize: 12, lineHeight: 1,
                      }}
                    >
                      &#x1F4CD;
                    </button>
                  )}
                  {r.risk_score > 0 && (
                    <span className={`risk-badge-sm ${r.risk_score >= 70 ? "risk-critical" : r.risk_score >= 50 ? "risk-high" : r.risk_score >= 30 ? "risk-medium" : "risk-low"}`}>
                      {r.risk_score}
                    </span>
                  )}
                </div>
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
