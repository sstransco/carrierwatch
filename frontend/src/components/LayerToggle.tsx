import type { MapLayer } from "../types";

interface LayerToggleProps {
  layers: MapLayer[];
  onToggle: (layerId: string) => void;
}

export default function LayerToggle({ layers, onToggle }: LayerToggleProps) {
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
    </div>
  );
}
