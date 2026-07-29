// pages/ar-viewer.tsx
import { useState, useRef, useCallback, useEffect } from "react";

// Default dimensions per furniture type (mm)
const FURNITURE_DEFAULTS: Record<string, [number, number, number]> = {
  sofa:  [1800, 900, 850],
  chair: [600,  600, 950],
  table: [1200, 700, 750],
};

const AXIS_CONFIG = [
  { key: "x", label: "W", color: "#00E5FF", min: 300, max: 3000 },
  { key: "y", label: "D", color: "#A78BFA", min: 300, max: 2000 },
  { key: "z", label: "H", color: "#34D399", min: 300, max: 2000 },
] as const;

type Axis = "x" | "y" | "z";

// ── Dimension Ruler ────────────────────────────────────────────────────────────
function DimRuler({
  axis, value, color, label, min, max,
  onChange,
}: {
  axis: Axis; value: number; color: string; label: string;
  min: number; max: number; onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);

  const posFromVal = (v: number) => ((v - min) / (max - min)) * 100;

  const valFromPos = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return value;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round((min + ratio * (max - min)) / 10) * 10; // snap to 10mm
  }, [min, max, value]);

  const onStart = (clientX: number) => {
    dragging.current = true;
    onChange(valFromPos(clientX));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      onChange(valFromPos(x));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("touchend",  onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("touchend",  onUp);
    };
  }, [valFromPos]);

  const pct = posFromVal(value);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      {/* Label */}
      <div style={{
        width: "20px", fontFamily: "'JetBrains Mono', monospace",
        fontSize: "11px", fontWeight: 700, color, flexShrink: 0,
      }}>{label}</div>

      {/* Track */}
      <div
        ref={trackRef}
        onMouseDown={e => onStart(e.clientX)}
        onTouchStart={e => onStart(e.touches[0].clientX)}
        style={{
          flex: 1, height: "2px", borderRadius: "2px",
          background: "rgba(255,255,255,0.12)",
          position: "relative", cursor: "pointer",
        }}
      >
        {/* Filled part */}
        <div style={{
          position: "absolute", left: 0, top: 0,
          width: `${pct}%`, height: "100%",
          background: color, borderRadius: "2px",
          opacity: 0.5,
        }} />

        {/* Handle */}
        <div style={{
          position: "absolute", top: "50%",
          left: `${pct}%`,
          transform: "translate(-50%, -50%)",
          width: "14px", height: "14px", borderRadius: "50%",
          background: color,
          boxShadow: `0 0 10px ${color}88`,
          cursor: "grab",
          touchAction: "none",
          transition: dragging.current ? "none" : "left 0.05s",
        }} />
      </div>

      {/* Value */}
      <div style={{
        width: "52px", textAlign: "right",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "12px", color: "var(--text)", flexShrink: 0,
      }}>
        {value >= 1000 ? `${(value / 1000).toFixed(2)}m` : `${value}mm`}
      </div>
    </div>
  );
}

// ── Print Export Button ────────────────────────────────────────────────────────
type ExportState = "idle" | "loading" | "done" | "error";

