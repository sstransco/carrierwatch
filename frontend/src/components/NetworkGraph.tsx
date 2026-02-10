import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

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
  const [data, setData] = useState<NetworkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState(officerName || "");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const panRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ node: GraphNode | null; startX: number; startY: number; panning: boolean }>({
    node: null, startX: 0, startY: 0, panning: false,
  });

  const depth = parseInt(searchParams.get("depth") || "1");
  const maxCarriers = parseInt(searchParams.get("max") || "80");

  const fetchNetwork = useCallback((name: string) => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/network/officer/${encodeURIComponent(name.trim())}?depth=${depth}&max_carriers=${maxCarriers}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: NetworkData) => {
        setData(d);
        setLoading(false);
        initGraph(d);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [depth, maxCarriers]);

  useEffect(() => {
    if (officerName) fetchNetwork(officerName);
  }, [officerName, fetchNetwork]);

  const initGraph = useCallback((d: NetworkData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const cx = W / 2;
    const cy = H / 2;

    // Initialize node positions in a circle
    const nodes: GraphNode[] = d.nodes.map((n, i) => {
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

    // Set radii
    for (const n of nodes) {
      n.radius = nodeRadius(n);
    }

    // Put the primary officer at center
    const primary = nodes.find(
      (n) => n.type === "officer" && n.id === `officer:${(officerName || "").toLowerCase()}`
    );
    if (primary) {
      primary.x = cx;
      primary.y = cy;
    }

    nodesRef.current = nodes;
    edgesRef.current = d.edges;
    panRef.current = { x: 0, y: 0, scale: 1 };

    // Start simulation
    cancelAnimationFrame(animRef.current);
    let iterations = 0;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    function simulate() {
      const alpha = Math.max(0.001, 0.3 * Math.pow(0.99, iterations));
      iterations++;

      // Repulsion between all nodes
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
      for (const e of d.edges) {
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

      // Apply velocity with damping
      for (const n of nodes) {
        if (dragRef.current.node === n) continue;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        // Bounds
        n.x = Math.max(n.radius, Math.min(W - n.radius, n.x));
        n.y = Math.max(n.radius, Math.min(H - n.radius, n.y));
      }

      draw();
      if (alpha > 0.002) {
        animRef.current = requestAnimationFrame(simulate);
      }
    }

    simulate();
  }, [officerName]);

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

    // Clear
    ctx.clearRect(-px / scale, -py / scale, W / scale, H / scale);

    const nodes = nodesRef.current;
    const edgeData = edgesRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Draw edges
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (const e of edgeData) {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Draw nodes
    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);

      if (n.type === "officer") {
        ctx.fillStyle = officerColor(n.carrier_count || 1);
        ctx.fill();
        // Diamond shape overlay for officers
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

      // Labels for officers and large carriers
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
    }

    // Highlight hovered node
    const hov = hovered;
    if (hov) {
      const node = nodeMap.get(hov.id);
      if (node) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Highlight connected edges
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        for (const e of edgeData) {
          if (e.source === hov.id || e.target === hov.id) {
            const a = nodeMap.get(e.source);
            const b = nodeMap.get(e.target);
            if (a && b) {
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }
    }

    ctx.restore();
  }, [hovered]);

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
      window.location.href = `/carrier/${node.dot_number}`;
    } else if (node?.type === "officer") {
      const name = node.id.replace("officer:", "");
      window.location.href = `/network/${encodeURIComponent(name)}`;
    }
  }, [getNodeAt]);

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

  // Resize handler
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
      window.location.href = `/network/${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-primary, #0f1117)", color: "var(--text-primary, #e4e6ed)" }}>
      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border, #2e3344)", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <Link to="/" style={{ color: "var(--accent, #3b82f6)", textDecoration: "none", fontSize: 14 }}>&larr; Map</Link>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Officer Network{officerName ? `: ${officerName.replace(/-/g, " ").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}` : ""}
        </h1>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <input
            type="text"
            placeholder="Search officer name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: "var(--bg-tertiary, #242834)", border: "1px solid var(--border, #2e3344)",
              borderRadius: 6, padding: "6px 12px", color: "var(--text-primary)", fontSize: 13, width: 220,
            }}
          />
          <button type="submit" style={{
            background: "var(--accent, #3b82f6)", border: "none", borderRadius: 6,
            padding: "6px 14px", color: "#fff", fontSize: 13, cursor: "pointer",
          }}>Search</button>
        </form>
      </div>

      {/* Stats bar */}
      {data?.stats && !loading && (
        <div style={{ padding: "8px 20px", background: "var(--bg-secondary, #1a1d27)", display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" }}>
          <span><strong>{data.stats.carrier_count}</strong> carriers</span>
          <span><strong>{data.stats.officer_count}</strong> officers</span>
          <span><strong>{data.stats.total_crashes.toLocaleString()}</strong> crashes</span>
          {data.stats.total_fatal > 0 && (
            <span style={{ color: "var(--danger, #ef4444)" }}><strong>{data.stats.total_fatal}</strong> fatalities</span>
          )}
          <span><strong>{data.stats.total_power_units.toLocaleString()}</strong> trucks</span>
          <span style={{ marginLeft: "auto", color: "var(--text-muted, #6b7084)" }}>
            Click nodes to navigate. Drag to rearrange. Scroll to zoom.
          </span>
        </div>
      )}

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
            borderRadius: 8, padding: "10px 14px", fontSize: 13, maxWidth: 300, zIndex: 3,
          }}>
            {hovered.type === "officer" ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.label}</div>
                <div style={{ color: "var(--text-secondary)" }}>
                  Linked to <strong>{hovered.carrier_count}</strong> carriers
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{hovered.label}</div>
                <div style={{ color: "var(--text-secondary)", display: "flex", gap: 12, flexWrap: "wrap" }}>
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

        {/* Legend */}
        <div style={{
          position: "absolute", top: 12, right: 12,
          background: "var(--bg-secondary, #1a1d27)", border: "1px solid var(--border, #2e3344)",
          borderRadius: 8, padding: "10px 14px", fontSize: 11, zIndex: 3,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Legend</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#3b82f6", border: "1.5px solid rgba(255,255,255,0.6)" }} />
            <span>Officer</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
            <span>High Risk (70+)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
            <span>Medium Risk (30-69)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#6b7084" }} />
            <span>Low/No Risk</span>
          </div>
        </div>
      </div>
    </div>
  );
}
