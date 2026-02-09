import { useCallback, useEffect, useRef, useState } from "react";
import Map from "./components/Map";
import SearchBar from "./components/SearchBar";
import Sidebar from "./components/Sidebar";
import LayerToggle from "./components/LayerToggle";
import type { MapLayer, StatsResponse } from "./types";
import type mapboxgl from "mapbox-gl";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const DEFAULT_LAYERS: MapLayer[] = [
  { id: "clusters", label: "Address Clusters", visible: true },
  { id: "carriers", label: "Individual Carriers", visible: false },
  { id: "risk", label: "Risk Overlay", visible: false },
  { id: "heatmap", label: "Heatmap", visible: false },
];

export default function App() {
  const [layers, setLayers] = useState<MapLayer[]>(DEFAULT_LAYERS);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  const handleLayerToggle = useCallback((layerId: string) => {
    setLayers((prev) => {
      const target = prev.find((l) => l.id === layerId);
      if (!target) return prev;
      // If turning on, turn off all others (radio-style)
      if (!target.visible) {
        return prev.map((l) => ({ ...l, visible: l.id === layerId }));
      }
      // If turning off, just turn it off
      return prev.map((l) => (l.id === layerId ? { ...l, visible: false } : l));
    });
  }, []);

  const handleFlyTo = useCallback((lng: number, lat: number, zoom?: number) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom: zoom || 14, duration: 1500 });
  }, []);

  return (
    <div className="app-layout">
      <div className="topbar">
        <a href="/" className="topbar-brand">
          Carrier<span>Watch</span>
        </a>
        <a href="/about" className="topbar-link">About</a>
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
        <Sidebar onFlyTo={handleFlyTo} />
        <div className="map-container">
          <Map mapRef={mapRef} layers={layers} />
          <LayerToggle layers={layers} onToggle={handleLayerToggle} />
        </div>
      </div>
    </div>
  );
}