function PrintExportPanel({
  meshPath, dims,
}: {
  meshPath: string;
  dims: Record<Axis, number>;
}) {
  const [scalePct, setScalePct]     = useState(10);   // default 1:10
  const [state, setState]           = useState<ExportState>("idle");
  const [result, setResult]         = useState<any>(null);
  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;

  const scaleOptions = [
    { label: "1:10  (prototype)", value: 10 },
    { label: "1:5   (detailed)", value: 20 },
    { label: "1:2   (half-size)", value: 50 },
    { label: "1:1   (full size)", value: 100 },
  ];

  const handleExport = async () => {
    setState("loading");
    setResult(null);
    try {
      const res = await fetch("http://localhost:5000/api/generate-gcode", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          mesh_path:    meshPath,
          width:        dims.x,
          depth:        dims.y,
          height:       dims.z,
          scale_factor: scalePct / 100,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Unknown error");
      setState("done");
      setResult(json);
    } catch (err: any) {
      setState("error");
      setResult({ error: err.message });
    }
  };

  const pd = result?.print_dims_mm;

  return (
    <div style={{
      margin: "0 10px 10px",
      padding: "14px 16px",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid var(--border)",
      borderRadius: "14px",
      display: "flex", flexDirection: "column", gap: "10px",
    }}>
      <div style={{ ...mono, fontSize: "9px", letterSpacing: "2px", color: "var(--cyan-text-dim)", textTransform: "uppercase" }}>
        3D Print Export
      </div>

      {/* Scale selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ ...mono, fontSize: "10px", color: "var(--text-mono)", flexShrink: 0 }}>Scale</div>
        <select
          value={scalePct}
          onChange={e => { setScalePct(Number(e.target.value)); setState("idle"); setResult(null); }}
          style={{
            flex: 1, padding: "6px 8px", borderRadius: "8px",
            background: "rgba(0,229,255,0.06)", border: "1px solid var(--border)",
            color: "var(--text)", ...mono, fontSize: "11px", cursor: "pointer",
          }}
        >
          {scaleOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Print size preview */}
      {(state === "idle" || state === "loading") && (
        <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", textAlign: "center" }}>
          Print size: {Math.round(dims.x * scalePct / 100)} × {Math.round(dims.y * scalePct / 100)} × {Math.round(dims.z * scalePct / 100)} mm
        </div>
      )}

      {/* Export button */}
      {state !== "done" && (
        <button
          onClick={handleExport}
          disabled={state === "loading"}
          style={{
            padding: "10px",
            borderRadius: "10px",
            background: state === "loading"
              ? "rgba(0,229,255,0.1)"
              : "linear-gradient(135deg, rgba(0,229,255,0.15), rgba(167,139,250,0.15))",
            border: "1px solid var(--cyan-glow)",
            color: "var(--cyan-text)",
            cursor: state === "loading" ? "wait" : "pointer",
            ...mono, fontSize: "11px", fontWeight: 700,
            letterSpacing: "1px", textTransform: "uppercase",
          }}
        >
          {state === "loading" ? "⏳ Slicing..." : "🖨️  Export for 3D Print"}
        </button>
      )}

      {/* Error */}
      {state === "error" && (
        <div style={{ ...mono, fontSize: "10px", color: "#f87171", textAlign: "center" }}>
          ⚠ {result?.error}
          <br />
          <span
            style={{ cursor: "pointer", textDecoration: "underline", color: "var(--cyan-text-dim)" }}
            onClick={() => setState("idle")}
          >retry</span>
        </div>
      )}

      {/* Success */}
      {state === "done" && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ ...mono, fontSize: "10px", color: "#34D399", textAlign: "center" }}>
            ✓ {result.type === "gcode" ? "G-code ready!" : "Scaled STL ready"}
          </div>
          {pd && (
            <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", textAlign: "center" }}>
              Print size: {pd.w} × {pd.d} × {pd.h} mm
            </div>
          )}
          {result.note && (
            <div style={{ ...mono, fontSize: "9px", color: "rgba(255,200,100,0.8)", textAlign: "center", lineHeight: 1.5 }}>
              {result.note}
            </div>
          )}
          <a
            href={`http://localhost:5000${result.download_url}`}
            download
            style={{
              display: "block", textAlign: "center",
              padding: "8px", borderRadius: "8px",
              background: "linear-gradient(135deg, #00E5FF22, #34D39922)",
              border: "1px solid #34D399",
              color: "#34D399", textDecoration: "none",
              ...mono, fontSize: "11px", fontWeight: 700,
            }}
          >
            ⬇  Download {result.type === "gcode" ? ".gcode" : ".stl"}
          </a>
          <span
            style={{ ...mono, fontSize: "9px", color: "var(--cyan-text-dim)", textAlign: "center", cursor: "pointer" }}
            onClick={() => { setState("idle"); setResult(null); }}
          >← change scale</span>
        </div>
      )}
    </div>
  );
}


// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ARViewer() {
  const params    = new URLSearchParams(window.location.search);
  const meshPath  = params.get("mesh");
  const name      = params.get("name") ?? "Furniture Design";
  const typeHint  = params.get("type") ?? "sofa";

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  const VALID_MESH_RE = /^static\/generated_meshes\/[a-zA-Z0-9 _\-.()]+\.(glb|obj|stl)$/i;
  const isValidPath   = meshPath && VALID_MESH_RE.test(meshPath);

  // Dimensions state (mm)
  const defaults = FURNITURE_DEFAULTS[typeHint] ?? FURNITURE_DEFAULTS.sofa;
  const [dims, setDims] = useState<Record<Axis, number>>({
    x: defaults[0], y: defaults[1], z: defaults[2],
  });

  const setAxis = (axis: Axis) => (v: number) =>
    setDims(d => ({ ...d, [axis]: v }));

  // Compute model-viewer scale based on default mesh size vs target dims
  // Assume Hunyuan3D outputs ~1m-scale mesh; scale to match mm targets
  const baseM  = defaults[0] / 1000; // default width in meters
  const scaleX = dims.x / 1000 / baseM;
  const scaleY = dims.z / 1000 / baseM;
  const scaleZ = dims.y / 1000 / baseM;
  const scaleStr = `${scaleX.toFixed(3)} ${scaleY.toFixed(3)} ${scaleZ.toFixed(3)}`;

  if (!meshPath || !isValidPath) {
    return (
      <div style={{
        height: "100dvh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: "16px",
        background: "var(--bg)", color: "var(--text)", padding: "24px", textAlign: "center",
      }}>
        <div style={{ fontSize: "40px" }}>⚠️</div>
        <div style={{ ...sg, fontWeight: 700, fontSize: "20px" }}>
          {!meshPath ? "No model specified" : "Invalid model path"}
        </div>
        <a href="/" style={{
          padding: "10px 20px", borderRadius: "12px",
          background: "var(--cyan-glow-bg)", border: "1px solid var(--cyan-glow)",
          color: "var(--cyan-text)", ...sg, fontWeight: 700, fontSize: "14px", textDecoration: "none",
        }}>Go to Generate</a>
      </div>
    );
  }

  return (
    <div style={{
      height: "100dvh", display: "flex", flexDirection: "column",
      background: "var(--bg)", color: "var(--text)", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "22px", height: "22px", transform: "rotate(45deg)", borderRadius: "4px",
            border: "1.5px solid var(--cyan-glow)",
            background: "linear-gradient(135deg, var(--cyan-glow-bg), var(--violet-glow-bg))",
          }} />
          <span style={{ ...sg, fontWeight: 700, fontSize: "15px" }}>
            Holo<span style={{ color: "var(--cyan-text)" }}>3D</span>
          </span>
        </div>
        <div style={{ ...mono, fontSize: "10px", letterSpacing: "2px", color: "var(--cyan-text-dim)", textTransform: "uppercase" }}>
          AR Viewer
        </div>
      </div>

      {/* Model name */}
      <div style={{ padding: "10px 20px 0", flexShrink: 0 }}>
        <div style={{ ...mono, fontSize: "10px", letterSpacing: "2px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "2px" }}>
          Now viewing
        </div>
        <div style={{ ...sg, fontWeight: 700, fontSize: "15px" }}>
          {decodeURIComponent(name)}
        </div>
      </div>

      {/* model-viewer */}
      <div style={{ flex: 1, position: "relative", margin: "10px 10px 0", borderRadius: "18px", overflow: "hidden", border: "1px solid var(--cyan-glow-soft)" }}>
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: "50%",
          backgroundImage: "linear-gradient(rgba(0,229,255,0.12) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.12) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
          transform: "perspective(400px) rotateX(60deg)", transformOrigin: "bottom",
          opacity: 0.2, pointerEvents: "none",
          maskImage: "linear-gradient(to top, #000 5%, transparent)",
        }} />

        {/* @ts-expect-error model-viewer web component */}
        <model-viewer
          src={`/${meshPath}`}
          alt={name}
          camera-controls
          auto-rotate
          shadow-intensity="1"
          exposure="1.2"
          environment-image="neutral"
          ar
          ar-modes="webxr scene-viewer quick-look"
          ar-scale="fixed"
          scale={scaleStr}
          style={{
            width: "100%", height: "100%",
            background: "transparent",
            "--poster-color": "transparent",
          }}
        >
          <button slot="ar-button" style={{
            position: "absolute", bottom: "20px", left: "50%", transform: "translateX(-50%)",
            padding: "14px 32px", borderRadius: "50px",
            background: "linear-gradient(135deg, #00E5FF, #3df2ff)",
            border: "none", cursor: "pointer",
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "15px",
            color: "#021018",
            boxShadow: "0 0 32px var(--cyan-glow), 0 8px 20px var(--cyan-glow)",
            whiteSpace: "nowrap",
          }}>
            🥽 View in AR
          </button>
        </model-viewer>
      </div>

      {/* Dimension Rulers */}
      <div style={{
        margin: "10px", padding: "14px 16px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border)",
        borderRadius: "14px", flexShrink: 0,
        display: "flex", flexDirection: "column", gap: "14px",
      }}>
        <div style={{ ...mono, fontSize: "9px", letterSpacing: "2px", color: "var(--cyan-text-dim)", textTransform: "uppercase" }}>
          Dimensions
        </div>

        {AXIS_CONFIG.map(({ key, label, color, min, max }) => (
          <DimRuler
            key={key}
            axis={key}
            label={label}
            color={color}
            min={min}
            max={max}
            value={dims[key]}
            onChange={setAxis(key)}
          />
        ))}

        {/* Summary */}
        <div style={{
          ...mono, fontSize: "11px", textAlign: "center",
          color: "var(--cyan-text-dim)", paddingTop: "4px",
          borderTop: "1px solid var(--border)",
        }}>
          {dims.x} × {dims.y} × {dims.z} mm
        </div>
      </div>

      {/* 3D Print Export */}
      <PrintExportPanel meshPath={meshPath} dims={dims} />

      <div style={{ padding: "4px 20px 12px", textAlign: "center", flexShrink: 0 }}>
        <div style={{ ...mono, fontSize: "10px", color: "var(--text-mono)", letterSpacing: "1px" }}>
          Drag handles to resize · Tap "View in AR" to place in your space
        </div>
      </div>
    </div>
  );
}
