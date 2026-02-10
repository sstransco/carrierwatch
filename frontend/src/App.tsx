import { useCallback, useEffect, useRef, useState } from "react";
import Map from "./components/Map";
import SearchBar from "./components/SearchBar";
import Sidebar from "./components/Sidebar";
import LayerToggle from "./components/LayerToggle";
import type { MapLayer, StatsResponse } from "./types";
import type mapboxgl from "mapbox-gl";

const API_URL = import.meta.env.VITE_API_URL || "";

const DEFAULT_LAYERS: MapLayer[] = [
  { id: "risk", label: "Risk Overlay", visible: true },
  { id: "clusters", label: "Address Clusters", visible: true },
  { id: "carriers", label: "Individual Carriers", visible: false },
  { id: "heatmap", label: "Heatmap", visible: false },
  { id: "cdl-schools", label: "CDL Schools", visible: true },
];

export default function App() {
  const [layers, setLayers] = useState<MapLayer[]>(DEFAULT_LAYERS);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  const handleLayerToggle = useCallback((layerId: string) => {
    setLayers((prev) =>
      prev.map((l) => l.id === layerId ? { ...l, visible: !l.visible } : l)
    );
  }, []);

  const handleFlyTo = useCallback((lng: number, lat: number, zoom?: number) => {
    const z = zoom || 14;
    mapRef.current?.flyTo({ center: [lng, lat], zoom: z, duration: 1500 });
    // Auto-enable carriers layer when zooming to a specific point
    if (z >= 10) {
      setLayers((prev) =>
        prev.map((l) => l.id === "carriers" ? { ...l, visible: true } : l)
      );
    }
  }, []);

  return (
    <div className="app-layout">
      <div className="topbar">
        <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>&#9776;</button>
        <a href="/" className="topbar-brand">
          Carrier<span>Watch</span>
        </a>
        <a href="/principals" className="topbar-link">Officers</a>
        <a href="/cdl-schools" className="topbar-link">CDL Schools</a>
        <a href="/spotlight" className="topbar-link topbar-link-accent">Spotlight</a>
        <a href="/about" className="topbar-link">About</a>
        <a href="https://x.com/sigma2transport" target="_blank" rel="noopener" className="topbar-link">Follow Us</a>
        <SearchBar onFlyTo={handleFlyTo} />
        {stats && (
          <div className="stats-bar">
            <div className="stat-chip">
              <strong>{(stats.total_carriers).toLocaleString()}</strong> carriers
            </div>
            <div className="stat-chip">
              <strong>{(stats.flagged_clusters_5plus).toLocaleString()}</strong> flagged
            </div>
            {stats.high_risk_carriers > 0 && (
              <div className="stat-chip stat-chip-danger">
                <strong>{(stats.high_risk_carriers).toLocaleString()}</strong> high risk
              </div>
            )}
            {stats.carriers_with_ppp > 0 && (
              <div className="stat-chip stat-chip-warning">
                <strong>{(stats.carriers_with_ppp).toLocaleString()}</strong> PPP
              </div>
            )}
            <div className="stat-chip">
              <strong>{stats.states_covered}</strong> states
            </div>
          </div>
        )}
      </div>
      <div className="main-content">
        {sidebarOpen && <div className="sidebar-overlay visible" onClick={() => setSidebarOpen(false)} />}
        {!sidebarCollapsed && (
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onFlyTo={handleFlyTo} />
        )}
        <div className="map-container">
          <Map mapRef={mapRef} layers={layers} />
          <LayerToggle layers={layers} onToggle={handleLayerToggle} />
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Show leaderboards" : "Hide leaderboards"}
          >
            {sidebarCollapsed ? "\u25B6" : "\u25C0"}
          </button>
        </div>
      </div>
    </div>
  );
}
