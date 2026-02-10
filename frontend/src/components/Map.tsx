import { useEffect, useRef, MutableRefObject } from "react";
import mapboxgl from "mapbox-gl";
import type { MapLayer } from "../types";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const TILES_URL = import.meta.env.VITE_TILES_URL || "http://localhost:3001";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function showCarrierPopup(map: mapboxgl.Map, coords: [number, number], props: Record<string, unknown>) {
  const riskScore = (props.risk_score as number) || 0;
  const riskClass = riskScore >= 70 ? "risk-critical" : riskScore >= 50 ? "risk-high" : riskScore >= 30 ? "risk-medium" : riskScore >= 10 ? "risk-low" : "";

  // Status dot color
  const status = (props.operating_status as string) || "Unknown";
  const statusColor =
    status === "AUTHORIZED" ? "#22c55e" :
    status === "OUT-OF-SERVICE" ? "#ef4444" :
    status === "NOT AUTHORIZED" ? "#6b7084" : "#6b7084";

  // Risk score block — more prominent with colored background
  const riskHtml = riskScore > 0
    ? `<div style="display:flex;align-items:center;gap:6px;margin:4px 0;">
        <span class="risk-badge-sm ${riskClass}" style="font-size:13px;padding:2px 10px;">${riskScore}</span>
        <span style="font-size:11px;color:var(--text-secondary);">Risk Score</span>
      </div>`
    : "";

  // Crashes
  const crashes = props.total_crashes
    ? `<div class="popup-meta">Crashes: <strong>${props.total_crashes}</strong></div>`
    : "";

  // Safety rating
  const safetyRating = props.safety_rating
    ? `<div class="popup-meta">Safety Rating: ${props.safety_rating}</div>`
    : "";

  // Power units and drivers on one line
  const powerUnits = props.power_units || 0;
  const fleetHtml = `<div class="popup-meta">Fleet: <strong>${powerUnits}</strong> units</div>`;

  new mapboxgl.Popup({ offset: 8 })
    .setLngLat(coords)
    .setHTML(`
      <div class="popup-title">${props.legal_name}</div>
      <div class="popup-meta">DOT# ${props.dot_number}</div>
      <div class="popup-meta" style="display:flex;align-items:center;gap:5px;">
        <span style="color:${statusColor};font-size:10px;line-height:1;">&#9679;</span>
        <span>${status}</span>
      </div>
      ${fleetHtml}
      ${riskHtml}
      ${crashes}
      ${safetyRating}
      <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:8px;padding-top:6px;">
        <a class="popup-link" style="margin-top:0;" href="/carrier/${props.dot_number}">View details &rarr;</a>
      </div>
    `)
    .addTo(map);
}

interface MapProps {
  mapRef: MutableRefObject<mapboxgl.Map | null>;
  layers: MapLayer[];
}

