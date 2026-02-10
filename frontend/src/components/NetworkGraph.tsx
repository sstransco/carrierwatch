import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || "";

interface GraphNode {
  id: string;
  type: "officer" | "carrier";
  label: string;
  carrier_count?: number;
  dot_number?: number;
  risk_score?: number;
  power_units?: number;
  total_crashes?: number;
  fatal_crashes?: number;
  operating_status?: string;
  state?: string;
  // Physics
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface GraphEdge {
  source: string;
  target: string;
  position?: string;
  email?: string;
}

interface NetworkData {
  nodes: Omit<GraphNode, "x" | "y" | "vx" | "vy" | "radius">[];
  edges: GraphEdge[];
  stats: {
    carrier_count: number;
    officer_count: number;
    total_crashes: number;
    total_fatal: number;
    total_power_units: number;
  };
}

interface ClusterInfo {
  cluster_index: number;
  carrier_count: number;
  link_signals: string[];
  total_crashes: number;
  fatal_crashes: number;
  total_units: number;
  avg_risk_score: number;
  states: string[];
}

type LayoutMode = "force" | "hierarchical";

function riskColor(score: number): string {
  if (score >= 70) return "#ef4444";
  if (score >= 50) return "#f97316";
  if (score >= 30) return "#f59e0b";
  if (score > 0) return "#3b82f6";
  return "#6b7084";
}

function officerColor(carrierCount: number): string {
  if (carrierCount >= 100) return "#ef4444";
  if (carrierCount >= 25) return "#f97316";
  if (carrierCount >= 10) return "#f59e0b";
  return "#3b82f6";
}

function strengthLabel(count: number): { label: string; color: string } {
  if (count >= 25) return { label: "Strong", color: "#22c55e" };
  if (count >= 10) return { label: "Medium", color: "#3b82f6" };
  return { label: "Weak", color: "#f59e0b" };
}

function nodeRadius(node: GraphNode): number {
  if (node.type === "officer") {
    return Math.min(8 + Math.sqrt(node.carrier_count || 1) * 2, 30);
  }
  const crashes = node.total_crashes || 0;
  return Math.max(4, Math.min(4 + Math.sqrt(crashes), 16));
}

export default function NetworkGraphPage() {
  const { officerName } = useParams<{ officerName: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState(officerName || "");
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [depthVal, setDepthVal] = useState(parseInt(searchParams.get("depth") || "1"));
  const [maxVal, setMaxVal] = useState(parseInt(searchParams.get("max") || "80"));
  const [minConnections, setMinConnections] = useState(1);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const panRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ node: GraphNode | null; startX: number; startY: number; panning: boolean }>({
    node: null, startX: 0, startY: 0, panning: false,
  });

  const depth = depthVal;
  const maxCarriers = maxVal;

  const fetchNetwork = useCallback((name: string, cluster?: number | null) => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    let url = `${API_URL}/api/network/officer/${encodeURIComponent(name.trim())}?depth=${depth}&max_carriers=${maxCarriers}`;
    if (cluster != null) url += `&cluster=${cluster}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: NetworkData) => {
        setData(d);
        setLoading(false);
        initGraph(d, layoutMode);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [depth, maxCarriers, layoutMode]);

  // Fetch clusters when officer name changes
  useEffect(() => {
    if (!officerName) return;
    fetch(`${API_URL}/api/network/officer/${encodeURIComponent(officerName.trim())}/clusters`)
      .then((r) => r.ok ? r.json() : [])
      .then((c: ClusterInfo[]) => {
        setClusters(c);
        // Auto-select largest confirmed cluster if multiple exist
        const confirmed = c.filter(
          (cl) => cl.carrier_count >= 2 && !(cl.link_signals.length === 1 && cl.link_signals[0] === "name_only")
        );
        if (confirmed.length >= 1 && c.length > 1) {
          const best = confirmed[0]; // already sorted by carrier_count DESC
          setSelectedCluster(best.cluster_index);
          fetchNetwork(officerName, best.cluster_index);
        } else {
          setSelectedCluster(null);
          fetchNetwork(officerName, null);
        }
      })
      .catch(() => {
        setClusters([]);
        setSelectedCluster(null);
        fetchNetwork(officerName, null);
      });
    setSearchQuery(officerName);
  }, [officerName, fetchNetwork]);

  // Re-layout when mode changes
  useEffect(() => {
    if (data) initGraph(data, layoutMode);
  }, [layoutMode]);

  const initGraph = useCallback((d: NetworkData, layout: LayoutMode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const cx = W / 2;
    const cy = H / 2;

    let nodes: GraphNode[];

    if (layout === "hierarchical") {
      nodes = layoutHierarchical(d, W, H, officerName || "");
    } else {
      // Force-directed: initialize in a circle
      nodes = d.nodes.map((n, i) => {
        const angle = (i / d.nodes.length) * Math.PI * 2;
        const r = n.type === "officer" ? 50 : 150 + Math.random() * 200;
        return {
          ...n,
          x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 40,
          y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 40,
          vx: 0,
          vy: 0,
          radius: 0,
        };
      });
    }

    // Set radii
    for (const n of nodes) {
      n.radius = nodeRadius(n);
    }

    // Put the primary officer at center (force) or left (hierarchical)
    const primary = nodes.find(
      (n) => n.type === "officer" && n.id === `officer:${(officerName || "").toLowerCase()}`
    );
    if (primary && layout === "force") {
      primary.x = cx;
      primary.y = cy;
    }

    nodesRef.current = nodes;
    edgesRef.current = d.edges;
    panRef.current = { x: 0, y: 0, scale: 1 };

    cancelAnimationFrame(animRef.current);

    if (layout === "force") {
      runForceSimulation(nodes, d.edges, cx, cy, W, H);
    } else {
      // Hierarchical: just draw, no simulation
      draw();
    }
  }, [officerName]);

  function layoutHierarchical(d: NetworkData, W: number, H: number, primaryName: string): GraphNode[] {
    const primaryId = `officer:${primaryName.toLowerCase()}`;
    // Assign layers via BFS
    const layers: Map<string, number> = new Map();
    const queue: string[] = [primaryId];
    layers.set(primaryId, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLayer = layers.get(current)!;
      for (const e of d.edges) {
        const neighbor = e.source === current ? e.target : e.target === current ? e.source : null;
        if (neighbor && !layers.has(neighbor)) {
          layers.set(neighbor, currentLayer + 1);
          queue.push(neighbor);
        }
      }
    }

    // Unconnected nodes
    for (const n of d.nodes) {
      if (!layers.has(n.id)) layers.set(n.id, 3);
    }

    // Group nodes by layer
    const byLayer: Map<number, typeof d.nodes> = new Map();
    for (const n of d.nodes) {
      const layer = layers.get(n.id) || 0;
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push(n);
    }

    const maxLayer = Math.max(...byLayer.keys(), 0);
    const colSpacing = Math.max(200, W / (maxLayer + 2));
    const marginLeft = 80;

    const nodes: GraphNode[] = [];
    for (const [layer, layerNodes] of byLayer.entries()) {
      const rowSpacing = Math.max(36, (H - 40) / (layerNodes.length + 1));
      layerNodes.forEach((n, i) => {
        nodes.push({
          ...n,
          x: marginLeft + layer * colSpacing,
          y: 20 + (i + 1) * rowSpacing,
          vx: 0,
          vy: 0,
          radius: 0,
        });
      });
    }
    return nodes;
  }

  function runForceSimulation(nodes: GraphNode[], edges: GraphEdge[], cx: number, cy: number, W: number, H: number) {
    let iterations = 0;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    function simulate() {
      const alpha = Math.max(0.001, 0.3 * Math.pow(0.99, iterations));
      iterations++;

      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = a.radius + b.radius + 20;
          const force = (300 * alpha) / (dist * dist);

          if (dist < minDist) {
            const overlap = (minDist - dist) * 0.5;
            dx /= dist;
            dy /= dist;
            a.x -= dx * overlap;
            a.y -= dy * overlap;
            b.x += dx * overlap;
            b.y += dy * overlap;
          }

          a.vx -= (dx / dist) * force;
          a.vy -= (dy / dist) * force;
          b.vx += (dx / dist) * force;
          b.vy += (dy / dist) * force;
        }
      }

      // Attraction along edges
      for (const e of edges) {
        const a = nodeMap.get(e.source);
        const b = nodeMap.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 80 + (a.radius + b.radius);
        const force = (dist - targetDist) * 0.02 * alpha;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }

      // Center gravity
      for (const n of nodes) {
        n.vx += (cx - n.x) * 0.001 * alpha;
        n.vy += (cy - n.y) * 0.001 * alpha;
      }

      // Apply velocity
      for (const n of nodes) {
        if (dragRef.current.node === n) continue;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(n.radius, Math.min(W - n.radius, n.x));
        n.y = Math.max(n.radius, Math.min(H - n.radius, n.y));
      }

      draw();
      if (alpha > 0.002) {
        animRef.current = requestAnimationFrame(simulate);
      }
    }

    simulate();
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;

    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { x: px, y: py, scale } = panRef.current;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(scale, scale);

    ctx.clearRect(-px / scale, -py / scale, W / scale, H / scale);

    const nodes = nodesRef.current;
    const edgeData = edgesRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Filter by minConnections
    const connectionCount = new Map<string, number>();
    for (const e of edgeData) {
      connectionCount.set(e.source, (connectionCount.get(e.source) || 0) + 1);
      connectionCount.set(e.target, (connectionCount.get(e.target) || 0) + 1);
    }
    const visibleNodes = new Set<string>();
    for (const n of nodes) {
      const count = connectionCount.get(n.id) || 0;
      if (count >= minConnections || n.id === `officer:${(officerName || "").toLowerCase()}`) {
        visibleNodes.add(n.id);
      }
    }

    // Draw edges
    for (const e of edgeData) {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) continue;
      if (!visibleNodes.has(e.source) || !visibleNodes.has(e.target)) continue;

      const isHovEdge = hovered && (e.source === hovered.id || e.target === hovered.id);
      ctx.lineWidth = isHovEdge ? 1.5 : 0.5;
      ctx.strokeStyle = isHovEdge ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.08)";

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Edge label (position/role)
      if (showEdgeLabels && e.position && scale > 0.5) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const label = e.position.replace("Officer ", "Off ");
        ctx.font = "9px system-ui";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(30,33,44,0.85)";
        ctx.fillRect(mx - tw / 2 - 3, my - 6, tw + 6, 12);
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, mx, my);
      }
    }

    // Draw nodes
    for (const n of nodes) {
      if (!visibleNodes.has(n.id)) continue;

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);

      if (n.type === "officer") {
        ctx.fillStyle = officerColor(n.carrier_count || 1);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = riskColor(n.risk_score || 0);
        ctx.globalAlpha = n.fatal_crashes && n.fatal_crashes > 0 ? 1 : 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // Labels
      if (n.type === "officer" || (n.total_crashes || 0) >= 10 || (n.risk_score || 0) >= 50) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = n.type === "officer" ? "bold 11px system-ui" : "10px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = n.type === "officer"
          ? `${n.label} (${n.carrier_count})`
          : n.label.length > 20 ? n.label.slice(0, 18) + "..." : n.label;
        ctx.fillText(label, n.x, n.y + n.radius + 3);
      }

      // Risk score badge for carriers
      if (n.type === "carrier" && (n.risk_score || 0) >= 30) {
        ctx.font = "bold 8px system-ui";
        ctx.fillStyle = riskColor(n.risk_score || 0);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.risk_score), n.x, n.y);
      }
    }

    // Highlight hovered node
    const hov = hovered;
    if (hov && visibleNodes.has(hov.id)) {
      const node = nodeMap.get(hov.id);
      if (node) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [hovered, minConnections, showEdgeLabels, officerName]);

  // Mouse handlers
  const getNodeAt = useCallback((mx: number, my: number): GraphNode | null => {
    const { x: px, y: py, scale } = panRef.current;
    const gx = (mx - px) / scale;
    const gy = (my - py) / scale;
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      const dx = gx - n.x;
      const dy = gy - n.y;
      if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) return n;
    }
    return null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);
    if (node) {
      dragRef.current = { node, startX: mx, startY: my, panning: false };
    } else {
      dragRef.current = { node: null, startX: mx, startY: my, panning: true };
    }
  }, [getNodeAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragRef.current.node) {
      const { scale } = panRef.current;
      dragRef.current.node.x += (mx - dragRef.current.startX) / scale;
      dragRef.current.node.y += (my - dragRef.current.startY) / scale;
      dragRef.current.node.vx = 0;
      dragRef.current.node.vy = 0;
      dragRef.current.startX = mx;
      dragRef.current.startY = my;
      draw();
    } else if (dragRef.current.panning) {
      panRef.current.x += mx - dragRef.current.startX;
      panRef.current.y += my - dragRef.current.startY;
      dragRef.current.startX = mx;
      dragRef.current.startY = my;
      draw();
    } else {
      const node = getNodeAt(mx, my);
      setHovered(node);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = node ? "pointer" : "grab";
      }
    }
  }, [draw, getNodeAt]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = { node: null, startX: 0, startY: 0, panning: false };
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (node?.type === "carrier" && node.dot_number) {
      navigate(`/carrier/${node.dot_number}`);
    } else if (node?.type === "officer") {
      const name = node.id.replace("officer:", "");
      navigate(`/network/${encodeURIComponent(name)}`);
    }
  }, [getNodeAt, navigate]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const { x: px, y: py, scale } = panRef.current;
    const newScale = Math.max(0.2, Math.min(5, scale * factor));
    panRef.current = {
      x: mx - (mx - px) * (newScale / scale),
      y: my - (my - py) * (newScale / scale),
      scale: newScale,
    };
    draw();
  }, [draw]);

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/network/${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleApplySettings = () => {
    if (officerName) {
      let url = `/network/${encodeURIComponent(officerName)}?depth=${depthVal}&max=${maxVal}`;
      if (selectedCluster != null) url += `&cluster=${selectedCluster}`;
      navigate(url);
    }
  };

  // Sidebar styles
  const sidebarStyle: React.CSSProperties = {
    width: 220, flexShrink: 0, background: "var(--bg-secondary, #1a1d27)",
    borderRight: "1px solid var(--border, #2e3344)", padding: "16px 14px",
    overflowY: "auto", fontSize: 13,
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
    color: "var(--text-muted, #6b7084)", marginBottom: 6, marginTop: 16,
  };
  const selectStyle: React.CSSProperties = {
    width: "100%", padding: "5px 8px", background: "var(--bg-tertiary, #242834)",
    border: "1px solid var(--border, #2e3344)", borderRadius: 6,
    color: "var(--text-primary, #e4e6ed)", fontSize: 12,
  };
  const sliderStyle: React.CSSProperties = {
    width: "100%", accentColor: "var(--accent, #3b82f6)", cursor: "pointer",
  };
  const legendDot = (color: string, size = 10): React.CSSProperties => ({
    width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0,
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-primary, #0f1117)", color: "var(--text-primary, #e4e6ed)" }}>
      {/* Header */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border, #2e3344)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
        <Link to="/" style={{ color: "var(--accent, #3b82f6)", textDecoration: "none", fontSize: 14 }}>&larr; Map</Link>
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
          Network Graph
          {officerName ? <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>
            {" \u2014 "}{officerName.replace(/-/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
            {data ? ` \u00B7 ${data.stats.carrier_count} companies` : ""}
          </span> : null}
        </h1>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <input
            type="text"
            placeholder="Search officer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: "var(--bg-tertiary, #242834)", border: "1px solid var(--border, #2e3344)",
              borderRadius: 6, padding: "5px 10px", color: "var(--text-primary)", fontSize: 12, width: 180,
            }}
          />
          <button type="submit" style={{
            background: "var(--accent, #3b82f6)", border: "none", borderRadius: 6,
            padding: "5px 12px", color: "#fff", fontSize: 12, cursor: "pointer",
          }}>Go</button>
        </form>
      </div>

      {/* Stats bar */}
      {data?.stats && !loading && (
        <div style={{ padding: "6px 16px", background: "var(--bg-secondary, #1a1d27)", display: "flex", gap: 14, fontSize: 12, flexWrap: "wrap", borderBottom: "1px solid var(--border, #2e3344)", flexShrink: 0 }}>
          <span><strong>{data.stats.carrier_count}</strong> carriers</span>
          <span><strong>{data.stats.officer_count}</strong> officers</span>
          <span><strong>{data.stats.total_crashes.toLocaleString()}</strong> crashes</span>
          {data.stats.total_fatal > 0 && (
            <span style={{ color: "var(--danger, #ef4444)" }}><strong>{data.stats.total_fatal}</strong> fatalities</span>
          )}
          <span><strong>{data.stats.total_power_units.toLocaleString()}</strong> trucks</span>
        </div>
      )}

      {/* Cluster picker */}
      {clusters.length > 1 && !loading && (
        <div style={{
          padding: "6px 16px", background: "var(--bg-tertiary, #242834)",
          borderBottom: "1px solid var(--border, #2e3344)", display: "flex",
          gap: 6, fontSize: 12, flexWrap: "wrap", alignItems: "center", flexShrink: 0,
        }}>
          <span style={{ color: "var(--text-muted)", marginRight: 4, fontWeight: 600 }}>
            {clusters.length} identities found:
          </span>
          {clusters
            .filter((c) => c.carrier_count >= 2 && !(c.link_signals.length === 1 && c.link_signals[0] === "name_only"))
            .map((c) => (
              <button
                key={c.cluster_index}
                onClick={() => {
                  setSelectedCluster(c.cluster_index);
                  if (officerName) fetchNetwork(officerName, c.cluster_index);
                }}
                style={{
                  padding: "3px 10px", borderRadius: 12, border: "1px solid",
                  borderColor: selectedCluster === c.cluster_index ? "var(--accent, #3b82f6)" : "var(--border, #2e3344)",
                  background: selectedCluster === c.cluster_index ? "rgba(59,130,246,0.15)" : "transparent",
                  color: selectedCluster === c.cluster_index ? "var(--accent, #3b82f6)" : "var(--text-secondary)",
                  cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
                }}
              >
                {c.carrier_count} carriers &middot; {c.states.join(", ")}
                {c.total_crashes > 0 && <span style={{ color: "var(--warning, #f59e0b)" }}> &middot; {c.total_crashes} crashes</span>}
              </button>
            ))}
          <button
            onClick={() => {
              setSelectedCluster(null);
              if (officerName) fetchNetwork(officerName, null);
            }}
            style={{
              padding: "3px 10px", borderRadius: 12, border: "1px solid",
              borderColor: selectedCluster === null ? "var(--accent, #3b82f6)" : "var(--border, #2e3344)",
              background: selectedCluster === null ? "rgba(59,130,246,0.15)" : "transparent",
              color: selectedCluster === null ? "var(--accent, #3b82f6)" : "var(--text-secondary)",
              cursor: "pointer", fontSize: 11,
            }}
          >
            All
          </button>
        </div>
      )}

      {/* Main area: sidebar + canvas */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Sidebar */}
        <div style={sidebarStyle}>
          {/* Legend */}
          <div style={{ ...sectionLabel, marginTop: 0 }}>Legend</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ ...legendDot("#8b5cf6", 12), border: "1.5px solid rgba(255,255,255,0.6)" }} />
              <span>Source Officer</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#22c55e")} /><span>Strong (25+)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#3b82f6")} /><span>Medium (10+)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#f59e0b")} /><span>Weak (&lt;10)</span>
            </div>
          </div>

          {/* Layout direction */}
          <div style={sectionLabel}>Layout</div>
          <select
            value={layoutMode}
            onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
            style={selectStyle}
          >
            <option value="force">Free Layout</option>
            <option value="hierarchical">Left to Right</option>
          </select>

          {/* Depth */}
          <div style={sectionLabel}>Network Depth</div>
          <select value={depthVal} onChange={(e) => setDepthVal(Number(e.target.value))} style={selectStyle}>
            <option value={0}>Direct only (depth 0)</option>
            <option value={1}>Co-officers (depth 1)</option>
            <option value={2}>Extended (depth 2)</option>
          </select>

          {/* Max carriers */}
          <div style={sectionLabel}>Max Carriers</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="range" min={10} max={200} step={10} value={maxVal} onChange={(e) => setMaxVal(Number(e.target.value))} style={sliderStyle} />
            <span style={{ fontWeight: 700, minWidth: 28, textAlign: "right" }}>{maxVal}</span>
          </div>

          {/* Apply button */}
          <button
            onClick={handleApplySettings}
            style={{
              width: "100%", marginTop: 10, padding: "7px 0", background: "var(--accent, #3b82f6)",
              border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            Apply
          </button>

          {/* Min connections filter */}
          <div style={sectionLabel}>Min Connections</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="range" min={1} max={10} value={minConnections} onChange={(e) => { setMinConnections(Number(e.target.value)); draw(); }} style={sliderStyle} />
            <span style={{ fontWeight: 700, minWidth: 16, textAlign: "right" }}>{minConnections}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            Hide nodes with fewer connections
          </div>

          {/* Edge labels toggle */}
          <div style={sectionLabel}>Display</div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showEdgeLabels} onChange={(e) => { setShowEdgeLabels(e.target.checked); draw(); }} style={{ accentColor: "var(--accent)" }} />
            <span>Edge labels</span>
          </label>

          {/* Connection types */}
          {data && (
            <>
              <div style={sectionLabel}>Connections</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={legendDot("#3b82f6", 8)} />
                  <span>Officer</span>
                  <span style={{ marginLeft: "auto", fontWeight: 600 }}>{data.stats.officer_count}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={legendDot("#f97316", 8)} />
                  <span>Carrier</span>
                  <span style={{ marginLeft: "auto", fontWeight: 600 }}>{data.stats.carrier_count}</span>
                </div>
              </div>
            </>
          )}

          {/* Risk color legend */}
          <div style={sectionLabel}>Risk Colors</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#ef4444", 8)} /><span>Critical (70+)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#f97316", 8)} /><span>High (50-69)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#f59e0b", 8)} /><span>Medium (30-49)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#3b82f6", 8)} /><span>Low (1-29)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={legendDot("#6b7084", 8)} /><span>None</span>
            </div>
          </div>

          <div style={{ marginTop: 20, fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Scroll to zoom. Drag to pan. Click to focus. Drag nodes to rearrange.
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: "relative" }}>
          {loading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
              <div style={{ fontSize: 16, color: "var(--text-secondary)" }}>Loading network...</div>
            </div>
          )}
          {error && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ color: "var(--danger, #ef4444)", fontSize: 16, marginBottom: 8 }}>Failed to load</div>
                <div style={{ color: "var(--text-secondary)", marginBottom: 12 }}>{error}</div>
                <button onClick={() => officerName && fetchNetwork(officerName)} style={{
                  background: "var(--accent)", border: "none", borderRadius: 6, padding: "8px 16px",
                  color: "#fff", cursor: "pointer",
                }}>Retry</button>
              </div>
            </div>
          )}
          {!loading && data?.nodes.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", color: "var(--text-secondary)" }}>
                <div style={{ fontSize: 16, marginBottom: 8 }}>No network found</div>
                <div>Try searching for a different officer name.</div>
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleClick}
            onWheel={handleWheel}
          />

          {/* Hover tooltip */}
          {hovered && (
            <div style={{
              position: "absolute", bottom: 12, left: 12,
              background: "var(--bg-secondary, #1a1d27)", border: "1px solid var(--border, #2e3344)",
              borderRadius: 8, padding: "10px 14px", fontSize: 13, maxWidth: 320, zIndex: 3,
            }}>
              {hovered.type === "officer" ? (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.label}</div>
                  <div style={{ color: "var(--text-secondary)", display: "flex", gap: 10 }}>
                    <span>Linked to <strong>{hovered.carrier_count}</strong> carriers</span>
                    <span style={{ color: strengthLabel(hovered.carrier_count || 0).color }}>{strengthLabel(hovered.carrier_count || 0).label}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.label}</div>
                  <div style={{ color: "var(--text-secondary)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>DOT# {hovered.dot_number}</span>
                    {hovered.state && <span>{hovered.state}</span>}
                    <span>Risk: <strong style={{ color: riskColor(hovered.risk_score || 0) }}>{hovered.risk_score}</strong></span>
                    <span>{hovered.power_units} trucks</span>
                    {(hovered.total_crashes || 0) > 0 && (
                      <span style={{ color: "var(--warning)" }}>{hovered.total_crashes} crashes</span>
                    )}
                    {(hovered.fatal_crashes || 0) > 0 && (
                      <span style={{ color: "var(--danger)" }}>{hovered.fatal_crashes} fatal</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
