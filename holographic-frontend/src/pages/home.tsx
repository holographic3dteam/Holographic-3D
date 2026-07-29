import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  generateDesign, generate3D, saveDesign, editDesign, abortGeneration, checkBackendReady,
  getImageUrl, GenerateResponse, MeshPaths, ProgressEvent,
  addToHistory, persistSavedDesign, getSavedDesigns, updateSavedDesignMesh,
} from "@/api";
import { SCHEMA, buildPrompt, buildPromptAr, Category } from "@/configuratorSchema";
import { useSettings, t, tLabel } from "@/contexts/settings-context";
import { showToast } from "@/components/ui/custom-toast";
import { Download, RotateCcw, Maximize2, Shuffle, ImageDown, ThumbsUp, ThumbsDown, Save, Boxes, Loader2 } from "lucide-react";

// Tooltip CSS
const tooltipCSS = `
.color-tooltip-wrap:hover .color-tooltip { opacity: 1 !important; }
select option { background: var(--bg); color: var(--text); }
@media (max-width: 768px) { .ctrl-enter-hint { display: none !important; } }
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.img-skeleton {
  background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease infinite;
}
/* ChatGPT-style image-generation loader: a soft light sweep over the image slot. */
@keyframes genSweep { 0% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
@keyframes genPulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
.gen-loader {
  position: relative; width: 100%; height: 100%; overflow: hidden;
  background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.07));
  display: flex; align-items: center; justify-content: center;
}
.gen-loader::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(0,229,255,0.14), transparent);
  transform: translateX(-120%);
  animation: genSweep 1.7s ease-in-out infinite;
}
.gen-loader .gen-dot {
  width: 46px; height: 46px; border-radius: 14px;
  background: var(--cyan-glow-bg); border: 1px solid var(--cyan-glow-soft);
  display: flex; align-items: center; justify-content: center;
  color: var(--cyan-text); animation: genPulse 1.6s ease-in-out infinite; z-index: 1;
}
@media (max-width: 768px) {
  .color-field-grid { grid-template-columns: repeat(5, 1fr) !important; }
  .attr-field-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .category-tabs { flex-wrap: wrap !important; }
  .viewer-toolbar { flex-wrap: wrap !important; gap: 6px !important; }
  .viewer-footer { flex-direction: column !important; gap: 8px !important; }
  .viewer-footer > span { text-align: center !important; }
  .viewer-footer > div { width: 100% !important; justify-content: center !important; }
  .feedback-row { flex-direction: column !important; gap: 8px !important; align-items: stretch !important; }
  .feedback-row > span { text-align: center !important; }
  .feedback-row > div { justify-content: center !important; }
  .result-grid { grid-template-columns: 1fr !important; }
}
@media (max-width: 480px) {
  .attr-field-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .color-field-grid { grid-template-columns: repeat(4, 1fr) !important; }
}
`;

const LAST_RESULT_KEY = "holo3d_last_result";
const LAST_PROMPT_KEY = "holo3d_last_prompt";
const LAST_MESH_KEY   = "holo3d_last_mesh";
const LAST_CAT_KEY    = "holo3d_last_category";
const LAST_SEL_KEY    = "holo3d_last_selections";

type DownloadFormat = "glb" | "stl" | "obj";

interface LiveProgress {
  phase: "idle" | "generating" | "refining" | "converting_3d";
  step: number; totalSteps: number; elapsedSeconds: number;
  attempt: number; maxAttempts: number;
}
const INIT: LiveProgress = { phase: "idle", step: 0, totalSteps: 30, elapsedSeconds: 0, attempt: 1, maxAttempts: 2 };

// ── Radial Gauge ──────────────────────────────────────────────────────────────
function RadialGauge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{
      width: 64, height: 64, borderRadius: "50%", flexShrink: 0,
      background: `conic-gradient(#7C3AED 0% ${pct}%, var(--border) ${pct}% 100%)`,
      boxShadow: `0 0 20px var(--violet-glow)`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: "50%", background: "var(--bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, color: "var(--violet-text)",
      }}>{pct}%</div>
    </div>
  );
}

// ── Workers Building Animation ────────────────────────────────────────────────
// Canvas: 500×500 (square, matches output image container)
// Floor:  FL=380  — furniture sits on floor, workers stand on floor
const _WA_FURN: Record<string, {x:number;y:number;w:number;h:number}[]> = {
  sofa: [
    {x:75, y:210,w:350,h:72},  // back
    {x:75, y:280,w:350,h:74},  // seat
    {x:75, y:280,w:34, h:84},  // left arm
    {x:391,y:280,w:34, h:84},  // right arm
    {x:87, y:356,w:27, h:24},  // left leg
    {x:393,y:356,w:27, h:24},  // right leg
  ],
  armchair: [
    {x:150,y:210,w:200,h:75},  // back
    {x:150,y:283,w:200,h:68},  // seat
    {x:150,y:283,w:26, h:80},  // left arm
    {x:324,y:283,w:26, h:80},  // right arm
    {x:160,y:356,w:24, h:24},  // left leg
    {x:316,y:356,w:24, h:24},  // right leg
  ],
  "office chair": [
    {x:182,y:178,w:136,h:80},  // back
    {x:160,y:255,w:180,h:58},  // seat
    {x:230,y:313,w:40, h:44},  // pole
    {x:150,y:357,w:200,h:23},  // caster base
  ],
  "lounge chair": [
    {x:120,y:207,w:260,h:78},  // back
    {x:120,y:283,w:260,h:70},  // seat
    {x:120,y:283,w:26, h:82},  // left arm
    {x:354,y:283,w:26, h:82},  // right arm
    {x:130,y:355,w:26, h:25},  // left leg
    {x:344,y:355,w:26, h:25},  // right leg
  ],
  "gaming chair": [
    {x:153,y:170,w:194,h:90},  // high back
    {x:158,y:257,w:184,h:62},  // seat
    {x:158,y:257,w:24, h:72},  // left arm
    {x:318,y:257,w:24, h:72},  // right arm
    {x:205,y:318,w:90, h:32},  // base
    {x:158,y:350,w:184,h:30},  // casters spread
  ],
  table: [
    {x:55, y:218,w:390,h:26},  // top
    {x:70, y:244,w:24, h:136}, // left leg
    {x:406,y:244,w:24, h:136}, // right leg
    {x:82, y:316,w:336,h:14},  // stretcher
  ],
};
function _waRects(cat: Category, type?: string) {
  if (cat === "table") return _WA_FURN.table;
  if (cat === "sofa")  return _WA_FURN.sofa;
  return _WA_FURN[type ?? ""] ?? _WA_FURN.armchair;
}

