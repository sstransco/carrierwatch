import type { MapLayer } from "../types";

const ORIGIN_OPTIONS = [
  { code: "", label: "All Origins" },
  { code: "JP", label: "Japanese" },
  { code: "KR", label: "Korean" },
  { code: "CN", label: "Chinese" },
  { code: "VN", label: "Vietnamese" },
  { code: "PH", label: "Filipino" },
  { code: "IN", label: "Indian" },
  { code: "GR", label: "Greek" },
  { code: "IT", label: "Italian" },
  { code: "DE", label: "German" },
  { code: "PL", label: "Polish" },
  { code: "RU", label: "Russian" },
  { code: "UA", label: "Ukrainian" },
  { code: "AM", label: "Armenian" },
  { code: "TR", label: "Turkish" },
  { code: "AR", label: "Arabic" },
  { code: "ES", label: "Spanish" },
  { code: "PT", label: "Portuguese" },
  { code: "IE", label: "Irish" },
  { code: "GB", label: "British" },
  { code: "NG", label: "Nigerian" },
  { code: "ET", label: "Ethiopian" },
  { code: "EA", label: "East Asian (other)" },
  { code: "XS", label: "South Asian (other)" },
  { code: "LA", label: "Latino (other)" },
  { code: "XB", label: "Anglo (other)" },
  { code: "EU", label: "European (other)" },
  { code: "ME", label: "Middle Eastern (other)" },
  { code: "XF", label: "African (other)" },
];

interface LayerToggleProps {
  layers: MapLayer[];
  onToggle: (layerId: string) => void;
  activeOnly: boolean;
  onActiveOnlyChange: (v: boolean) => void;
  originFilter: string;
  onOriginFilterChange: (v: string) => void;
}

export default function LayerToggle({ layers, onToggle, activeOnly, onActiveOnlyChange, originFilter, onOriginFilterChange }: LayerToggleProps) {
  const demographicsOn = layers.find(l => l.id === "demographics")?.visible;

  return (
    <div className="layer-toggle">
      <h4>Layers</h4>
      {layers.map((layer) => (
        <label key={layer.id}>
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={() => onToggle(layer.id)}
          />
          {layer.label}
        </label>
      ))}
      {demographicsOn && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0", paddingTop: 6 }}>
          <label style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginBottom: 4, display: "block" }}>
            Filter by origin:
          </label>
          <select
            value={originFilter}
            onChange={(e) => onOriginFilterChange(e.target.value)}
            style={{
              width: "100%",
              padding: "4px 6px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              color: "#fff",
              fontSize: 12,
            }}
          >
            {ORIGIN_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0", paddingTop: 6 }}>
        <label>
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => onActiveOnlyChange(e.target.checked)}
          />
          Active Only
        </label>
      </div>
    </div>
  );
}
