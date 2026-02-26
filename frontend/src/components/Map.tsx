import { useEffect, useRef, MutableRefObject } from "react";
import mapboxgl from "mapbox-gl";
import type { MapLayer } from "../types";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
// Must be absolute URL — web workers reject relative URLs in Request constructor
const TILES_URL = (() => {
  const env = import.meta.env.VITE_TILES_URL as string | undefined;
  if (env && env.startsWith("http")) return env;
  return `${window.location.origin}${env || "/tiles"}`;
})();

interface MapProps {
  mapRef: MutableRefObject<mapboxgl.Map | null>;
  layers: MapLayer[];
  activeOnly?: boolean;
  originFilter?: string;
}

export default function Map({ mapRef, layers, activeOnly, originFilter }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const hashParts = window.location.hash.replace("#", "").split("/").map(Number);
    const hashValid = hashParts.length === 3 && hashParts.every((n) => !isNaN(n));

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: hashValid ? [hashParts[2], hashParts[1]] : [-98.5, 39.8],
      zoom: hashValid ? hashParts[0] : 4,
      minZoom: 3,
      maxBounds: [[-180, 10], [-50, 72]],
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      // ==== SOURCES ====
      map.addSource("clusters-source", {
        type: "vector",
        tiles: [`${TILES_URL}/address_clusters_mvt/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 14,
      });

      map.addSource("carriers-source", {
        type: "vector",
        tiles: [`${TILES_URL}/carriers_mvt/{z}/{x}/{y}`],
        minzoom: 4,
        maxzoom: 16,
      });

      map.addSource("cdl-schools-source", {
        type: "vector",
        tiles: [`${TILES_URL}/cdl_schools_mvt/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 16,
      });

      // ==== LAYERS ====

      // Heatmap (hidden by default)
      map.addLayer({
        id: "heatmap",
        type: "heatmap",
        source: "clusters-source",
        "source-layer": "address_clusters",
        maxzoom: 12,
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "carrier_count"], 2, 0.3, 10, 0.6, 50, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 1.5, 8, 2, 12, 3],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "rgba(59,130,246,0.4)",
            0.4, "rgba(34,197,94,0.6)",
            0.6, "rgba(245,158,11,0.8)",
            0.8, "rgba(249,115,22,0.9)",
            1, "rgba(239,68,68,1)",
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 3, 10, 6, 18, 12, 30],
        },
      });

      // Risk overlay — colored carrier dots by risk score
      map.addLayer({
        id: "risk",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 5,
        filter: [">", ["get", "risk_score"], 0],
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2, 7, 3, 10, 5, 13, 7],
          "circle-color": ["interpolate", ["linear"], ["get", "risk_score"], 10, "#3b82f6", 30, "#f59e0b", 50, "#f97316", 70, "#ef4444"],
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 8, 0.7],
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.2)",
        },
      });

      // Individual carriers (visible by default)
      map.addLayer({
        id: "carriers",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 5,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.5, 7, 2, 10, 3, 13, 4],
          "circle-color": [
            "match", ["get", "operating_status"],
            "AUTHORIZED", "#22c55e",
            "NOT AUTHORIZED", "#6b7084",
            "OUT-OF-SERVICE", "#ef4444",
            "#3b82f6",
          ],
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 8, 0.7],
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.2)",
        },
      });

      // Address cluster circles
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "clusters-source",
        "source-layer": "address_clusters",
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "carrier_count"], 2, 4, 5, 6, 10, 10, 25, 16, 50, 22, 100, 30],
          "circle-color": ["interpolate", ["linear"], ["get", "carrier_count"], 2, "#22c55e", 5, "#f59e0b", 10, "#f97316", 25, "#ef4444", 50, "#dc2626"],
          "circle-opacity": ["interpolate", ["linear"], ["get", "carrier_count"], 2, 0.6, 10, 0.8, 25, 0.95],
          "circle-stroke-width": ["interpolate", ["linear"], ["get", "carrier_count"], 2, 0.5, 25, 2],
          "circle-stroke-color": "rgba(255,255,255,0.3)",
        },
      });

      // Cluster count labels
      map.addLayer({
        id: "clusters-labels",
        type: "symbol",
        source: "clusters-source",
        "source-layer": "address_clusters",
        minzoom: 6,
        layout: {
          visibility: "visible",
          "text-field": ["to-string", ["get", "carrier_count"]],
          "text-size": ["interpolate", ["linear"], ["get", "carrier_count"], 2, 10, 25, 13, 100, 16],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });

      // CDL Schools
      map.addLayer({
        id: "cdl-schools",
        type: "circle",
        source: "cdl-schools-source",
        "source-layer": "cdl_schools",
        minzoom: 6,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 8, 5, 12, 7],
          "circle-color": "#10b981",
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 0.9],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });

      // Foreign carriers (filtered from same source — rose/red dots)
      map.addLayer({
        id: "foreign-carriers",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 4,
        filter: ["all", ["has", "physical_country"], ["!=", ["get", "physical_country"], "US"]],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 7, 3.5, 10, 5, 13, 7],
          "circle-color": "#e11d48",
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 0.85],
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.3)",
        },
      });

      // Demographics overlay — carriers colored by dominant officer surname origin
      map.addLayer({
        id: "demographics",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 4,
        filter: ["has", "dominant_origin"],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 7, 3, 10, 5, 13, 7],
          "circle-color": [
            "match", ["get", "dominant_origin"],
            "JP", "#ff6b6b",   // Japanese — red
            "KR", "#ee5a24",   // Korean — dark orange
            "CN", "#f9ca24",   // Chinese — gold
            "VN", "#6ab04c",   // Vietnamese — green
            "IN", "#e056fd",   // Indian — magenta
            "PH", "#22a6b3",   // Filipino — teal
            "GR", "#7ed6df",   // Greek — light cyan
            "PL", "#dfe6e9",   // Polish — light gray
            "AM", "#fd79a8",   // Armenian — pink
            "GE", "#a29bfe",   // Georgian — lavender
            "FI", "#74b9ff",   // Finnish — light blue
            "IT", "#00b894",   // Italian — emerald
            "RU", "#0984e3",   // Russian — blue
            "PT", "#fdcb6e",   // Portuguese — amber
            "NL", "#ff7675",   // Dutch — coral
            "TR", "#d63031",   // Turkish — crimson
            "DE", "#b2bec3",   // German — silver
            "IE", "#55efc4",   // Irish — mint
            "HU", "#ffeaa7",   // Hungarian — cream
            "UA", "#81ecec",   // Ukrainian — aqua
            "NG", "#e17055",   // Nigerian — burnt orange
            "ET", "#fab1a0",   // Ethiopian — salmon
            "AR", "#636e72",   // Arabic — dark gray
            "ES", "#ff9f43",   // Latino — orange
            "GB", "#dfe6e9",   // Anglo — light
            // Fallback groups
            "EA", "#f6e58d",   // East Asian
            "XS", "#badc58",   // Southeast Asian
            "XA", "#c7ecee",   // South Asian
            "LA", "#ffbe76",   // Latino fallback
            "XB", "#95afc0",   // Anglo fallback
            "XL", "#a4b0be",   // Slavic
            "XN", "#778ca3",   // Scandinavian
            "EU", "#d1d8e0",   // European
            "ME", "#8e8e8e",   // Middle Eastern
            "XF", "#cf6a87",   // African
            "#555",            // default
          ],
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 0.85],
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.15)",
        },
      });

      // ==== CLICK HANDLERS ====

      // CDL Schools popup
      map.on("click", "cdl-schools", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const p = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-meta" style="font-size:10px;color:var(--success);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">CDL Training School</div>
            <div class="popup-title">${p.provider_name}</div>
            <div class="popup-meta">${p.city || ""}, ${p.state || ""}</div>
            ${p.phone ? `<div class="popup-meta">Phone: ${p.phone}</div>` : ""}
            <div class="popup-meta">Status: ${p.status || "active"}</div>
          `)
          .addTo(map);
      });

      // Cluster popup
      map.on("click", "clusters", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const p = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        const countClass =
          p.carrier_count >= 25 ? "count-critical" :
          p.carrier_count >= 10 ? "count-high" :
          p.carrier_count >= 5 ? "count-medium" : "count-low";
        new mapboxgl.Popup({ offset: 12 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-title">${p.address || "Unknown Address"}</div>
            <div class="popup-meta">${p.city || ""}, ${p.state || ""} ${p.zip || ""}</div>
            <div class="popup-meta">Carriers: <span class="leaderboard-count ${countClass}">${p.carrier_count}</span></div>
            <div class="popup-meta">Crashes: ${p.total_crashes || 0}</div>
            <a class="popup-link" href="/address/${encodeURIComponent(p.address_hash)}">View all carriers &rarr;</a>
          `)
          .addTo(map);
      });

      // Carrier / risk click → popup
      function onCarrierOrRiskClick(e: mapboxgl.MapLayerMouseEvent) {
        if (!e.features?.length) return;
        const p = e.features[0].properties!;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        const riskScore = Number(p.risk_score) || 0;
        const riskClass = riskScore >= 70 ? "risk-critical" : riskScore >= 50 ? "risk-high" : riskScore >= 30 ? "risk-medium" : riskScore >= 10 ? "risk-low" : "";
        const status = String(p.operating_status || "Unknown");
        const statusColor = status === "AUTHORIZED" ? "#22c55e" : status === "OUT-OF-SERVICE" ? "#ef4444" : "#6b7084";

        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-title">${p.legal_name}</div>
            <div class="popup-meta">DOT# ${p.dot_number}</div>
            <div class="popup-meta" style="display:flex;align-items:center;gap:5px;">
              <span style="color:${statusColor};font-size:10px;">&#9679;</span>
              <span>${status}</span>
            </div>
            <div class="popup-meta">Fleet: <strong>${p.power_units || 0}</strong> units</div>
            ${riskScore > 0 ? `<div class="popup-meta">Risk: <span class="risk-badge-sm ${riskClass}" style="font-size:13px;padding:2px 10px;">${riskScore}</span></div>` : ""}
            ${p.total_crashes ? `<div class="popup-meta">Crashes: ${p.total_crashes}</div>` : ""}
            ${p.safety_rating ? `<div class="popup-meta">Safety: ${p.safety_rating}</div>` : ""}
            <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:8px;padding-top:6px;">
              <a class="popup-link" style="margin-top:0;" href="/carrier/${encodeURIComponent(p.dot_number)}">View details &rarr;</a>
            </div>
          `)
          .addTo(map);
      }

      map.on("click", "carriers", onCarrierOrRiskClick);
      map.on("click", "risk", onCarrierOrRiskClick);

      // Foreign carrier click
      map.on("click", "foreign-carriers", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties!;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        const riskScore = Number(p.risk_score) || 0;
        const riskClass = riskScore >= 70 ? "risk-critical" : riskScore >= 50 ? "risk-high" : riskScore >= 30 ? "risk-medium" : riskScore >= 10 ? "risk-low" : "";
        const country = p.physical_country || "??";

        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-meta" style="font-size:10px;color:#e11d48;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Foreign Carrier (${country})</div>
            <div class="popup-title">${p.legal_name}</div>
            <div class="popup-meta">DOT# ${p.dot_number}</div>
            <div class="popup-meta">Fleet: <strong>${p.power_units || 0}</strong> units</div>
            ${riskScore > 0 ? `<div class="popup-meta">Risk: <span class="risk-badge-sm ${riskClass}" style="font-size:13px;padding:2px 10px;">${riskScore}</span></div>` : ""}
            ${p.total_crashes ? `<div class="popup-meta">Crashes: ${p.total_crashes}</div>` : ""}
            <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:8px;padding-top:6px;">
              <a class="popup-link" style="margin-top:0;" href="/carrier/${encodeURIComponent(p.dot_number)}">View details &rarr;</a>
            </div>
          `)
          .addTo(map);
      });

      // Demographics layer click
      map.on("click", "demographics", (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties!;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        const riskScore = Number(p.risk_score) || 0;
        const riskClass = riskScore >= 70 ? "risk-critical" : riskScore >= 50 ? "risk-high" : riskScore >= 30 ? "risk-medium" : riskScore >= 10 ? "risk-low" : "";
        const origin = p.dominant_origin || "??";
        const status = String(p.operating_status || "Unknown");
        const statusColor = status === "AUTHORIZED" ? "#22c55e" : status === "OUT-OF-SERVICE" ? "#ef4444" : "#6b7084";

        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-meta" style="font-size:10px;color:#e056fd;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Origin: ${origin}</div>
            <div class="popup-title">${p.legal_name}</div>
            <div class="popup-meta">DOT# ${p.dot_number}</div>
            <div class="popup-meta" style="display:flex;align-items:center;gap:5px;">
              <span style="color:${statusColor};font-size:10px;">&#9679;</span>
              <span>${status}</span>
            </div>
            <div class="popup-meta">Fleet: <strong>${p.power_units || 0}</strong> units</div>
            ${riskScore > 0 ? `<div class="popup-meta">Risk: <span class="risk-badge-sm ${riskClass}" style="font-size:13px;padding:2px 10px;">${riskScore}</span></div>` : ""}
            <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:8px;padding-top:6px;">
              <a class="popup-link" style="margin-top:0;" href="/carrier/${encodeURIComponent(p.dot_number)}">View details &rarr;</a>
            </div>
          `)
          .addTo(map);
      });

      // Cursor changes
      for (const layerId of ["clusters", "carriers", "risk", "cdl-schools", "foreign-carriers", "demographics"]) {
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      }
    });

    map.on("error", (e) => {
      console.error("[CarrierWatch] Map error:", e.error);
    });

    mapRef.current = map;

    // URL hash sync
    let hashTimer: number;
    map.on("moveend", () => {
      clearTimeout(hashTimer);
      hashTimer = window.setTimeout(() => {
        const c = map.getCenter();
        const z = Math.round(map.getZoom() * 10) / 10;
        window.history.replaceState(null, "", `#${z}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`);
      }, 300);
    });

    // Resize fix
    const resizeTimer = window.setTimeout(() => map.resize(), 100);
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      map.remove();
      initialized.current = false;
    };
  }, [mapRef]);

  // Sync layer visibility from props
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncVisibility = () => {
      for (const layer of layers) {
        const vis = layer.visible ? "visible" : "none";
        if (map.getLayer(layer.id)) {
          map.setLayoutProperty(layer.id, "visibility", vis);
        }
        if (layer.id === "clusters" && map.getLayer("clusters-labels")) {
          map.setLayoutProperty("clusters-labels", "visibility", vis);
        }
      }
    };

    if (map.isStyleLoaded()) {
      syncVisibility();
    } else {
      map.once("idle", syncVisibility);
      return () => { map.off("idle", syncVisibility); };
    }
  }, [layers, mapRef]);

  // Sync activeOnly filter to map layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyFilter = () => {
      if (activeOnly) {
        // Filter individual carriers to AUTHORIZED only
        if (map.getLayer("carriers")) {
          map.setFilter("carriers", ["in", ["get", "operating_status"], ["literal", ["AUTHORIZED", "AUTHORIZED FOR HIRE"]]]);
        }
        // Filter risk overlay to AUTHORIZED only (keep risk_score > 0)
        if (map.getLayer("risk")) {
          map.setFilter("risk", ["all",
            [">", ["get", "risk_score"], 0],
            ["in", ["get", "operating_status"], ["literal", ["AUTHORIZED", "AUTHORIZED FOR HIRE"]]],
          ]);
        }
        // Filter clusters to those with active carriers
        if (map.getLayer("clusters")) {
          map.setFilter("clusters", [">", ["get", "active_count"], 0]);
        }
        if (map.getLayer("clusters-labels")) {
          map.setFilter("clusters-labels", [">", ["get", "active_count"], 0]);
        }
      } else {
        // Clear all filters (restore defaults)
        if (map.getLayer("carriers")) map.setFilter("carriers", null);
        if (map.getLayer("risk")) map.setFilter("risk", [">", ["get", "risk_score"], 0]);
        if (map.getLayer("clusters")) map.setFilter("clusters", null);
        if (map.getLayer("clusters-labels")) map.setFilter("clusters-labels", null);
      }
    };

    if (map.isStyleLoaded()) {
      applyFilter();
    } else {
      map.once("idle", applyFilter);
      return () => { map.off("idle", applyFilter); };
    }
  }, [activeOnly, mapRef]);

  // Sync demographics origin filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyOriginFilter = () => {
      if (!map.getLayer("demographics")) return;
      if (originFilter) {
        map.setFilter("demographics", ["==", ["get", "dominant_origin"], originFilter]);
      } else {
        map.setFilter("demographics", ["has", "dominant_origin"]);
      }
    };

    if (map.isStyleLoaded()) {
      applyOriginFilter();
    } else {
      map.once("idle", applyOriginFilter);
      return () => { map.off("idle", applyOriginFilter); };
    }
  }, [originFilter, mapRef]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