export default function Map({ mapRef, layers }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    // Parse initial position from URL hash (format: #zoom/lat/lng)
    const hashParts = window.location.hash.replace("#", "").split("/").map(Number);
    const hashValid = hashParts.length === 3 && hashParts.every((n) => !isNaN(n));

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: hashValid ? [hashParts[2], hashParts[1]] : [-98.5, 39.8],
      zoom: hashValid ? hashParts[0] : 4,
      minZoom: 3,
      maxBounds: [
        [-180, 10],  // SW: includes Hawaii, Puerto Rico, territories
        [-50, 72],   // NE: includes Alaska
      ],
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      // County choropleth tiles
      map.addSource("counties-source", {
        type: "vector",
        tiles: [`${TILES_URL}/county_choropleth_mvt/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 10,
      });

      // Add Martin tile sources
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

      // County fill — colored by carrier count (default visible)
      map.addLayer({
        id: "county-fill-carriers",
        type: "fill",
        source: "counties-source",
        "source-layer": "counties",
        minzoom: 0,
        maxzoom: 9,
        layout: { visibility: "visible" },
        paint: {
          "fill-color": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            0, "rgba(0,0,0,0)",
            10, "#1a1a3e",
            50, "#1e3a5f",
            200, "#2563eb",
            1000, "#f59e0b",
            5000, "#ef4444",
            15000, "#dc2626",
          ],
          "fill-opacity": [
            "interpolate", ["linear"], ["zoom"],
            7, 0.7, 9, 0,
          ],
        },
      });

      // County fill — colored by avg risk score (default hidden)
      map.addLayer({
        id: "county-fill-risk",
        type: "fill",
        source: "counties-source",
        "source-layer": "counties",
        minzoom: 0,
        maxzoom: 9,
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "interpolate", ["linear"],
            ["get", "avg_risk_score"],
            0, "#1a1a2e",
            10, "#3b82f6",
            25, "#f59e0b",
            40, "#f97316",
            60, "#ef4444",
          ],
          "fill-opacity": [
            "interpolate", ["linear"], ["zoom"],
            7, 0.7, 9, 0,
          ],
        },
      });

      // County outlines
      map.addLayer({
        id: "county-outline",
        type: "line",
        source: "counties-source",
        "source-layer": "counties",
        minzoom: 0,
        maxzoom: 10,
        paint: {
          "line-color": "#333",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.3, 7, 0.8],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 10, 0],
        },
      });

      // County labels
      map.addLayer({
        id: "county-labels",
        type: "symbol",
        source: "counties-source",
        "source-layer": "counties",
        minzoom: 5,
        maxzoom: 9,
        layout: {
          "text-field": [
            "format",
            ["get", "county_name"], { "font-scale": 0.8 },
            "\n", {},
            ["to-string", ["get", "carrier_count"]], { "font-scale": 0.7 },
          ],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 5, 9, 8, 12],
          "text-max-width": 8,
          visibility: "visible",
        },
        paint: {
          "text-color": "#ccc",
          "text-halo-color": "rgba(0,0,0,0.8)",
          "text-halo-width": 1.5,
          "text-opacity": [
            "interpolate", ["linear"], ["zoom"],
            4.5, 0, 5, 1, 8, 1, 9, 0,
          ],
        },
      });

      // Heatmap layer (from clusters)
      map.addLayer({
        id: "heatmap",
        type: "heatmap",
        source: "clusters-source",
        "source-layer": "address_clusters",
        maxzoom: 12,
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            2, 0.3,
            10, 0.6,
            50, 1,
          ],
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            0, 1, 4, 1.5, 8, 2, 12, 3,
          ],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "rgba(59,130,246,0.4)",
            0.4, "rgba(34,197,94,0.6)",
            0.6, "rgba(245,158,11,0.8)",
            0.8, "rgba(249,115,22,0.9)",
            1, "rgba(239,68,68,1)",
          ],
          "heatmap-radius": [
            "interpolate", ["linear"], ["zoom"],
            0, 4, 3, 10, 6, 18, 12, 30,
          ],
        },
      });

      // Risk-colored carriers layer — renders below clusters
      map.addLayer({
        id: "risk",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 4,
        filter: [">", ["get", "risk_score"], 0],
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"],
            ["get", "risk_score"],
            10, 3,
            30, 5,
            50, 7,
            70, 9,
          ],
          "circle-color": [
            "interpolate", ["linear"],
            ["get", "risk_score"],
            10, "#3b82f6",
            30, "#f59e0b",
            50, "#f97316",
            70, "#ef4444",
          ],
          "circle-opacity": 0.7,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.2)",
        },
      });

      // Individual carriers layer — renders below clusters
      map.addLayer({
        id: "carriers",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 7,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 3,
          "circle-color": [
            "match",
            ["get", "operating_status"],
            "AUTHORIZED", "#22c55e",
            "NOT AUTHORIZED", "#6b7084",
            "OUT-OF-SERVICE", "#ef4444",
            "#3b82f6",
          ],
          "circle-opacity": 0.7,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.2)",
        },
      });

      // Cluster circles layer — renders on top of risk/carriers
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "clusters-source",
        "source-layer": "address_clusters",
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            2, 4,
            5, 6,
            10, 10,
            25, 16,
            50, 22,
            100, 30,
          ],
          "circle-color": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            2, "#22c55e",
            5, "#f59e0b",
            10, "#f97316",
            25, "#ef4444",
            50, "#dc2626",
          ],
          "circle-opacity": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            2, 0.6,
            10, 0.8,
            25, 0.95,
          ],
          "circle-stroke-width": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            2, 0.5,
            25, 2,
          ],
          "circle-stroke-color": "rgba(255,255,255,0.3)",
        },
      });

      // Cluster labels — only show at zoom 6+ to reduce clutter
      map.addLayer({
        id: "clusters-labels",
        type: "symbol",
        source: "clusters-source",
        "source-layer": "address_clusters",
        minzoom: 6,
        layout: {
          visibility: "visible",
          "text-field": ["to-string", ["get", "carrier_count"]],
          "text-size": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            2, 10,
            25, 13,
            100, 16,
          ],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // CDL Schools layer — on top of everything
      map.addLayer({
        id: "cdl-schools",
        type: "circle",
        source: "cdl-schools-source",
        "source-layer": "cdl_schools",
        minzoom: 6,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            6, 3, 8, 5, 12, 7,
          ],
          "circle-color": "#10b981",
          "circle-opacity": [
            "interpolate", ["linear"], ["zoom"],
            6, 0.6, 10, 0.9,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });

      // CDL Schools click → popup
      map.on("click", "cdl-schools", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const props = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-meta" style="font-size:10px;color:var(--success);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">CDL Training School</div>
            <div class="popup-title">${props.provider_name}</div>
            <div class="popup-meta">${props.city || ""}, ${props.state || ""}</div>
            ${props.phone ? `<div class="popup-meta">Phone: ${props.phone}</div>` : ""}
            <div class="popup-meta">Status: ${props.status || "active"}</div>
          `)
          .addTo(map);
      });

      // Cluster click → popup
      map.on("click", "clusters", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const props = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

        const countClass =
          props.carrier_count >= 25 ? "count-critical" :
          props.carrier_count >= 10 ? "count-high" :
          props.carrier_count >= 5 ? "count-medium" : "count-low";

        new mapboxgl.Popup({ offset: 12 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-title">${props.address || "Unknown Address"}</div>
            <div class="popup-meta">${props.city || ""}, ${props.state || ""} ${props.zip || ""}</div>
            <div class="popup-meta">
              Carriers: <span class="leaderboard-count ${countClass}">${props.carrier_count}</span>
            </div>
            <div class="popup-meta">Crashes: ${props.total_crashes || 0}</div>
            <a class="popup-link" href="/address/${props.address_hash}">View all carriers →</a>
          `)
          .addTo(map);
      });

      // Carrier click → popup with officers
      map.on("click", "carriers", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        showCarrierPopup(map, coords, f.properties!);
      });

      // Risk layer click → same popup with officers
      map.on("click", "risk", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        showCarrierPopup(map, coords, f.properties!);
      });

      // County click → zoom to county bounds
      const handleCountyClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.GeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const feature = e.features[0];
        const geom = feature.geometry;
        if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
          const coords = geom.type === "Polygon"
            ? geom.coordinates.flat()
            : geom.coordinates.flat(2);
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          for (const [lng, lat] of coords) {
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;
          }
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 11 });
        }
      };
      map.on("click", "county-fill-carriers", handleCountyClick);
      map.on("click", "county-fill-risk", handleCountyClick);

      // County hover → tooltip
      let countyPopup: mapboxgl.Popup | null = null;
      const handleCountyHover = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.GeoJSONFeature[] }) => {
        map.getCanvas().style.cursor = "pointer";
        if (!e.features?.length) return;
        const p = e.features[0].properties!;
        if (countyPopup) countyPopup.remove();
        countyPopup = new mapboxgl.Popup({ offset: 8, closeButton: false, closeOnClick: false })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div class="popup-title">${p.county_name}, ${p.state_abbr}</div>
            <div class="popup-meta">Carriers: <strong>${Number(p.carrier_count).toLocaleString()}</strong></div>
            <div class="popup-meta">High Risk: <strong style="color:#ef4444;">${Number(p.high_risk_count).toLocaleString()}</strong></div>
            <div class="popup-meta">Avg Risk: ${p.avg_risk_score}</div>
            <div class="popup-meta">Fatal Crashes: ${p.fatal_crashes}</div>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">Click to zoom in</div>
          `)
          .addTo(map);
      };
      const handleCountyLeave = () => {
        map.getCanvas().style.cursor = "";
        if (countyPopup) { countyPopup.remove(); countyPopup = null; }
      };
      map.on("mousemove", "county-fill-carriers", handleCountyHover);
      map.on("mousemove", "county-fill-risk", handleCountyHover);
      map.on("mouseleave", "county-fill-carriers", handleCountyLeave);
      map.on("mouseleave", "county-fill-risk", handleCountyLeave);

      // Cursor changes
      for (const layerId of ["clusters", "carriers", "risk", "cdl-schools"]) {
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      }
    });

    mapRef.current = map;

    // Sync map position to URL hash for shareable links
    let hashTimer: number;
    map.on("moveend", () => {
      clearTimeout(hashTimer);
      hashTimer = window.setTimeout(() => {
        const c = map.getCenter();
        const z = Math.round(map.getZoom() * 10) / 10;
        window.history.replaceState(null, "", `#${z}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`);
      }, 300);
    });

    // Fix: Mapbox needs a resize after the container layout settles,
    // otherwise the map only renders in part of the container on first load.
    const resizeTimer = window.setTimeout(() => map.resize(), 100);

    // Also watch for container size changes (sidebar open/close, window resize)
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      map.remove();
      initialized.current = false;
    };
  }, [mapRef]);

  // Sync layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncVisibility = () => {
      for (const layer of layers) {
        const vis = layer.visible ? "visible" : "none";
        if (map.getLayer(layer.id)) {
          map.setLayoutProperty(layer.id, "visibility", vis);
        }
        // Sync cluster labels with clusters layer
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
