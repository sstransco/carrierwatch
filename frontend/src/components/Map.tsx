import { useEffect, useRef, MutableRefObject } from "react";
import mapboxgl from "mapbox-gl";
import type { MapLayer } from "../types";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const TILES_URL = import.meta.env.VITE_TILES_URL || "http://localhost:3001";

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

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-98.5, 39.8],
      zoom: 4,
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
            2, 0.1,
            10, 0.5,
            50, 1,
          ],
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            0, 0.5, 12, 2,
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
            0, 8, 12, 30,
          ],
        },
      });

      // Cluster circles layer
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
            2, 5,
            10, 10,
            50, 18,
            200, 28,
          ],
          "circle-color": [
            "interpolate", ["linear"],
            ["get", "carrier_count"],
            2, "#22c55e",
            5, "#f59e0b",
            10, "#f97316",
            25, "#ef4444",
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.3)",
        },
      });

      // Cluster labels
      map.addLayer({
        id: "clusters-labels",
        type: "symbol",
        source: "clusters-source",
        "source-layer": "address_clusters",
        layout: {
          visibility: "visible",
          "text-field": ["to-string", ["get", "carrier_count"]],
          "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // Individual carriers layer
      map.addLayer({
        id: "carriers",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 8,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 4,
          "circle-color": [
            "match",
            ["get", "operating_status"],
            "AUTHORIZED", "#22c55e",
            "NOT AUTHORIZED", "#6b7084",
            "OUT-OF-SERVICE", "#ef4444",
            "#3b82f6",
          ],
          "circle-opacity": 0.8,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "rgba(255,255,255,0.2)",
        },
      });

      // Risk-colored carriers layer
      map.addLayer({
        id: "risk",
        type: "circle",
        source: "carriers-source",
        "source-layer": "carriers",
        minzoom: 4,
        filter: [">", ["get", "risk_score"], 0],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"],
            ["get", "risk_score"],
            10, 4,
            30, 6,
            50, 8,
            70, 11,
          ],
          "circle-color": [
            "interpolate", ["linear"],
            ["get", "risk_score"],
            10, "#3b82f6",
            30, "#f59e0b",
            50, "#f97316",
            70, "#ef4444",
          ],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.3)",
        },
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

      // Carrier click → popup
      map.on("click", "carriers", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const props = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

        const riskScore = props.risk_score || 0;
        const riskClass = riskScore >= 70 ? "risk-critical" : riskScore >= 50 ? "risk-high" : riskScore >= 30 ? "risk-medium" : riskScore >= 10 ? "risk-low" : "";
        const riskHtml = riskScore > 0
          ? `<div class="popup-meta">Risk: <span class="risk-badge-sm ${riskClass}">${riskScore}</span></div>`
          : "";

        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-title">${props.legal_name}</div>
            <div class="popup-meta">DOT# ${props.dot_number}</div>
            <div class="popup-meta">Status: ${props.operating_status || "Unknown"}</div>
            <div class="popup-meta">Fleet: ${props.power_units || 0} units</div>
            ${riskHtml}
            <a class="popup-link" href="/carrier/${props.dot_number}">View details &rarr;</a>
          `)
          .addTo(map);
      });

      // Risk layer click → same popup as carriers
      map.on("click", "risk", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const props = f.properties!;
        const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

        const riskScore = props.risk_score || 0;
        const riskClass = riskScore >= 70 ? "risk-critical" : riskScore >= 50 ? "risk-high" : riskScore >= 30 ? "risk-medium" : "risk-low";

        new mapboxgl.Popup({ offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div class="popup-title">${props.legal_name}</div>
            <div class="popup-meta">DOT# ${props.dot_number}</div>
            <div class="popup-meta">Status: ${props.operating_status || "Unknown"}</div>
            <div class="popup-meta">Risk: <span class="risk-badge-sm ${riskClass}">${riskScore}</span></div>
            <div class="popup-meta">Crashes: ${props.total_crashes || 0}</div>
            <a class="popup-link" href="/carrier/${props.dot_number}">View details &rarr;</a>
          `)
          .addTo(map);
      });

      // Cursor changes
      for (const layerId of ["clusters", "carriers", "risk"]) {
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      initialized.current = false;
    };
  }, [mapRef]);

  // Sync layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

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
  }, [layers, mapRef]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