function WorkersCanvas({ category, furnitureType }: { category: Category; furnitureType?: string }) {
  const cRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = cRef.current; if (!cv) return;
    const cx = cv.getContext("2d"); if (!cx) return;
    const W = 500, H = 500, FL = 380;
    cv.width = W; cv.height = H;

    const rects = _waRects(category, furnitureType);
    const targets: {x:number;y:number}[] = [];
    rects.forEach(r => {
      const cols = Math.max(1, Math.floor(r.w / 16));
      const rows = Math.max(1, Math.floor(r.h / 16));
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++)
          targets.push({ x: r.x + r.w / cols * (j + 0.5), y: r.y + r.h / rows * (i + 0.5) });
    });
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }

    const pcols = ["#f59e0b","#f97316","#ef4444","#10b981","#3b82f6","#8b5cf6","#ec4899","#06b6d4"];
    const hcols = ["#f59e0b","#10b981","#3b82f6","#f43f5e"];

    type P  = {x:number;y:number;vx:number;vy:number;r:number;c:string;st:"fall"|"settle"|"fly";tx:number;ty:number;fd:number;hit:boolean};
    type Wk = {x:number;y:number;vy:number;st:"fall"|"walk"|"work";tx:number;hc:string;ph:number;ta:number};

    const parts: P[]  = [];
    const wrks:  Wk[] = [];

    let scene = "fadein", sceneT = 0, alpha = 0;
    let t1x = -220, t2x = W + 220, outlineT = 0;

    function reset() {
      scene = "fadein"; sceneT = 0; alpha = 0;
      t1x = -220; t2x = W + 220; outlineT = 0;
      parts.length = 0; wrks.length = 0;
    }

    function drawTruck(x: number, dir: 1|-1, clr: string) {
      cx.save(); cx.translate(x, FL); if (dir === -1) cx.scale(-1, 1);
      cx.fillStyle = clr;            cx.fillRect(0, -52, 50, 52);
      cx.fillStyle = clr + "bb";     cx.fillRect(50, -68, 115, 68);
      cx.fillStyle = "rgba(180,230,255,0.65)"; cx.fillRect(7, -45, 30, 22);
      cx.fillStyle = "#111";
      [23, 90, 132].forEach(wx => {
        cx.beginPath(); cx.arc(wx, 7, 14, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = "#444"; cx.beginPath(); cx.arc(wx, 7, 7, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = "#111";
      });
      cx.restore();
    }

    function drawWorker(w: Wk) {
      const { x, y, st, ph, ta, hc } = w;
      const lph = st === "walk" ? Math.sin(ph) * 15 : 0;
      const aph = st === "walk" ? Math.sin(ph) * 0.35 : st === "work" ? Math.sin(ta) * 0.7 : 0;
      cx.fillStyle = "#4338ca"; cx.fillRect(x - 9, y - 36, 18, 24);
      cx.fillStyle = "#1e1b4b"; cx.fillRect(x - 8, y - 12, 8, 20); cx.fillRect(x, y - 12 + lph, 8, 20);
      cx.save(); cx.translate(x - 9, y - 32); cx.rotate(-aph);
      cx.fillStyle = "#6d28d9"; cx.fillRect(-14, 0, 14, 5); cx.restore();
      cx.save(); cx.translate(x + 9, y - 32); cx.rotate(aph);
      cx.fillStyle = "#6d28d9"; cx.fillRect(0, 0, 14, 5); cx.restore();
      cx.fillStyle = "#fcd34d"; cx.beginPath(); cx.arc(x, y - 42, 8, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = hc; cx.fillRect(x - 12, y - 47, 24, 7); cx.fillRect(x - 14, y - 42, 28, 4);
      if (st === "work") {
        cx.save(); cx.translate(x + 16, y - 30); cx.rotate(Math.sin(ta) * 0.5);
        cx.fillStyle = "#78716c"; cx.fillRect(0, -2, 20, 4);
        cx.fillStyle = "#a1a1aa"; cx.fillRect(17, -5, 8, 10);
        cx.restore();
        if (Math.random() < 0.08) {
          for (let s = 0; s < 3; s++) {
            cx.fillStyle = "#fde68a";
            cx.beginPath();
            cx.arc(x + 22 + Math.random() * 10, y - 30 + Math.random() * 10, 1.5, 0, Math.PI * 2);
            cx.fill();
          }
        }
      }
    }

    function drawWireframe() {
      if (outlineT <= 0) return;
      cx.save();
      rects.forEach((r, i) => {
        const t = Math.max(0, Math.min(1, (outlineT - (i / rects.length) * 0.65) / 0.35));
        if (t <= 0) return;
        cx.globalAlpha = alpha * t * 0.9;
        cx.strokeStyle = "#00e5ff"; cx.lineWidth = 1.5;
        cx.shadowColor = "#00e5ff"; cx.shadowBlur = 10;
        cx.strokeRect(r.x, r.y, r.w * t, r.h);
        cx.fillStyle = "rgba(0,229,255,0.04)";
        cx.fillRect(r.x, r.y, r.w * t, r.h);
      });
      cx.restore();
    }

    let raf = 0, last = performance.now();

    function loop(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      sceneT += dt;
      cx.clearRect(0, 0, W, H);

      cx.fillStyle = `rgba(6,10,20,${alpha})`; cx.fillRect(0, 0, W, H);

      // Floor grid
      cx.save(); cx.globalAlpha = alpha * 0.18; cx.strokeStyle = "rgba(0,229,255,0.5)"; cx.lineWidth = 0.5;
      for (let gx = 0; gx < W; gx += 32) { cx.beginPath(); cx.moveTo(gx, FL); cx.lineTo(gx, H); cx.stroke(); }
      for (let gy = FL; gy < H; gy += 18) { cx.beginPath(); cx.moveTo(0, gy); cx.lineTo(W, gy); cx.stroke(); }
      cx.restore();

      // Floor line
      cx.save(); cx.globalAlpha = alpha * 0.65;
      cx.strokeStyle = "rgba(0,229,255,0.8)"; cx.lineWidth = 1.5; cx.setLineDash([8, 5]);
      cx.beginPath(); cx.moveTo(0, FL); cx.lineTo(W, FL); cx.stroke();
      cx.setLineDash([]); cx.restore();

      // ── Scene state machine ──
      switch (scene) {
        case "fadein":
          alpha = Math.min(sceneT / 1.2, 1);
          if (sceneT > 1.2) { scene = "t1_enter"; sceneT = 0; }
          break;
        case "t1_enter":
          alpha = 1; t1x = Math.min(-220 + sceneT * 185, 30);
          if (t1x >= 30) { scene = "dump"; sceneT = 0; }
          break;
        case "dump": {
          const n = Math.min(Math.floor(sceneT * 9), Math.min(targets.length, 42));
          while (parts.length < n) {
            const i = parts.length;
            parts.push({ x: 95 + Math.random() * 85, y: FL - 78, vx: (Math.random() - .5) * 4.5, vy: -3.5 + Math.random() * 2,
              r: 4 + Math.random() * 4.5, c: pcols[i % pcols.length],
              st: "fall", tx: targets[i]?.x ?? 250, ty: targets[i]?.y ?? 280,
              fd: 0.5 + Math.random() * 38, hit: false });
          }
          if (sceneT > 2) t2x = Math.max(W + 220 - (sceneT - 2) * 165, W - 165);
          if (sceneT > 5.5) { scene = "land"; sceneT = 0; }
          break;
        }
        case "land":
          t2x = W - 165;
          if (wrks.length < 4) {
            const i = wrks.length;
            wrks.push({ x: t2x - 35 - i * 15, y: FL - 95 - i * 8, vy: 1.2, st: "fall",
              tx: 165 + i * 56, hc: hcols[i], ph: Math.random() * 6, ta: 0 });
          }
          if (sceneT > 2.8) { scene = "walk"; sceneT = 0; }
          break;
        case "walk":
          if (sceneT > 4) { scene = "assemble"; sceneT = 0; }
          break;
        case "assemble":
          outlineT = Math.min(sceneT / 46, 1);
          if (sceneT > 52) { scene = "done"; sceneT = 0; }
          break;
        case "done":
          outlineT = 1;
          if (sceneT > 5) { scene = "fadeout"; sceneT = 0; }
          break;
        case "fadeout":
          alpha = Math.max(1 - sceneT / 2, 0);
          if (sceneT > 2.5) reset();
          break;
      }

      // ── Physics ──
      parts.forEach(p => {
        if (p.st === "fall") {
          p.vy += 0.42; p.x += p.vx; p.y += p.vy;
          if (p.y > FL - p.r) {
            p.y = FL - p.r; p.vy *= -0.44; p.vx *= 0.84;
            if (Math.abs(p.vy) < 0.7) { p.vy = 0; if (Math.abs(p.vx) < 0.35) p.st = "settle"; }
          }
          p.x = Math.max(p.r, Math.min(W - p.r, p.x));
        } else if (p.st === "settle") {
          p.vx *= 0.89; p.x += p.vx;
          if (scene === "assemble" && sceneT > p.fd) p.st = "fly";
        } else if (p.st === "fly") {
          const dx = p.tx - p.x, dy = p.ty - p.y;
          if (dx * dx + dy * dy < 9) { p.x = p.tx; p.y = p.ty; p.hit = true; }
          else { p.x += dx * 0.1; p.y += dy * 0.1; }
        }
      });

      wrks.forEach(w => {
        if (w.st === "fall") {
          w.vy += 0.5; w.y += w.vy;
          if (w.y >= FL) { w.y = FL; w.vy *= -0.25; if (Math.abs(w.vy) < 1) { w.vy = 0; w.st = "walk"; } }
        } else if (w.st === "walk") {
          const dx = w.tx - w.x;
          if (Math.abs(dx) < 3) { w.x = w.tx; w.st = "work"; }
          else { w.x += Math.sign(dx) * 2; w.ph += dt * 5; }
        } else if (w.st === "work") {
          w.ta += dt * 3.5; w.ph += dt * 2.5;
          if (scene === "done") w.ta += dt * 2;
        }
      });

      // ── Draw ──
      cx.globalAlpha = alpha;
      if (t1x > -220) drawTruck(t1x, 1, "#f59e0b");
      if (t2x < W + 220) drawTruck(t2x, -1, "#7c3aed");

      parts.forEach(p => {
        cx.save(); cx.globalAlpha = alpha * (p.hit ? 0.2 : 1);
        cx.fillStyle = p.c; cx.shadowColor = p.c; cx.shadowBlur = 5;
        cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, Math.PI * 2); cx.fill();
        cx.restore();
      });

      drawWireframe();

      cx.globalAlpha = alpha;
      wrks.forEach(drawWorker);

      if (scene === "assemble" || scene === "done") {
        cx.save(); cx.globalAlpha = alpha * 0.5;
        cx.fillStyle = "#00e5ff"; cx.font = "11px 'JetBrains Mono',monospace";
        cx.fillText(`ASSEMBLING ${category.toUpperCase()}… ${Math.round(outlineT * 100)}%`, 16, 22);
        cx.restore();
      }

      cx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [category, furnitureType]);

  return (
    <canvas ref={cRef} style={{ width: "100%", height: "100%", display: "block", background: "#06080e" }} />
  );
}

// ── Wireframe Cube ────────────────────────────────────────────────────────────
function WireframeCube() {
  return (
    <div style={{ perspective: "800px", animation: "floaty 6s ease-in-out infinite" }}>
      <div style={{ width: 100, height: 100, position: "relative", transformStyle: "preserve-3d", animation: "spin3d 14s linear infinite" }}>
        {["translateZ(50px)", "rotateY(180deg) translateZ(50px)", "rotateY(90deg) translateZ(50px)", "rotateY(-90deg) translateZ(50px)", "rotateX(90deg) translateZ(50px)", "rotateX(-90deg) translateZ(50px)"].map((t, i) => (
          <div key={i} style={{ position: "absolute", width: 100, height: 100, border: `1px solid var(--cyan-glow)`, background: "var(--cyan-glow-bg)", boxShadow: "inset 0 0 20px rgba(0,229,255,0.1)", transform: t }} />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { language: lang } = useSettings();
  const [category, setCategory]         = useState<Category>("chair");
  const [selections, setSelections]     = useState<Record<string, string | string[]>>({});
  const [builtPrompt, setBuiltPrompt]   = useState("");
  const [result, setResult]             = useState<GenerateResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [isGen3D, setIsGen3D]           = useState(false);
  const [isStopping, setIsStopping]     = useState(false);
  const [showARModal, setShowARModal]   = useState(false);
  const [mesh, setMesh]                 = useState<MeshPaths | null>(null);
  const [meshSteps, setMeshSteps]           = useState(30);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCopied, setShareCopied]       = useState(false);
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  const [blueprintLoading, setBlueprintLoading] = useState(false);
  const [printScale, setPrintScale]     = useState(10);   // percent (10 = 1:10)
  const [printState, setPrintState]     = useState<"idle"|"loading"|"done"|"error">("idle");
  const [printResult, setPrintResult]   = useState<any>(null);
  const [meshDims, setMeshDims]         = useState<{w:number,d:number,h:number}|null>(null);
  const [dlFormat, setDlFormat]         = useState<DownloadFormat>("glb");
  const [progress, setProgress]         = useState<LiveProgress>(INIT);
  const [feedback, setFeedback]         = useState<"up" | "down" | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showEditPanel, setShowEditPanel]     = useState(false);
  const [editSelections, setEditSelections]   = useState<Record<string, string | string[]>>({});
  const [isEditing, setIsEditing]             = useState(false);
  const [editProgress, setEditProgress]       = useState<{ step: number; total: number } | null>(null);
  // Cache backendReady so navigating away doesn't flash "Connecting to AI..."
  const [backendReady, setBackendReady] = useState(() => sessionStorage.getItem("holo3d_backend_ok") === "1");
  const [backendChecking, setBackendChecking] = useState(() => sessionStorage.getItem("holo3d_backend_ok") !== "1");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number | null>(null);

  const isActive = isGenerating || isGen3D || isStopping;

  // Poll backend health — re-verify each mount but don't block if previously ready
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        const ready = await checkBackendReady();
        if (ready) {
          setBackendReady(true);
          setBackendChecking(false);
          sessionStorage.setItem("holo3d_backend_ok", "1");
          return;
        }
        // If we thought it was ready but it's not, update
        setBackendReady(false);
        setBackendChecking(true);
        sessionStorage.removeItem("holo3d_backend_ok");
        await new Promise(r => setTimeout(r, 3000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Check if a generation was interrupted
    const wasGenerating = localStorage.getItem("holo3d_is_generating");
    if (wasGenerating) {
      localStorage.removeItem("holo3d_is_generating");
      showToast({ title: "Generation interrupted", description: "Your previous generation didn't finish. Try again.", type: "info" });
    }

    const lp = localStorage.getItem("holo3d_load_prompt");
    const lc = localStorage.getItem("holo3d_load_category");
    const ls = localStorage.getItem("holo3d_load_selections");
    if (lp) {
      localStorage.removeItem("holo3d_load_prompt");
      localStorage.removeItem("holo3d_load_category");
      localStorage.removeItem("holo3d_load_selections");
      if (lc && ls) {
        try {
          setCategory(lc as Category);
          setSelections(JSON.parse(ls));
          // builtPrompt will be auto-rebuilt by the category+selections effect
        } catch {
          setBuiltPrompt(lp); // fallback: at least restore the raw prompt text
        }
      } else {
        setBuiltPrompt(lp);
      }
    } else {
      try {
        const r = localStorage.getItem(LAST_RESULT_KEY);
        const m = localStorage.getItem(LAST_MESH_KEY);
        const c = localStorage.getItem(LAST_CAT_KEY);
        const s = localStorage.getItem(LAST_SEL_KEY);
        if (r) setResult(JSON.parse(r));
        if (m) setMesh(JSON.parse(m));
        if (c) setCategory(c as Category);
        if (s) setSelections(JSON.parse(s));
      } catch {}
    }
  }, []);

  useEffect(() => { setBuiltPrompt(buildPrompt(category, selections)); }, [category, selections]);

  // Warn user before leaving during generation
  useEffect(() => {
    if (!isActive) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Design is still generating. Are you sure you want to leave?";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isActive]);

  // Inject tooltip CSS
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = tooltipCSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const startTimer = () => {
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setProgress(p => ({ ...p, elapsedSeconds: Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000) }));
    }, 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const handleCat = (cat: Category) => { setCategory(cat); setSelections({}); };
  // Conflict pairs — selecting one removes the other
  const conflicts: Record<string, string> = {
    "with wheels":    "without wheels",
    "without wheels": "with wheels",
    "metal legs":     "wood legs",
    "wood legs":      "metal legs",
  };

  const handleSelect = (key: string, value: string, multi?: boolean) => {
    setSelections(prev => {
      if (multi) {
        const cur = (prev[key] as string[] | undefined) ?? [];
        if (cur.includes(value)) {
          return { ...prev, [key]: cur.filter(v => v !== value) };
        }
        // Remove conflicting selection
        let next = [...cur, value];
        const conflictValue = conflicts[value];
        if (conflictValue) {
          next = next.filter(v => v !== conflictValue);
        }
        return { ...prev, [key]: next };
      }
      if (prev[key] === value) { const u = { ...prev }; delete u[key]; return u; }
      return { ...prev, [key]: value };
    });
  };
  const isSelected = (key: string, value: string) => {
    const s = selections[key];
    return Array.isArray(s) ? s.includes(value) : s === value;
  };

  // ── Edit mode helpers ──────────────────────────────────────────────────────
  const editMode = showEditPanel && !!result;

  const editIsSelected = (key: string, value: string) => {
    const s = editSelections[key];
    return Array.isArray(s) ? s.includes(value) : s === value;
  };

  const handleEditSel = (key: string, val: string, multi?: boolean) => {
    if (key === "type") return;
    setEditSelections(prev => {
      if (multi) {
        const cur = (prev[key] as string[] | undefined) ?? [];
        return { ...prev, [key]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] };
      }
      if (prev[key] === val) { const u = { ...prev }; delete u[key]; return u; }
      return { ...prev, [key]: val };
    });
  };

  const handleApplyEdit = async () => {
    if (!result?.ai_generated?.preview_url) return;

    // Build instruction-style prompt for InstructPix2Pix:
    // changed attrs → "change the color to black"
    // unchanged attrs → "keep the straight back style"
    const schema = SCHEMA[category];
    const fieldLabelMap: Record<string, string> = {
      color: "color", material: "material", back: "back style",
      shape: "shape", features: "features",
    };

    const changeParts: string[] = [];

    for (const field of schema.fields) {
      if (field.key === "type") continue;
      const label   = fieldLabelMap[field.key] ?? field.key;
      const origVal = selections[field.key];
      const editVal = editSelections[field.key];

      if (!editVal || (Array.isArray(editVal) && editVal.length === 0)) continue;
      if (JSON.stringify(origVal) === JSON.stringify(editVal)) continue;  // unchanged → skip

      const editStr = Array.isArray(editVal) ? editVal.join(" and ") : editVal;
      changeParts.push(`change the ${label} to ${editStr}`);
    }

    if (changeParts.length === 0) return;  // nothing changed → nothing to edit

    // FLUX Kontext edits best from a short, focused instruction: only the changes,
    // then one clause to preserve the rest. Listing every unchanged attribute
    // ("keep the with armrests"...) dilutes the edit and reads broken.
    const instructionPrompt = [...changeParts, "keep everything else the same", "product photo", "white background"].join(", ");
    // Short name for output filename
    const outputName = changeParts[0]?.slice(0, 50) ?? "edit";

    setIsEditing(true);
    setEditProgress(null);
    try {
      const edited = await editDesign(
        result.ai_generated.preview_url,
        instructionPrompt,
        outputName,
        (step, total) => setEditProgress({ step, total }),
      );
      const updatedResult = result
        ? { ...result, ai_generated: { ...result.ai_generated, preview_url: edited.preview_url } }
        : result;
      if (updatedResult) setResult(updatedResult);
      // Persist the edit into the base config so the schema reflects the new
      // state (e.g. color now shows "beige") instead of the original choices.
      // The next edit then compares against this updated state.
      const updatedSelections = { ...editSelections };
      setSelections(updatedSelections);
      // Persist the edited result + selections so a reopen shows the LATEST
      // version, not the original first generation.
      if (updatedResult) localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(updatedResult));
      localStorage.setItem(LAST_SEL_KEY, JSON.stringify(updatedSelections));
      setMesh(null);
      localStorage.removeItem(LAST_MESH_KEY);
      setShowEditPanel(false);
      showToast({ title: "Design refined!", type: "success" });
    } catch (e: unknown) {
      showToast({ title: "Edit failed", description: e instanceof Error ? e.message : "Error", type: "error" });
    } finally {
      setIsEditing(false);
      setEditProgress(null);
    }
  };

  const runGenerate = useCallback(async (seed?: number) => {
    if (!builtPrompt || isGenerating || isGen3D || isStopping) return;
    // Clear old results first
    setResult(null); setMesh(null); setFeedback(null); setShowFeedback(false);
    localStorage.removeItem(LAST_MESH_KEY);
    localStorage.removeItem("holo3d_3d_done");
    // FIX: clear stale flag before setting it again
    localStorage.removeItem("holo3d_is_generating");
    setIsGenerating(true);
    setProgress({ ...INIT, phase: "generating" });
    localStorage.setItem("holo3d_is_generating", "true");
    startTimer();
    try {
      const data = await generateDesign(builtPrompt, (ev: ProgressEvent) => {
        if (ev.type === "attempt_start") setProgress(p => ({ ...p, phase: ev.attempt === 1 ? "generating" : "refining", attempt: ev.attempt, maxAttempts: ev.max_attempts, step: 0 }));
        if (ev.type === "step") setProgress(p => ({ ...p, step: ev.step, totalSteps: ev.total_steps }));
      }, seed, meshSteps);
      stopTimer();
      setShowFeedback(true);
      setResult(data);
      setIsGenerating(false);
      setProgress(INIT);
      localStorage.removeItem("holo3d_is_generating");
      addToHistory(builtPrompt, category, selections);
      localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(data));
      localStorage.setItem(LAST_PROMPT_KEY, builtPrompt);
      localStorage.setItem(LAST_CAT_KEY, category);
      localStorage.setItem(LAST_SEL_KEY, JSON.stringify(selections));
    } catch (e: unknown) {
      stopTimer(); setIsGenerating(false); setProgress(INIT);
      localStorage.removeItem("holo3d_is_generating");
      // Don't show error if user stopped it
      const msg = e instanceof Error ? e.message : "Error";
      if (msg !== "__aborted__") {
        showToast({ title: "Generation failed", description: msg, type: "error" });
      }
    }
  }, [builtPrompt, category, selections, meshSteps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Enter shortcut
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !isActive && builtPrompt && backendReady) {
        runGenerate();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isActive, builtPrompt, backendReady, runGenerate]);

  const handleDownload2D = async () => {
    if (!result?.ai_generated?.preview_url) return;
    const url = getImageUrl(result.ai_generated.preview_url);
    const safe = builtPrompt.replace(/[^a-z0-9]/gi, "_").slice(0, 60);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Image not found");
      const blob = await res.blob();
      const bu = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = bu; a.download = `${safe}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(bu);
    } catch { window.open(url, "_blank"); }
  };

  const handleGen3D = async () => {
    if (!result?.ai_generated?.preview_url || isGen3D || isGenerating) return;
    setIsGen3D(true); setProgress({ ...INIT, phase: "converting_3d" }); startTimer();
    try {
      const data = await generate3D(builtPrompt, result.ai_generated.preview_url, meshSteps);
      stopTimer(); setMesh(data.mesh);
      localStorage.setItem(LAST_MESH_KEY, JSON.stringify(data.mesh));
      localStorage.setItem("holo3d_3d_done", "1");
      setProgress(INIT);
      // FIX: update saved design with mesh if it was already saved
      const saved = getSavedDesigns();
      const existingIdx = saved.findIndex(d => d.prompt === builtPrompt);
      if (existingIdx >= 0) {
        updateSavedDesignMesh(saved[existingIdx].id, data.mesh);
      }
      showToast({ title: "3D model ready!", type: "success" });
    } catch (e: unknown) {
      stopTimer(); setProgress(INIT);
      showToast({ title: "3D generation failed", description: e instanceof Error ? e.message : "Error", type: "error" });
    } finally { setIsGen3D(false); }
  };

  const handleSave = async (fromFeedback = false) => {
    if (!result?.ai_generated?.preview_url || !builtPrompt) return;

    // Duplicate check — avoid saving the *same* design twice. Match on prompt
    // AND image, so a new variation (same prompt, different image) can still be
    // saved instead of being silently rejected.
    const previewUrl = result.ai_generated.preview_url;
    const alreadySaved = getSavedDesigns().some(d => d.prompt === builtPrompt && d.preview_url === previewUrl);
    if (alreadySaved) {
      // When called from "Love it", silently close feedback instead of showing a toast
      if (fromFeedback) { setShowFeedback(false); return; }
      showToast({ title: "Already saved", description: "This design is already in your collection.", type: "info" });
      return;
    }

    setIsSaving(true);
    try {
      const data = await saveDesign(builtPrompt, result.ai_generated.preview_url);
      // Backend may return already_saved:true if DB has it but localStorage didn't
      if ((data as { already_saved?: boolean }).already_saved) {
        persistSavedDesign({ id: data.design_id, prompt: builtPrompt, preview_url: result.ai_generated.preview_url!, savedAt: new Date().toISOString(), mesh: mesh ?? undefined });
        if (!fromFeedback) showToast({ title: "Already saved", description: "This design is already in your collection.", type: "info" });
        setShowFeedback(false);
        return;
      }
      persistSavedDesign({ id: data.design_id, prompt: builtPrompt, preview_url: result.ai_generated.preview_url!, savedAt: new Date().toISOString(), mesh: mesh ?? undefined });
      showToast({ title: "Design saved!", type: "success" });
    } catch (e: unknown) {
      showToast({ title: "Save failed", description: e instanceof Error ? e.message : "Error", type: "error" });
    } finally { setIsSaving(false); }
  };

  const handleDl3D = () => {
    if (!mesh) return;
    const safeName = builtPrompt.replace(/[^a-z0-9]/gi, "_").slice(0, 60) || "model";
    const a = document.createElement("a"); a.href = getImageUrl(mesh[dlFormat]); a.download = `${safeName}.${dlFormat}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ── Paper Blueprint ─────────────────────────────────────────────────────────
  // Capture the 3D model from several angles, convert each to a pencil sketch on
  // white paper, and open a print-ready page → the user's real (paper) printer.
  const sketchEdges = (img: HTMLImageElement, size = 640): string => {
    const c = document.createElement("canvas"); c.width = size; c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const src = ctx.getImageData(0, 0, size, size);
    const gray = new Float32Array(size * size);
    for (let i = 0; i < gray.length; i++)
      gray[i] = 0.299 * src.data[i*4] + 0.587 * src.data[i*4+1] + 0.114 * src.data[i*4+2];
    // Sobel edge detection → dark contour lines on white paper (blueprint/pencil).
    const out = ctx.createImageData(size, size);
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = 255; out.data[i+1] = 255; out.data[i+2] = 255; out.data[i+3] = 255;
    }
    const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        let sx = 0, sy = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const v = gray[(y + dy) * size + (x + dx)];
            sx += v * gxK[k]; sy += v * gyK[k]; k++;
          }
        const mag = Math.sqrt(sx * sx + sy * sy);
        // Flat areas stay pure white; edges become dark pencil lines.
        const val = mag < 18 ? 255 : Math.max(0, 255 - (mag - 18) * 1.6);
        const idx = (y * size + x) * 4;
        out.data[idx] = val; out.data[idx+1] = val; out.data[idx+2] = val; out.data[idx+3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    return c.toDataURL("image/png");
  };

  const handleBlueprint = async () => {
    if (!mesh?.glb) { showToast({ title: "Generate the 3D model first", type: "error" }); return; }
    setBlueprintLoading(true);
    const mv = document.createElement("model-viewer") as HTMLElement & Record<string, unknown>;
    try {
      mv.setAttribute("src", getImageUrl(mesh.glb));
      // eager + auto reveal: the element is off-screen (hidden), so the default
      // lazy loading would never trigger → 'load' never fires → timeout.
      mv.setAttribute("loading", "eager");
      mv.setAttribute("reveal", "auto");
      mv.setAttribute("environment-image", "neutral");
      mv.setAttribute("shadow-intensity", "0");
      mv.setAttribute("exposure", "1.15");
      mv.setAttribute("disable-zoom", "");
      mv.setAttribute("interpolation-decay", "0");  // camera jumps instantly to each orbit
      mv.style.cssText = "position:fixed;left:-9999px;top:0;width:640px;height:640px;background:#fff;";
      document.body.appendChild(mv);
      await new Promise<void>((res, rej) => {
        mv.addEventListener("load", () => res(), { once: true });
        setTimeout(() => rej(new Error("3D model load timed out")), 20000);
      });
      const angles = [
        { name: "Front",       orbit: "0deg 90deg 105%"  },
        { name: "Side",        orbit: "90deg 90deg 105%" },
        { name: "Top",         orbit: "0deg 1deg 115%"   },
        { name: "Perspective", orbit: "35deg 65deg 110%" },
      ];
      const shots: { name: string; url: string }[] = [];
      for (const a of angles) {
        mv.setAttribute("camera-orbit", a.orbit);
        (mv as { jumpCameraToGoal?: () => void }).jumpCameraToGoal?.();
        await new Promise(r => setTimeout(r, 800));
        const dataUrl = (mv as { toDataURL: (t: string) => string }).toDataURL("image/png");
        const im = new Image();
        await new Promise<void>(res => { im.onload = () => res(); im.src = dataUrl; });
        shots.push({ name: a.name, url: sketchEdges(im) });
      }
      const title = (builtPrompt || "Furniture Blueprint").slice(0, 90);
      const win = window.open("", "_blank");
      if (!win) throw new Error("Popup blocked — allow popups to print");
      win.document.write(`<!doctype html><html><head><title>${title}</title><style>
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; color: #111; margin: 0; }
        h1 { font-size: 15px; letter-spacing: 2px; text-transform: uppercase; border-bottom: 2px solid #111; padding-bottom: 6px; margin: 0 0 6mm; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
        .cell { border: 1px solid #111; padding: 6px; text-align: center; }
        .cell img { width: 100%; height: auto; display: block; }
        .cell .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-top: 5px; }
        .foot { margin-top: 8mm; font-size: 10px; color: #555; display: flex; justify-content: space-between; }
      </style></head><body>
        <h1>${title}</h1>
        <div class="grid">
          ${shots.map(s => `<div class="cell"><img src="${s.url}"/><div class="label">${s.name}</div></div>`).join("")}
        </div>
        <div class="foot"><span>Holo3D — Wood Factory</span><span>${new Date().toLocaleDateString()}</span></div>
        <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); };</script>
      </body></html>`);
      win.document.close();
    } catch (e) {
      showToast({ title: "Blueprint failed", description: e instanceof Error ? e.message : "Error", type: "error" });
    } finally {
      try { document.body.removeChild(mv); } catch { /* already gone */ }
      setBlueprintLoading(false);
    }
  };

  const handlePrintExport = async () => {
    if (!mesh) return;
    setPrintState("loading");
    setPrintResult(null);
    try {
      const res = await fetch("/api/generate-gcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mesh_path:    mesh.stl,
          width:        meshDims?.w ?? 1800,
          depth:        meshDims?.d ?? 900,
          height:       meshDims?.h ?? 850,
          scale_factor: printScale / 100,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Export failed");
      setPrintState("done");
      setPrintResult(json);
    } catch (err: any) {
      setPrintState("error");
      setPrintResult({ error: err.message });
    }
  };

  const handleNew = () => {
    stopTimer();
    setResult(null); setMesh(null); setSelections({});
    setBuiltPrompt(""); setProgress(INIT); setFeedback(null); setShowFeedback(false);
    [LAST_RESULT_KEY, LAST_PROMPT_KEY, LAST_MESH_KEY, LAST_CAT_KEY, LAST_SEL_KEY].forEach(k => localStorage.removeItem(k));
  };

  const pct = progress.totalSteps > 0 ? Math.round((progress.step / progress.totalSteps) * 100) : 0;
  const schema = SCHEMA[category];

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  return (
    <div style={{ width: "100%" }}>

      {/* ── HERO ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ marginBottom: "32px" }}>
        <div style={{ ...mono, fontSize: "11px", letterSpacing: "4px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "12px" }}>
          {t("home_studio", lang)}
        </div>
        <h1 style={{ ...sg, fontWeight: 700, fontSize: "clamp(32px,4vw,54px)", lineHeight: 1.05, letterSpacing: "-1.5px", margin: "0 0 10px" }}>
          {t("home_configure", lang)}<br />
          <span className="grad-text animate-grad">{t("home_craft", lang)}</span>
        </h1>
        <p style={{ color: "var(--text-dim)", fontSize: "15px", lineHeight: 1.6, margin: 0, maxWidth: "500px" }}>
          {t("home_select_attrs", lang)}
        </p>
      </motion.div>

      {/* ── STEP 1: CONFIGURATOR ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>

        {/* Step label */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <div style={{ width: "22px", height: "22px", borderRadius: "50%",
            background: editMode ? "var(--violet-glow-soft)" : isActive ? "var(--border)" : "var(--cyan-glow-soft)",
            border: `1px solid ${editMode ? "var(--violet-glow)" : "var(--cyan-glow)"}`,
            display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: "10px",
            color: editMode ? "var(--violet-text)" : "var(--cyan-text)", fontWeight: 700 }}>1</div>
          <span style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: editMode ? "var(--violet-text)" : "var(--text-mono)", textTransform: "uppercase" }}>
            {editMode ? "✏️ Edit Mode — change attributes, keep structure" : t("home_step_configure", lang)}
          </span>
          {!isActive && !editMode && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              <button onClick={() => setSelections({})} className="hbtn hbtn-sm hbtn-secondary">
                <RotateCcw size={13} /> {t("home_reset", lang)}
              </button>
              {result && (
                <button onClick={handleNew} className="hbtn hbtn-sm hbtn-ghost">
                  {t("home_start_over", lang)}
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{
          background: "var(--surface)",
          backdropFilter: "blur(20px)",
          border: editMode ? "1px solid var(--violet-glow)" : "1px solid var(--border)",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: editMode
            ? "0 20px 60px var(--shadow-heavy), 0 0 0 1px var(--violet-glow-soft), inset 0 1px 0 var(--surface)"
            : "0 20px 60px var(--shadow-heavy), inset 0 1px 0 var(--surface)",
          marginBottom: "16px",
          opacity: isActive ? 0.6 : 1,
          transition: "all 0.3s",
        }}>
          {/* Category tabs */}
          <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--text-mono)", textTransform: "uppercase", marginBottom: "12px" }}>{t("home_object_class", lang)}</div>
          <div className="category-tabs" style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
            {(["chair", "sofa", "table"] as Category[]).map(cat => (
              <motion.button key={cat} whileHover={{ scale: editMode ? 1 : 1.03 }} whileTap={{ scale: editMode ? 1 : 0.97 }}
                onClick={() => !isActive && !editMode && handleCat(cat)} disabled={isActive || editMode}
                style={{
                  padding: "9px 22px", borderRadius: "999px", cursor: editMode ? "default" : "pointer",
                  fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "13px",
                  transition: "all 0.25s ease",
                  background: category === cat ? `linear-gradient(135deg, var(--cyan-glow-soft), var(--violet-glow-soft))` : "var(--surface)",
                  border: category === cat ? `1px solid var(--cyan-glow)` : "1px solid var(--border)",
                  color: category === cat ? "var(--cyan-text)" : "var(--text-dim)",
                  boxShadow: category === cat ? `0 0 20px var(--cyan-glow-soft)` : "none",
                  opacity: editMode && category !== cat ? 0.4 : 1,
                }}>
                {tLabel(SCHEMA[cat].label, lang)}
              </motion.button>
            ))}
          </div>

          {/* Attributes */}
          {schema.fields.filter(field =>
            !field.hideForTypes?.includes((editMode ? editSelections : selections)["type"] as string)
          ).map(field => {
            const isLocked   = editMode && field.key === "type";
            const isColorField = field.key === "color" || field.key === "material_color";
            const activeType = (editMode ? editSelections : selections)["type"] as string;
            const visibleOptions = field.options.filter(opt =>
              !opt.hideForTypes?.includes(activeType)
            );
            return (
            <div key={field.key} style={{ marginBottom: "18px" }}>
              <div style={{ ...mono, fontSize: "10px", letterSpacing: "2.5px", color: isLocked ? "var(--violet-text)" : "var(--text-mono)", textTransform: "uppercase", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
                {tLabel(field.label, lang)}{field.multi && !isLocked && <span style={{ opacity: 0.5 }}> · multi</span>}
                {isLocked && <span style={{ fontSize: "9px", background: "var(--violet-glow-soft)", color: "var(--violet-text)", padding: "1px 6px", borderRadius: "4px" }}>locked</span>}
              </div>
              <div
                className={isColorField ? "color-field-grid" : "attr-field-grid"}
                style={{
                  display: "grid",
                  gridTemplateColumns: isColorField
                    ? `repeat(${Math.min(visibleOptions.length, 10)}, 1fr)`
                    : `repeat(${visibleOptions.length}, 1fr)`,
                  gap: "6px"
                }}>
                {visibleOptions.map(opt => {
                  const selected = editMode ? editIsSelected(field.key, opt.value) : isSelected(field.key, opt.value);
                  const colorMap: Record<string, string> = {
                    white: "#f5f5f0", beige: "#d4b896", gray: "#8a8a8a", brown: "#6b4226",
                    black: "#222222", blue: "#3b82f6", green: "#22c55e", red: "#ef4444",
                    orange: "#f97316", pink: "#ec4899", tan: "#c4a882", navy: "#1e3a5f",
                    walnut: "#5c3317", oak: "#c8a96e", pine: "#d4a85a", ash: "#d0c8b8",
                  };
                  const colorKey = opt.value.toLowerCase();
                  const actualColor = colorMap[colorKey];

                  if (isColorField && actualColor) {
                    return (
                      <div key={opt.value} className="color-tooltip-wrap" style={{ position: "relative" }}>
                        <motion.button
                          whileHover={{ scale: isLocked ? 1 : 1.08, y: isLocked ? 0 : -2 }} whileTap={{ scale: isLocked ? 1 : 0.95 }}
                          onClick={() => editMode ? (!isLocked && handleEditSel(field.key, opt.value, field.multi)) : (!isActive && handleSelect(field.key, opt.value, field.multi))}
                          disabled={isActive || isLocked}
                          title={tLabel(opt.label, lang)}
                          style={{
                            width: "100%", height: "38px", borderRadius: "8px", cursor: "pointer",
                            background: actualColor,
                            border: selected ? `2px solid var(--cyan-text)` : "2px solid rgba(255,255,255,0.1)",
                            boxShadow: selected
                              ? `0 0 0 3px var(--cyan-glow-soft), 0 4px 14px ${actualColor}60`
                              : `0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)`,
                            transition: "all 0.2s ease",
                            position: "relative",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                          {selected && (
                            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5"
                                stroke={["white","beige","tan","ash","oak","pine"].includes(colorKey) ? "#000" : "#fff"}
                                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </motion.button>
                        {/* Tooltip */}
                        <div style={{
                          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
                          transform: "translateX(-50%)",
                          background: "var(--bg)", border: "1px solid var(--border)",
                          borderRadius: "6px", padding: "3px 8px",
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "10px",
                          color: "var(--text)", whiteSpace: "nowrap",
                          pointerEvents: "none", opacity: 0,
                          transition: "opacity 0.15s",
                          zIndex: 50,
                        }}
                        className="color-tooltip">
                          {tLabel(opt.label, lang)}
                        </div>
                      </div>
                    );
                  }

                  // Regular buttons — fill width equally
                  return (
                    <motion.button key={opt.value}
                      whileHover={{ y: isLocked ? 0 : -1 }} whileTap={{ scale: isLocked ? 1 : 0.97 }}
                      onClick={() => editMode ? (!isLocked && handleEditSel(field.key, opt.value, field.multi)) : (!isActive && handleSelect(field.key, opt.value, field.multi))}
                      disabled={isActive || isLocked}
                      style={{
                        flex: 1, minWidth: "fit-content",
                        padding: "9px 12px", borderRadius: "9px",
                        cursor: isLocked ? "default" : "pointer",
                        fontFamily: "Manrope, sans-serif", fontWeight: 600, fontSize: "12px",
                        transition: "all 0.2s ease",
                        background: selected ? (isLocked ? "var(--violet-glow-bg)" : "var(--cyan-glow-bg)") : "var(--surface)",
                        border: selected ? (isLocked ? "1px solid var(--violet-glow)" : `1px solid var(--cyan-glow)`) : "1px solid var(--border)",
                        color: selected ? (isLocked ? "var(--violet-text)" : "var(--cyan-text)") : "var(--text-dim)",
                        boxShadow: selected ? (isLocked ? "0 0 14px var(--violet-glow-soft)" : `0 0 14px var(--cyan-glow-soft)`) : "none",
                        textAlign: "center",
                      }}>
                      {tLabel(opt.label, lang)}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ); })}

          {/* Prompt preview */}
          {(editMode ? buildPrompt(category, editSelections) : builtPrompt) && (
            <div style={{ ...mono, background: "var(--surface)", border: `1px solid ${editMode ? "var(--violet-glow-soft)" : "var(--border)"}`, borderRadius: "10px", padding: "10px 14px", fontSize: "11px", color: editMode ? "var(--violet-text)" : "var(--cyan-text-dim)", lineHeight: 1.6, marginTop: "4px", direction: lang === "ar" ? "rtl" : "ltr" }}>
              {editMode ? buildPrompt(category, editSelections) : (lang === "ar" ? buildPromptAr(category, selections) : builtPrompt)}
            </div>
          )}
        </div>

        {/* Generate / Edit actions */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", marginBottom: "28px" }}>

          {/* ── Edit mode buttons ── */}
          {editMode && (
            <>
              <motion.button
                className="hbtn hbtn-lg"
                whileHover={!isEditing ? { translateY: -2 } : {}}
                whileTap={!isEditing ? { scale: 0.98 } : {}}
                disabled={isEditing || !buildPrompt(category, editSelections)}
                onClick={handleApplyEdit}
                style={{
                  flex: 1,
                  background: "linear-gradient(135deg, var(--violet-glow-soft), rgba(124,58,237,0.5))",
                  border: "1px solid var(--violet-glow)", color: "var(--violet-text)",
                  boxShadow: "0 0 28px var(--violet-glow-soft)",
                }}>
                {isEditing ? <><Loader2 size={16} className="animate-spin" /> {editProgress ? `Refining… ${editProgress.step}/${editProgress.total}` : "Refining…"}</> : "✨ Apply Edit"}
              </motion.button>
              <button
                onClick={() => setShowEditPanel(false)}
                disabled={isEditing}
                className="hbtn hbtn-lg hbtn-secondary">
                Cancel
              </button>
            </>
          )}

          {/* ── Normal generate buttons ── */}
          {!editMode && !isActive && backendReady && (
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => {
                const schema = SCHEMA[category];
                const newSel: Record<string, string | string[]> = {};
                // Pick type first so hideForTypes filtering works correctly
                const typeField = schema.fields.find(f => f.key === "type");
                if (typeField) {
                  const pick = typeField.options[Math.floor(Math.random() * typeField.options.length)];
                  newSel["type"] = pick.value;
                }
                schema.fields.filter(f =>
                  f.key !== "type" && !f.hideForTypes?.includes(newSel["type"] as string)
                ).forEach(field => {
                  if (field.multi) {
                    const count = Math.floor(Math.random() * 2) + 1;
                    const shuffled = [...field.options].sort(() => Math.random() - 0.5);
                    const picked = shuffled.slice(0, count).map(o => o.value);
                    // Remove conflicts
                    const clean = picked.filter(v => !picked.includes(conflicts[v] || ""));
                    newSel[field.key] = clean;
                  } else {
                    const pick = field.options[Math.floor(Math.random() * field.options.length)];
                    newSel[field.key] = pick.value;
                  }
                });
                setSelections(newSel);
              }}
              className="hbtn hbtn-violet">
              🎲 {t("home_surprise", lang)}
            </motion.button>
          )}

          {/* Stop button during generation */}
          {!editMode && isActive && (
            <motion.button whileHover={!isStopping ? { scale: 1.05 } : {}} whileTap={!isStopping ? { scale: 0.95 } : {}}
              disabled={isStopping}
              onClick={() => {
                if (isStopping) return;
                // Set visual state immediately (synchronous) for mobile responsiveness
                setIsStopping(true);
                setIsGenerating(false);
                setIsGen3D(false);
                stopTimer();
                setProgress(INIT);
                localStorage.removeItem("holo3d_is_generating");
                // Fire backend stop in background — no need to await on mobile
                abortGeneration().catch(() => {});
                // Reset stopping state after short delay (GPU finishes current step)
                setTimeout(() => setIsStopping(false), 3000);
              }}
              className="hbtn hbtn-danger"
              style={{
                background: isStopping ? "rgba(239,68,68,0.05)" : "rgba(239,68,68,0.1)",
                color: isStopping ? "var(--error-text)" : "var(--error-text-soft)",
              }}>
              {isStopping ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" style={{ animation: "spin3d 1s linear infinite" }}>
                    <circle cx="6" cy="6" r="5" fill="none" stroke="rgba(252,165,165,0.5)" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
                  </svg>
                  {t("home_stopping", lang)}
                </>
              ) : `⏹ ${t("home_stop", lang)}`}
            </motion.button>
          )}

          {/* Image Quality selector */}
          {!editMode && <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{
              display: "flex", gap: "3px", padding: "3px",
              background: "var(--surface)", borderRadius: "12px",
              border: "1px solid var(--border)",
            }}>
              {[
                { steps: 20, label: "Fast",     speed: "faster"   },
                { steps: 30, label: "Balanced", speed: "balanced"  },
                { steps: 40, label: "Detailed", speed: "slower"    },
              ].map(o => {
                const active = meshSteps === o.steps;
                return (
                  <motion.button
                    key={o.steps}
                    onClick={() => setMeshSteps(o.steps)}
                    disabled={isActive}
                    animate={{
                      background: active ? "var(--cyan-glow-bg)" : "transparent",
                      borderColor: active ? "var(--cyan-glow)" : "transparent",
                    }}
                    whileHover={!isActive ? { background: active ? "var(--cyan-glow-bg)" : "rgba(255,255,255,0.04)" } : {}}
                    whileTap={!isActive ? { scale: 0.97 } : {}}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    style={{
                      flex: 1, padding: "8px 6px", borderRadius: "9px",
                      border: "1px solid transparent",
                      cursor: isActive ? "not-allowed" : "pointer", textAlign: "center",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
                    }}>
                    <div style={{ ...sg, fontSize: "12px", fontWeight: 700,
                      color: active ? "var(--cyan-text)" : "var(--text)",
                      transition: "color 0.18s" }}>
                      {o.label}
                    </div>
                    <motion.div
                      animate={{ color: active ? "var(--cyan-text-dim)" : "var(--text-mono)", opacity: active ? 1 : 0.45 }}
                      transition={{ duration: 0.18 }}
                      style={{ ...mono, fontSize: "9px" }}>
                      {o.speed}
                    </motion.div>
                  </motion.button>
                );
              })}
            </div>
          </div>}

          {!editMode && <motion.button whileHover={(!isActive && backendReady) ? { translateY: -2 } : {}} whileTap={(!isActive && backendReady) ? { scale: 0.98 } : {}}
            onClick={() => runGenerate()} disabled={isActive || !backendReady}
            className="hbtn hbtn-lg"
            style={{
              flex: 1,
              background: backendReady
                ? "linear-gradient(135deg, #00E5FF, #3df2ff)"
                : "linear-gradient(135deg, rgba(0,229,255,0.3), rgba(0,229,255,0.15))",
              boxShadow: backendReady
                ? `0 0 28px var(--cyan-glow), 0 6px 24px var(--cyan-glow-soft)`
                : "none",
              border: "none", color: backendReady ? "#021018" : "rgba(2,16,24,0.5)",
              opacity: isActive ? 0.5 : 1,
              position: "relative", overflow: "hidden",
            }}>
            {/* Loading fill animation when waiting for backend */}
            {!backendReady && (
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                background: "linear-gradient(135deg, #00E5FF, #3df2ff)",
                animation: "pulse 2s ease-in-out infinite",
                opacity: 0.4, width: "100%",
              }} />
            )}
            <span style={{ position: "relative", zIndex: 1 }}>
              {!backendReady ? (backendChecking ? t("home_connecting", lang) : t("home_loading_models", lang)) : isGenerating ? t("home_synthesizing", lang) : t("home_generate_design", lang)}
            </span>
          </motion.button>}

          {!editMode && result && !isActive && (
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => runGenerate(Math.floor(Math.random() * 999999))}
              className="hbtn hbtn-secondary">
              <Shuffle size={13} /> {t("home_variation", lang)}
            </motion.button>
          )}
        </div>
      </motion.div>

      {/* Keyboard shortcut hint — desktop only */}
      {!editMode && !isActive && (
        <div className="ctrl-enter-hint" style={{
          width: "100%", padding: "12px", borderRadius: "12px",
          background: "var(--cyan-glow-bg)", border: `1px solid var(--cyan-glow-soft)`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: "var(--cyan-glow)",
          marginBottom: "16px",
        }}>
          {t("home_or_press", lang)}
          <kbd style={{ padding: "4px 10px", borderRadius: "6px", background: "var(--cyan-glow-soft)", border: `1px solid var(--cyan-glow)`, fontSize: "12px", color: "var(--cyan-text)", fontWeight: 700 }}>Ctrl</kbd>
          <span style={{ color: "var(--text-mono)" }}>+</span>
          <kbd style={{ padding: "4px 10px", borderRadius: "6px", background: "var(--cyan-glow-soft)", border: `1px solid var(--cyan-glow)`, fontSize: "12px", color: "var(--cyan-text)", fontWeight: 700 }}>Enter</kbd>
          <span style={{ color: "var(--text-mono)" }}>{t("home_to_generate", lang)}</span>
        </div>
      )}

      {/* ── STEP 2: PROGRESS ── */}
      <AnimatePresence>
        {(isGenerating || isStopping) && (
          <motion.div
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.3 }}
            style={{ marginBottom: "28px" }}>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
              <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--cyan-glow-soft)", border: `1px solid var(--cyan-glow)`, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: "10px", color: "var(--cyan-text)", fontWeight: 700 }}>2</div>
              <span style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--text-mono)", textTransform: "uppercase" }}>
                {progress.phase === "converting_3d" ? t("home_building_3d", lang) : progress.phase === "refining" ? t("home_refining", lang) : t("home_generating", lang)}
              </span>
              <span style={{ ...mono, fontSize: "11px", color: "var(--cyan-text-dim)", marginLeft: "auto" }}>{progress.elapsedSeconds}s</span>
            </div>

            <div style={{ background: "var(--cyan-glow-bg)", border: `1px solid var(--cyan-glow-soft)`, borderRadius: "16px", padding: "20px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ ...sg, fontWeight: 600, fontSize: "14px", color: "var(--cyan-text)" }}>
                  {progress.phase === "converting_3d" ? t("home_building_3d_geo", lang) : progress.phase === "refining" ? t("home_refining_quality", lang) : t("home_synth_blueprint", lang)}
                </div>
                {progress.phase !== "converting_3d" && progress.step > 0 && (
                  <div style={{ ...mono, fontSize: "11px", color: "var(--text-mono)" }}>
                    {progress.step}/{progress.totalSteps} {t("home_steps", lang)}
                  </div>
                )}
              </div>
              <div style={{ height: "6px", borderRadius: "999px", background: "var(--surface)", overflow: "hidden", position: "relative" }}>
                <motion.div
                  animate={{ width: progress.phase === "converting_3d" ? `${Math.min(progress.elapsedSeconds * 1.5, 95)}%` : `${pct}%` }}
                  transition={{ duration: 0.5 }}
                  style={{ height: "100%", borderRadius: "999px", background: "linear-gradient(90deg, #00E5FF, #7C3AED)", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, bottom: 0, width: "60px", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)", animation: "scanline 1.5s ease infinite" }} />
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── STEP 3: RESULTS ── */}
      <AnimatePresence>
        {(isGenerating || isStopping || !!result) && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>

            {/* Step label — only when result exists */}
            {result && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--cyan-glow-soft)", border: `1px solid var(--cyan-glow)`, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: "10px", color: "var(--cyan-text)", fontWeight: 700 }}>3</div>
                <span style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--text-mono)", textTransform: "uppercase" }}>{t("home_step_results", lang)}</span>
              </div>
            )}

            {/* Quick Feedback */}
            <AnimatePresence>
              {showFeedback && !feedback && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="feedback-row"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderRadius: "12px", background: "var(--surface)", border: "1px solid var(--border)", marginBottom: "16px" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>{t("home_how_design", lang)}</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <motion.button whileHover={{ scale: 1.05 }} onClick={() => { setFeedback("up"); handleSave(true); }}
                      className="hbtn hbtn-sm hbtn-accent">
                      <ThumbsUp size={12} /> {t("home_love_it", lang)}
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.05 }} onClick={() => {
                        setFeedback("down");
                        // Auto-improve: regenerate with a different seed
                        runGenerate(Math.floor(Math.random() * 999999));
                      }}
                      className="hbtn hbtn-sm hbtn-danger">
                      <ThumbsDown size={12} /> {t("home_regenerate", lang)}
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* AI Blueprint + Factory Match */}
            <div className="result-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px", marginBottom: "16px" }}>

              {/* AI Blueprint */}
              <div style={{ background: "var(--surface)", border: `1px solid var(--cyan-glow-soft)`, borderRadius: "18px", overflow: "hidden", boxShadow: `0 0 24px var(--cyan-glow-bg)` }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#00E5FF", boxShadow: "0 0 8px #00E5FF" }} />
                  <span style={{ ...sg, fontWeight: 600, fontSize: "15px" }}>{t("home_ai_blueprint", lang)}</span>
                  {result && (
                    <span style={{ ...mono, fontSize: "10px", padding: "2px 8px", borderRadius: "999px", background: "var(--cyan-glow-soft)", border: `1px solid var(--cyan-glow-soft)`, color: "var(--cyan-text)", marginLeft: "auto" }}>
                      {result.ai_generated.status}
                    </span>
                  )}
                  {(isGenerating || isStopping) && !result && (
                    <span style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", marginLeft: "auto" }}>
                      generating…
                    </span>
                  )}
                </div>
                {/* Image slot — always visible; shows animation during generation */}
                <div style={{ aspectRatio: "1", background: "rgba(0,0,0,0.3)", overflow: "hidden", position: "relative" }}>
                  {(isGenerating || isStopping) && !result
                    ? <div className="gen-loader"><div className="gen-dot" style={{ fontSize: "20px" }}>✦</div></div>
                    : result?.ai_generated?.preview_url
                      ? <img src={getImageUrl(result.ai_generated.preview_url)} alt="AI Blueprint"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onLoad={e => { (e.target as HTMLImageElement).style.opacity = "1"; }}
                          onError={e => { (e.target as HTMLImageElement).style.opacity = "0.2"; }}
                        />
                      : <div className="img-skeleton" style={{ width: "100%", height: "100%" }} />
                  }
                </div>

                {/* Action buttons — only when result is available */}
                {result && (
                  <div style={{ padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    <button onClick={handleDownload2D} disabled={isActive}
                      className="hbtn hbtn-sm hbtn-secondary">
                      <ImageDown size={12} /> {t("home_download_2d", lang)}
                    </button>
                    <button onClick={handleGen3D} disabled={isActive}
                      className="hbtn hbtn-sm hbtn-accent">
                      {isGen3D ? <><Loader2 size={12} className="animate-spin" /> {t("home_building", lang)}</> : <><Boxes size={12} /> {t("home_gen_3d", lang)}</>}
                    </button>
                    <button
                      onClick={() => { setShowEditPanel(p => !p); setEditSelections({ ...selections }); }}
                      disabled={isActive || isEditing}
                      className="hbtn hbtn-sm hbtn-violet">
                      ✏️ Edit
                    </button>
                    <button onClick={handleSave} disabled={isSaving || isActive}
                      className="hbtn hbtn-sm hbtn-accent" style={{ marginLeft: "auto" }}>
                      <Save size={12} /> {isSaving ? t("home_saving", lang) : t("home_save", lang)}
                    </button>
                  </div>
                )}

                {/* 3D Generation Progress — separate card below */}
                {isGen3D && (
                  <div style={{
                    margin: "0 14px 14px",
                    padding: "14px 16px", borderRadius: "12px",
                    background: "var(--cyan-glow-bg)",
                    border: `1px solid var(--cyan-glow-soft)`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                      <span style={{ ...sg, fontWeight: 600, fontSize: "12px", color: "var(--cyan-text)" }}>
                        {t("home_building_model", lang)}
                      </span>
                      <span style={{ ...mono, fontSize: "11px", color: "var(--cyan-glow)" }}>
                        {progress.elapsedSeconds}s
                      </span>
                    </div>
                    <div style={{ height: "3px", borderRadius: "999px", background: "var(--surface)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: "999px",
                        background: "linear-gradient(90deg, #00E5FF, #7C3AED)",
                        width: `${Math.min(progress.elapsedSeconds * 1.5, 95)}%`,
                        transition: "width 1s linear",
                        boxShadow: `0 0 8px var(--cyan-glow)`,
                      }} />
                    </div>
                    <p style={{ ...mono, fontSize: "10px", color: "var(--text-mono)", marginTop: "8px", marginBottom: 0 }}>
                      {t("home_takes_4min", lang)}
                    </p>
                    {progress.elapsedSeconds > 180 && !localStorage.getItem("holo3d_3d_done") && (
                      <div style={{
                        marginTop: "10px", padding: "10px 12px", borderRadius: "8px",
                        background: "var(--violet-glow-bg)", border: `1px solid var(--violet-glow-soft)`,
                      }}>
                        <p style={{ ...mono, fontSize: "10px", color: "var(--violet-text-dim)", marginBottom: "4px", fontWeight: 700 }}>
                          ⏳ First-time setup
                        </p>
                        <p style={{ ...mono, fontSize: "10px", color: "var(--violet-text-dim)", margin: 0, lineHeight: 1.6 }}>
                          The texture model (Hunyuan3D-Paint) is downloading from the internet. This only happens once — future runs will be much faster.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Factory Match — visible during generation too */}
              <div style={{ background: "var(--surface)", border: `1px solid var(--violet-glow-soft)`, borderRadius: "18px", overflow: "hidden", boxShadow: `0 0 24px var(--violet-glow-bg)` }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#a78bfa", boxShadow: "0 0 8px #7C3AED" }} />
                  <span style={{ ...sg, fontWeight: 600, fontSize: "15px" }}>{t("home_factory_match", lang)}</span>
                  {(isGenerating || isStopping) && !result && (
                    <span style={{ ...mono, fontSize: "10px", color: "var(--text-mono)", marginLeft: "auto" }}>
                      matching…
                    </span>
                  )}
                </div>

                {(isGenerating || isStopping) && !result ? (
                  /* Loading state — mirror the AI Blueprint loader + explanatory caption */
                  <>
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ ...mono, fontSize: "11px", color: "var(--text-mono)", lineHeight: 1.6 }}>
                        {lang === "ar"
                          ? "بندوّرلك على أقرب شكل موجود فعلاً في مخزون المصنع للتصميم ده."
                          : "Finding the closest existing product in the factory catalog for this design."}
                      </div>
                    </div>
                    <div style={{ aspectRatio: "1", background: "rgba(0,0,0,0.3)", overflow: "hidden", position: "relative" }}>
                      <div className="gen-loader"><div className="gen-dot" style={{ fontSize: "20px" }}>✦</div></div>
                    </div>
                  </>
                ) : !result ? (
                  <div className="img-skeleton" style={{ aspectRatio: "1", width: "100%" }} />
                ) : result.factory_match.match_score === 0 && !result.factory_match.id ? (
                  /* Empty catalog state */
                  <div style={{ padding: "36px 24px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", textAlign: "center" }}>
                    <div style={{ fontSize: "40px", opacity: 0.35 }}>🏭</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-mono)", marginBottom: "6px" }}>
                        {localStorage.getItem("holo3d_role") === "admin" ? t("home_catalog_empty", lang) : t("home_no_match", lang)}
                      </div>
                      <div style={{ ...mono, fontSize: "11px", color: "var(--text-mono)", lineHeight: 1.6 }}>
                        {localStorage.getItem("holo3d_role") === "admin"
                          ? t("home_add_via_upload", lang)
                          : t("home_catalog_building", lang)}
                      </div>
                    </div>
                    {localStorage.getItem("holo3d_role") === "admin" && (
                      <a href="/upload" style={{ marginTop: "4px", padding: "8px 18px", borderRadius: "10px", background: "var(--violet-glow-bg)", border: `1px solid var(--violet-glow)`, color: "var(--violet-text)", fontSize: "12px", fontFamily: "Manrope, sans-serif", fontWeight: 600, textDecoration: "none" }}>
                        → {t("home_upload_products", lang)}
                      </a>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: "18px", display: "flex", gap: "14px", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
                      <RadialGauge value={result.factory_match.match_score} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)", marginBottom: "4px", lineHeight: 1.4 }}>
                          {result.factory_match.description || t("home_no_close_match", lang)}
                        </div>
                        {result.factory_match.id && (
                          <div style={{ ...mono, fontSize: "10px", color: "var(--text-mono)" }}>
                            Catalog ID #{result.factory_match.id}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ aspectRatio: "1", background: "rgba(0,0,0,0.3)", overflow: "hidden" }}>
                      {result.factory_match.file_path
                        ? <img src={getImageUrl(result.factory_match.file_path)} alt="Factory Match" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-mono)", fontSize: "12px" }}>No product image</div>}
                    </div>
                  </>
                )}
              </div>
              {/* end Factory Match */}
            </div>

            {/* 3D Viewer — only when result is available */}
            {result && mesh ? (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                style={{ borderRadius: "20px", overflow: "hidden", border: `1px solid var(--cyan-glow-soft)`, background: "var(--bg)", boxShadow: "0 20px 60px var(--shadow-heavy), 0 0 30px var(--cyan-glow-bg)", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: `1px solid var(--cyan-glow-soft)`, background: "var(--cyan-glow-bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "var(--cyan-glow-soft)", border: `1px solid var(--cyan-glow-soft)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Boxes size={14} style={{ color: "var(--cyan-text)" }} />
                    </div>
                    <div>
                      <span style={{ ...sg, fontWeight: 700, fontSize: "15px", color: "var(--text)" }}>3D Preview</span>
                      <div style={{ ...mono, fontSize: "9px", color: "var(--cyan-glow)", letterSpacing: "1px", marginTop: "1px" }}>INTERACTIVE</div>
                    </div>
                  </div>
                  <div className="viewer-toolbar" style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => { const v = document.querySelector("model-viewer"); v?.requestFullscreen?.(); }}
                      className="hbtn hbtn-sm hbtn-secondary">
                      <Maximize2 size={11} /> Fullscreen
                    </button>
                  {/* Specs PDF button */}
                  <button
                    onClick={async () => {
                      const tab = window.open("", "_blank");
                      try {
                        const port   = window.location.port ? `:${window.location.port}` : "";
                        const origin = `${window.location.protocol}//${window.location.hostname}${port}`;
                        const arUrl  = mesh ? `${origin}/ar-viewer?mesh=${encodeURIComponent(mesh.glb)}&name=${encodeURIComponent(builtPrompt)}&type=${encodeURIComponent(category)}` : "";
                        const dims   = meshDims ?? { w: 1200, d: 700, h: 750 };
                        const res    = await fetch("/api/specs-pdf", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: builtPrompt, category, width: dims.w, depth: dims.d, height: dims.h, ar_url: arUrl }),
                        });
                        const text = await res.text();
                        let json: any = {};
                        try { json = JSON.parse(text); } catch { throw new Error(`Server error ${res.status}`); }
                        if (json.download_url && tab) { tab.location.href = json.download_url; }
                        else { tab?.close(); showToast({ title: "PDF failed", description: json.error, type: "error" }); }
                      } catch (e) {
                        tab?.close();
                        showToast({ title: "PDF failed", description: String(e), type: "error" });
                      }
                    }}
                    className="hbtn hbtn-sm hbtn-secondary">
                    📄 Specs
                  </button>
                  {/* Share button */}
                  <button
                    onClick={() => { setShowShareModal(true); setShareCopied(false); }}
                    className="hbtn hbtn-sm hbtn-secondary">
                    📤 Share
                  </button>
                  {/* Print Export button */}
                  <button
                    onClick={async () => {
                      setShowPrintPanel(true); setPrintState("idle"); setPrintResult(null);
                      // Set category defaults immediately so UI isn't stuck
                      const defaults: Record<string, {w:number,d:number,h:number}> = {
                        sofa: {w:1800,d:900,h:850}, chair: {w:600,d:600,h:950}, table: {w:1200,d:700,h:750},
                      };
                      setMeshDims(defaults[category] ?? {w:1200,d:800,h:800});
                      // Then try to get real dims from mesh
                      if (mesh?.stl) {
                        try {
                          const r = await fetch(`/api/mesh-dims?path=${encodeURIComponent(mesh.stl)}`);
                          if (r.ok) { const j = await r.json(); if (!j.error) setMeshDims(j); }
                        } catch { /* keep defaults */ }
                      }
                    }}
                    className="hbtn hbtn-sm hbtn-secondary">
                    🖨️ 3D Print
                  </button>
                  {/* Paper Blueprint — pencil sketches of all angles, to a real printer */}
                  <button
                    onClick={handleBlueprint}
                    disabled={blueprintLoading}
                    title="Print a pencil blueprint (all angles) on paper"
                    className="hbtn hbtn-sm hbtn-secondary">
                    {blueprintLoading ? <><Loader2 size={12} className="animate-spin" /> Drawing…</> : <>📐 Blueprint</>}
                  </button>
                  {/* AR button */}
                  <button
                    onClick={() => setShowARModal(true)}
                    className="hbtn"
                    style={{
                      background: `linear-gradient(135deg, var(--cyan-glow-soft), var(--violet-glow-soft))`,
                      border: `1px solid var(--cyan-glow)`,
                      color: "var(--cyan-text)",
                      boxShadow: `0 0 18px var(--cyan-glow-soft), inset 0 0 12px var(--cyan-glow-bg)`,
                    }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-4.5 10-10 10z"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    View in AR
                  </button>
                  </div>
                </div>
                <div style={{ height: "400px", position: "relative" }}>
                  {/* Grid floor */}
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50%", backgroundImage: "linear-gradient(rgba(0,229,255,0.12) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.12) 1px,transparent 1px)", backgroundSize: "40px 40px", transform: "perspective(400px) rotateX(60deg)", transformOrigin: "bottom", opacity: 0.25, maskImage: "linear-gradient(to top,#000 5%,transparent)", pointerEvents: "none" }} />
                  {/* @ts-expect-error model-viewer */}
                  <model-viewer
                    src={getImageUrl(mesh.glb)}
                    alt="3D"
                    camera-controls
                    auto-rotate
                    shadow-intensity="1"
                    exposure="1.2"
                    environment-image="neutral"
                    ar
                    ar-modes="webxr scene-viewer quick-look"
                    ar-scale="auto"
                    style={{ width: "100%", height: "100%", background: "transparent" }}
                  />
                </div>
                <div className="viewer-footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
                  <span style={{ ...mono, fontSize: "10px", color: "var(--text-mono)" }}>Drag to rotate · Scroll to zoom</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <select value={dlFormat} onChange={e => setDlFormat(e.target.value as DownloadFormat)}
                      style={{ padding: "6px 10px", borderRadius: "8px", background: "var(--bg)", border: `1px solid var(--cyan-glow-soft)`, color: "var(--cyan-text)", fontSize: "11px", outline: "none", fontFamily: "'JetBrains Mono', monospace" }}>
                      <option value="glb">.glb — Web/AR</option>
                      <option value="stl">.stl — 3D Print</option>
                      <option value="obj">.obj — Manufacturing</option>
                    </select>
                    <button onClick={handleDl3D} className="hbtn hbtn-sm hbtn-accent">
                      <Download size={11} /> Download
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : result ? (
              // Wireframe placeholder — only when result exists but no mesh yet
              <div style={{ borderRadius: "18px", border: "1px solid var(--border)", background: "var(--bg)", height: "280px", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", position: "relative", overflow: "hidden", marginBottom: "16px" }}>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50%", backgroundImage: "linear-gradient(rgba(0,229,255,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.1) 1px,transparent 1px)", backgroundSize: "40px 40px", transform: "perspective(400px) rotateX(60deg)", transformOrigin: "bottom", opacity: 0.2, maskImage: "linear-gradient(to top,#000 5%,transparent)", pointerEvents: "none" }} />
                <WireframeCube />
                <p style={{ ...mono, fontSize: "11px", color: isGen3D ? "var(--cyan-text-dim)" : "var(--text-mono)", letterSpacing: "1px" }}>
                  {isGen3D ? "Building 3D model..." : 'Hit "Gen 3D" to build the 3D model'}
                </p>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Share AR Link Modal ── */}
      <AnimatePresence>
        {showShareModal && mesh && (() => {
          const port    = window.location.port ? `:${window.location.port}` : "";
          const origin  = `${window.location.protocol}//${window.location.hostname}${port}`;
          const shareUrl = `${origin}/ar-viewer?mesh=${encodeURIComponent(mesh.glb)}&name=${encodeURIComponent(builtPrompt)}&type=${encodeURIComponent(category)}`;
          const isNgrok = window.location.hostname.includes("ngrok");
          const isTunnel = isNgrok || window.location.hostname.includes("tunnel") || window.location.hostname.includes("loca.lt");

          return (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowShareModal(false)}
              style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                onClick={e => e.stopPropagation()}
                style={{ width: "min(400px, 94vw)", borderRadius: "20px", background: "var(--bg)", border: "1px solid var(--cyan-glow)", padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ ...sg, fontWeight: 700, fontSize: "17px" }}>📤 Share AR Link</div>
                    <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", marginTop: "3px" }}>
                      Client opens on phone → sees furniture in their room
                    </div>
                  </div>
                  <button onClick={() => setShowShareModal(false)} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "20px", cursor: "pointer" }}>×</button>
                </div>

                {/* ngrok status banner */}
                <div style={{
                  padding: "10px 14px", borderRadius: "10px",
                  background: isTunnel ? "rgba(52,211,153,0.08)" : "rgba(255,180,60,0.08)",
                  border: `1px solid ${isTunnel ? "rgba(52,211,153,0.3)" : "rgba(255,180,60,0.3)"}`,
                  display: "flex", alignItems: "center", gap: "10px",
                }}>
                  <span style={{ fontSize: "18px" }}>{isTunnel ? "✅" : "⚠️"}</span>
                  <div>
                    <div style={{ ...mono, fontSize: "11px", color: isTunnel ? "#34D399" : "rgba(255,180,60,0.9)", fontWeight: 700 }}>
                      {isTunnel ? "Public URL — works anywhere" : "Local URL — same WiFi only"}
                    </div>
                    {!isTunnel && (
                      <div style={{ ...mono, fontSize: "10px", color: "var(--text-mono)", marginTop: "3px" }}>
                        Run <code style={{ color: "var(--cyan-text)", background: "rgba(0,229,255,0.08)", padding: "1px 5px", borderRadius: "4px" }}>ngrok http 5173</code> to get a public link
                      </div>
                    )}
                  </div>
                </div>

                {/* QR Code */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "20px", borderRadius: "14px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}&bgcolor=050810&color=00E5FF&qzone=1`}
                    alt="QR"
                    width={180} height={180}
                    style={{ borderRadius: "10px", border: "1px solid var(--cyan-glow-soft)" }}
                  />
                  <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", textAlign: "center" }}>
                    Scan with phone camera to open in AR
                  </div>
                </div>

                {/* Copy link */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <div style={{
                    flex: 1, padding: "10px 12px", borderRadius: "10px",
                    background: "var(--surface)", border: "1px solid var(--border)",
                    ...mono, fontSize: "10px", color: "var(--text-mono)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {shareUrl}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(shareUrl); setShareCopied(true); setTimeout(() => setShareCopied(false), 2500); }}
                    className="hbtn hbtn-accent"
                    style={{
                      flexShrink: 0,
                      ...(shareCopied ? { background: "rgba(52,211,153,0.12)", border: "1px solid #34D399", color: "#34D399" } : {}),
                    }}>
                    {shareCopied ? "✓ Copied" : "Copy"}
                  </button>
                </div>

              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Print Export Modal ── */}
      <AnimatePresence>
        {showPrintPanel && mesh && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowPrintPanel(false)}
            style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92 }}
              onClick={e => e.stopPropagation()}
              style={{ width: "min(380px, 92vw)", borderRadius: "20px", background: "var(--bg)", border: "1px solid var(--cyan-glow)", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>

              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ ...sg, fontWeight: 700, fontSize: "17px" }}>🖨️ Export for 3D Print</div>
                  <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", marginTop: "2px" }}>Scale → Slice → Download G-code</div>
                </div>
                <button onClick={() => setShowPrintPanel(false)} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "20px", cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>

              {/* Scale selector */}
              <div>
                <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", marginBottom: "8px", letterSpacing: "1px", textTransform: "uppercase" }}>Print Scale</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    { label: "5%",  sub: "tiny model  (1:20)", value: 5   },
                    { label: "10%", sub: "mini model  (1:10)", value: 10  },
                    { label: "20%", sub: "small model (1:5)",  value: 20  },
                  ].map(o => (
                    <button
                      key={o.value}
                      onClick={() => { setPrintScale(o.value); setPrintState("idle"); setPrintResult(null); }}
                      style={{
                        padding: "10px", borderRadius: "10px", cursor: "pointer", textAlign: "left",
                        background: printScale === o.value ? "rgba(0,229,255,0.1)" : "var(--surface)",
                        border: `1px solid ${printScale === o.value ? "var(--cyan-glow)" : "var(--border)"}`,
                        color: printScale === o.value ? "var(--cyan-text)" : "var(--text-dim)",
                      }}>
                      <div style={{ ...sg, fontWeight: 700, fontSize: "15px" }}>{o.label}</div>
                      <div style={{ ...mono, fontSize: "10px", opacity: 0.7 }}>{o.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Print size preview + warning */}
              {printState !== "done" && (() => {
                if (!meshDims) return (
                  <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", textAlign: "center" }}>
                    Reading mesh dimensions...
                  </div>
                );
                const pw  = Math.round(meshDims.w * printScale / 100);
                const pd2 = Math.round(meshDims.d * printScale / 100);
                const ph  = Math.round(meshDims.h * printScale / 100);
                const tooBig = pw > 250 || pd2 > 210 || ph > 220;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ ...mono, fontSize: "10px", color: "var(--text-mono)", textAlign: "center" }}>
                      Real size: {Math.round(meshDims.w)} × {Math.round(meshDims.d)} × {Math.round(meshDims.h)} mm
                    </div>
                    <div style={{ ...mono, fontSize: "11px", color: "var(--cyan-text-dim)", textAlign: "center", padding: "8px", background: "rgba(0,229,255,0.04)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      Print size: {pw} × {pd2} × {ph} mm
                    </div>
                    {tooBig && (
                      <div style={{ ...mono, fontSize: "10px", color: "rgba(255,180,60,0.9)", textAlign: "center", padding: "6px 8px", background: "rgba(255,180,60,0.06)", borderRadius: "6px", border: "1px solid rgba(255,180,60,0.25)" }}>
                        ⚠ Too big for most printers (max ~250×210×220 mm)
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Export button */}
              {printState !== "done" && (
                <button
                  onClick={handlePrintExport}
                  disabled={printState === "loading"}
                  className="hbtn hbtn-lg"
                  style={{
                    width: "100%",
                    background: printState === "loading" ? "rgba(0,229,255,0.05)" : "linear-gradient(135deg, var(--cyan-glow-soft), var(--violet-glow-soft))",
                    border: "1px solid var(--cyan-glow)", color: "var(--cyan-text)",
                  }}>
                  {printState === "loading" ? "⏳ Slicing mesh..." : "Generate G-code"}
                </button>
              )}

              {/* Error */}
              {printState === "error" && (
                <div style={{ ...mono, fontSize: "11px", color: "#f87171", textAlign: "center" }}>
                  ⚠ {printResult?.error}
                  <br />
                  <span style={{ cursor: "pointer", color: "var(--cyan-text-dim)", textDecoration: "underline" }} onClick={() => setPrintState("idle")}>retry</span>
                </div>
              )}

              {/* Success */}
              {printState === "done" && printResult && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ ...mono, fontSize: "11px", color: "#34D399", textAlign: "center" }}>
                    ✓ {printResult.type === "gcode" ? "G-code ready!" : "Scaled STL ready"}
                  </div>
                  {printResult.print_dims_mm && (
                    <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", textAlign: "center" }}>
                      {printResult.print_dims_mm.w} × {printResult.print_dims_mm.d} × {printResult.print_dims_mm.h} mm
                    </div>
                  )}
                  {printResult.note && (
                    <div style={{ ...mono, fontSize: "10px", color: "rgba(255,200,100,0.85)", textAlign: "center", lineHeight: 1.6 }}>
                      {printResult.note}
                    </div>
                  )}
                  <a
                    href={printResult.download_url}
                    download
                    className="hbtn hbtn-lg"
                    style={{
                      width: "100%",
                      background: "linear-gradient(135deg, rgba(0,229,255,0.12), rgba(52,211,153,0.12))",
                      border: "1px solid #34D399", color: "#34D399", textDecoration: "none",
                    }}>
                    ⬇ Download {printResult.type === "gcode" ? ".gcode" : ".stl"}
                  </a>
                  <button onClick={() => { setPrintState("idle"); setPrintResult(null); }} style={{ background: "none", border: "none", color: "var(--text-dim)", ...mono, fontSize: "10px", cursor: "pointer" }}>
                    ← change scale
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── AR Modal ── */}
      <AnimatePresence>
        {showARModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowARModal(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 999,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(12px)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: "var(--surface)",
                border: `1px solid var(--cyan-glow-soft)`,
                borderRadius: "22px",
                padding: "32px",
                width: "min(420px, 90vw)",
                boxShadow: `0 0 60px var(--cyan-glow-soft), 0 40px 80px var(--shadow-heavy)`,
              }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
                <div>
                  <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "6px" }}>
                    Augmented Reality
                  </div>
                  <div style={{ ...sg, fontWeight: 700, fontSize: "20px" }}>View in AR</div>
                </div>
                <button onClick={() => setShowARModal(false)}
                  style={{ background: "none", border: "none", color: "var(--text-mono)", cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>
                  ✕
                </button>
              </div>

              {/* QR Code — points directly to /ar?mesh=... */}
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: "16px",
                padding: "20px", borderRadius: "14px",
                background: "var(--surface)", border: "1px solid var(--border)",
                marginBottom: "20px",
              }}>
                {(() => {
                  const portSuffix = window.location.port ? `:${window.location.port}` : "";
                  const arUrl = mesh
                    ? `${window.location.protocol}//${window.location.hostname}${portSuffix}/ar?mesh=${encodeURIComponent(mesh.glb)}&name=${encodeURIComponent(builtPrompt)}`
                    : `${window.location.protocol}//${window.location.hostname}${portSuffix}`;
                  return (
                    <>
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(arUrl)}&bgcolor=050810&color=00E5FF&qzone=1`}
                        alt="QR Code"
                        width={180} height={180}
                        style={{ borderRadius: "10px", border: `1px solid var(--cyan-glow-soft)` }}
                      />
                      <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-glow)", textAlign: "center", wordBreak: "break-all" }}>
                        Scan to view this exact design in AR
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Steps */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                {[
                  { n: "1", text: "Connect your phone to the same WiFi network" },
                  { n: "2", text: "Scan the QR code — it opens this exact 3D design on your phone" },
                  { n: "3", text: 'Accept the security warning → tap Advanced → Proceed' },
                  { n: "4", text: 'Tap "View in AR" to place the furniture in your real space' },
                ].map(step => (
                  <div key={step.n} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <div style={{
                      width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0,
                      background: "var(--cyan-glow-soft)", border: `1px solid var(--cyan-glow)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      ...mono, fontSize: "10px", color: "var(--cyan-text)", fontWeight: 700,
                    }}>{step.n}</div>
                    <p style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>
                      {step.text}
                    </p>
                  </div>
                ))}
              </div>

              {/* Compatibility */}
              <div style={{
                padding: "12px 16px", borderRadius: "10px",
                background: "var(--cyan-glow-bg)", border: `1px solid var(--cyan-glow-soft)`,
                display: "flex", gap: "16px",
              }}>
                <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginBottom: "4px" }}>
                    <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.31-.16-.69-.04-.85.26l-1.86 3.22c-1.44-.65-3.05-1.02-4.77-1.02-1.72 0-3.33.37-4.77 1.02L5.07 5.71c-.16-.31-.54-.42-.85-.26-.31.16-.42.54-.26.85L5.8 9.48C2.35 11.4.03 14.91 0 19h24c-.03-4.09-2.35-7.6-5.8-9.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z" fill="#00E5FF"/>
                  </svg>
                  <div style={{ ...mono, fontSize: "9px", color: "var(--text-mono)" }}>Android</div>
                  <div style={{ ...mono, fontSize: "9px", color: "var(--cyan-text-dim)" }}>Chrome</div>
                </div>
                <div style={{ width: "1px", background: "var(--border)" }} />
                <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <svg width="18" height="20" viewBox="0 0 17 21" fill="none" style={{ marginBottom: "4px" }}>
                    <path d="M14.06 11.02c-.02-2.16 1.76-3.2 1.84-3.25-1-1.47-2.56-1.67-3.12-1.69-1.33-.14-2.59.78-3.26.78-.67 0-1.71-.76-2.81-.74-1.45.02-2.78.84-3.53 2.14-1.5 2.6-.39 6.46 1.08 8.57.72 1.03 1.57 2.2 2.69 2.15 1.08-.04 1.49-.7 2.79-.7 1.31 0 1.67.7 2.81.68 1.16-.02 1.89-1.06 2.6-2.1.82-1.2 1.16-2.36 1.18-2.42-.03-.01-2.26-.87-2.27-3.42zM11.92 4.18c.59-.73 1-1.73.89-2.73-.86.03-1.9.57-2.52 1.3-.55.64-1.03 1.66-.9 2.64.96.07 1.94-.49 2.53-1.21z" fill="#00E5FF"/>
                  </svg>
                  <div style={{ ...mono, fontSize: "9px", color: "var(--text-mono)" }}>iPhone</div>
                  <div style={{ ...mono, fontSize: "9px", color: "var(--cyan-text-dim)" }}>Safari</div>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
                  <p style={{ ...mono, fontSize: "10px", color: "var(--text-mono)", margin: 0, lineHeight: 1.5 }}>
                    AR requires HTTPS — the security warning is expected on local network.
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}