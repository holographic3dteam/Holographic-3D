import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { showToast } from "@/components/ui/custom-toast";
import { Download, Boxes, Loader2, RefreshCw, Star, Trash2, Eye, AlertTriangle } from "lucide-react";
import {
  getImageUrl, deleteDesign, rateDesign, generate3D,
  getSavedDesigns, getSavedDesignsFromDB, removeSavedDesign,
  updateSavedDesignRating, updateSavedDesignMesh,
  SavedDesign, MeshPaths, GenerateResponse
} from "@/api";
import { useSettings, t } from "@/contexts/settings-context";

type SortOption   = "newest" | "oldest" | "rating";
type FilterOption = "all" | "rated" | "has3d";
type DlFormat     = "glb" | "stl" | "obj";

// ── AR Modal ──────────────────────────────────────────────────────────────────
interface ARModalProps { design: SavedDesign; onClose: () => void; }

function ARModal({ design, onClose }: ARModalProps) {
  const { language: lang } = useSettings();
  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;
  const portSuffix = window.location.port ? `:${window.location.port}` : "";
  const arUrl = design.mesh
    ? `${window.location.protocol}//${window.location.hostname}${portSuffix}/ar?mesh=${encodeURIComponent(design.mesh.glb)}&name=${encodeURIComponent(design.prompt)}`
    : "";
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(arUrl)}&bgcolor=050810&color=00E5FF&qzone=1`;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--cyan-glow-soft)", borderRadius: "22px", padding: "32px", width: "min(420px, 90vw)", boxShadow: "0 0 60px rgba(0,229,255,0.12), 0 40px 80px var(--shadow-heavy)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <div>
            <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "6px" }}>{t("home_ar_title", lang)}</div>
            <div style={{ ...sg, fontWeight: 700, fontSize: "20px" }}>{t("home_view_ar", lang)}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-mono)", cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "20px", borderRadius: "14px", background: "var(--surface)", border: "1px solid var(--border)", marginBottom: "20px" }}>
          <img src={qrUrl} alt="QR Code" width={180} height={180} style={{ borderRadius: "10px", border: "1px solid var(--cyan-glow-soft)" }} />
          <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", textAlign: "center", wordBreak: "break-all" }}>{t("home_scan_qr", lang)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {[
            { n: "1", text: "Connect your phone to the same WiFi network" },
            { n: "2", text: "Scan the QR code — it opens this exact 3D design on your phone" },
            { n: "3", text: "Accept the security warning → tap Advanced → Proceed" },
            { n: "4", text: 'Tap "View in AR" to place the furniture in your real space' },
          ].map(step => (
            <div key={step.n} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0, background: "var(--cyan-glow-bg)", border: "1px solid var(--cyan-glow)", display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: "10px", color: "var(--cyan-text)", fontWeight: 700 }}>{step.n}</div>
              <p style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>{step.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 3D Preview Modal ──────────────────────────────────────────────────────────
interface PreviewModalProps { design: SavedDesign; onClose: () => void; }

function PreviewModal({ design, onClose }: PreviewModalProps) {
  const { language: lang } = useSettings();
  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;
  if (!design.mesh) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(16px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
        onClick={e => e.stopPropagation()}
        style={{ width: "min(680px, 94vw)", borderRadius: "22px", overflow: "hidden", border: "1px solid var(--cyan-glow-soft)", background: "var(--bg)", boxShadow: "0 0 60px rgba(0,229,255,0.1), 0 40px 80px var(--shadow-heavy)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "4px" }}>{t("home_3d_preview", lang)}</div>
            <div style={{ ...sg, fontWeight: 700, fontSize: "16px", color: "var(--text)", maxWidth: "520px", lineHeight: 1.4 }}>{design.prompt}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-mono)", cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>✕</button>
        </div>
        {/* Viewer */}
        <div style={{ height: "440px", position: "relative", background: "var(--bg)" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50%", backgroundImage: "linear-gradient(rgba(0,229,255,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.1) 1px,transparent 1px)", backgroundSize: "40px 40px", transform: "perspective(400px) rotateX(60deg)", transformOrigin: "bottom", opacity: 0.18, maskImage: "linear-gradient(to top,#000 5%,transparent)", pointerEvents: "none" }} />
          {/* @ts-expect-error model-viewer */}
          <model-viewer
            src={getImageUrl(design.mesh.glb)}
            alt={design.prompt}
            camera-controls
            auto-rotate
            shadow-intensity="1"
            exposure="1.2"
            environment-image="neutral"
            style={{ width: "100%", height: "100%", background: "transparent" }}
          />
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--border)", ...mono, fontSize: "10px", color: "var(--text-mono)", textAlign: "center" }}>
          {t("home_drag_rotate", lang)}
        </div>
      </motion.div>
    </div>
  );
}

// ── Delete Confirmation Modal ─────────────────────────────────────────────────
interface ConfirmDeleteProps { onConfirm: () => void; onCancel: () => void; }

function ConfirmDeleteModal({ onConfirm, onCancel }: ConfirmDeleteProps) {
  const { language: lang } = useSettings();
  const sg = { fontFamily: "'Space Grotesk', sans-serif" } as const;
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
        onClick={e => e.stopPropagation()}
        style={{ width: "min(360px, 90vw)", borderRadius: "18px", padding: "28px", background: "var(--surface)", border: "1px solid rgba(239,68,68,0.25)", boxShadow: "0 0 40px rgba(239,68,68,0.1), 0 30px 60px var(--shadow-heavy)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", textAlign: "center" }}>
          <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <AlertTriangle size={24} style={{ color: "rgba(239,68,68,0.7)" }} />
          </div>
          <div>
            <div style={{ ...sg, fontWeight: 700, fontSize: "17px", marginBottom: "8px" }}>{t("saved_delete_title", lang)}</div>
            <div style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.6 }}>
              {t("saved_delete_desc", lang)}
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "4px" }}>
            <button onClick={onCancel}
              style={{ flex: 1, padding: "11px", borderRadius: "12px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: "13px", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontWeight: 600 }}>
              {t("saved_cancel", lang)}
            </button>
            <button onClick={onConfirm}
              style={{ flex: 1, padding: "11px", borderRadius: "12px", background: "var(--error-bg)", border: `1px solid var(--error-border)`, color: "var(--error-text-soft)", fontSize: "13px", cursor: "pointer", fontFamily: "Manrope, sans-serif", fontWeight: 700 }}>
              {t("saved_delete", lang)}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Loading Skeletons ─────────────────────────────────────────────────────────
function SkeletonGrid() {
  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .sk {
          background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s ease infinite;
        }
      `}</style>
      <div className="saved-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "18px" }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ borderRadius: "16px", background: "var(--surface)", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div className="sk" style={{ aspectRatio: "1" }} />
            <div style={{ padding: "12px 12px 10px" }}>
              <div className="sk" style={{ height: "10px", borderRadius: "5px", marginBottom: "8px", width: "85%" }} />
              <div className="sk" style={{ height: "8px", borderRadius: "5px", width: "45%" }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Saved() {
  const { language: lang } = useSettings();
  const [designs, setDesigns]           = useState<SavedDesign[]>([]);
  const [sortBy, setSortBy]             = useState<SortOption>("newest");
  const [filterBy, setFilterBy]         = useState<FilterOption>("all");
  const [generating3D, setGenerating3D] = useState<number | null>(null);
  const [deleting, setDeleting]         = useState<number | null>(null);
  const [arDesign, setArDesign]         = useState<SavedDesign | null>(null);
  const [previewDesign, setPreviewDesign] = useState<SavedDesign | null>(null);
  const [imgView, setImgView] = useState<SavedDesign | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [dlFormats, setDlFormats]       = useState<Record<number, DlFormat>>({});
  const [loading, setLoading]           = useState(false);
  const [totalUnfiltered, setTotalUnfiltered] = useState(0);

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  const load = useCallback(async () => {
    setLoading(true);
    let data: SavedDesign[];
    try {
      data = await getSavedDesignsFromDB();
    } catch {
      data = [...getSavedDesigns()];
    }
    // Track unfiltered total so controls stay visible even when filter yields 0 results
    setTotalUnfiltered(data.length);
    if (filterBy === "rated") data = data.filter(d => d.rating);
    if (filterBy === "has3d")  data = data.filter(d => d.mesh);
    if (sortBy === "newest") data.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    if (sortBy === "oldest") data.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
    if (sortBy === "rating") data.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    setDesigns(data);
    setLoading(false);
  }, [sortBy, filterBy]);

  const [location] = useLocation();

  useEffect(() => {
    if (location === "/saved") load();
  }, [load, location]);

  const getDlFormat = (id: number): DlFormat => dlFormats[id] ?? "glb";
  const setDlFormat = (id: number, fmt: DlFormat) =>
    setDlFormats(prev => ({ ...prev, [id]: fmt }));

  // Load a saved design back into the Generate page as the current result so
  // the user can refine/edit it. Writes the same localStorage keys Home reads on
  // mount, then does a full navigation so Home re-hydrates from them.
  const openInEditor = (design: SavedDesign) => {
    const imported: GenerateResponse = {
      status: "success",
      factory_match: { description: "", match_score: 0 },
      ai_generated: { message: "", preview_url: design.preview_url, status: "completed" },
    };
    localStorage.setItem("holo3d_last_result", JSON.stringify(imported));
    localStorage.setItem("holo3d_last_prompt", design.prompt);
    window.location.href = "/";
  };

  const handleDelete = async (design: SavedDesign) => {
    setDeleting(design.id);
    try {
      await deleteDesign(design.id);
      removeSavedDesign(design.id);
      setConfirmDeleteId(null);
      load();
      showToast({ title: "Design deleted", type: "info" });
    } catch (e: unknown) {
      setConfirmDeleteId(null);
      showToast({ title: "Delete failed", description: e instanceof Error ? e.message : "Could not reach the server. Try again.", type: "error" });
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload2D = async (design: SavedDesign) => {
    const url = getImageUrl(design.preview_url);
    const safe = design.prompt.replace(/[^a-z0-9]/gi, "_").slice(0, 60);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Image not found");
      const blob = await res.blob();
      const bu = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = bu; a.download = `${safe}.png`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(bu);
    } catch { window.open(url, "_blank"); }
  };

  const handleGen3D = async (design: SavedDesign) => {
    setGenerating3D(design.id);
    try {
      const data = await generate3D(design.prompt, design.preview_url);
      updateSavedDesignMesh(design.id, data.mesh);
      load();
      showToast({ title: "3D model ready!", type: "success" });
    } catch (e: unknown) {
      showToast({ title: "3D generation failed", description: e instanceof Error ? e.message : "Error", type: "error" });
    } finally { setGenerating3D(null); }
  };

  const handleDl3D = (design: SavedDesign, format: keyof MeshPaths) => {
    if (!design.mesh) return;
    const safeName = design.prompt.replace(/[^a-z0-9]/gi, "_").slice(0, 60) || "model";
    const a = document.createElement("a");
    a.href = getImageUrl(design.mesh[format]); a.download = `${safeName}.${format}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleRate = async (design: SavedDesign, rating: number) => {
    try {
      await rateDesign(design.id, rating);
      updateSavedDesignRating(design.id, rating);
      load();
    } catch {
      showToast({ title: "Rating failed", description: "Could not reach the server. Try again.", type: "error" });
    }
  };

  const handleViewAR = (design: SavedDesign) => {
    if (!design.mesh) return;
    setArDesign(design);
  };

  // totalUnfiltered = full DB count; designs.length = after filter
  const total = totalUnfiltered;

  const selectStyle: React.CSSProperties = {
    padding: "8px 14px", borderRadius: "10px",
    background: "var(--surface)",
    border: "1px solid var(--cyan-glow-soft)",
    color: "var(--text-dim)",
    fontSize: "12px", outline: "none", cursor: "pointer",
    fontFamily: "Manrope, sans-serif",
    appearance: "none" as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(0,229,255,0.5)' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    paddingRight: "28px",
  };

  const dlSelectStyle: React.CSSProperties = {
    ...selectStyle,
    padding: "5px 26px 5px 8px",
    fontSize: "10px",
    background: "var(--surface)",
    border: "1px solid var(--cyan-glow-soft)",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(0,229,255,0.4)' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 8px center",
    color: "var(--cyan-text)",
  };

  return (
    <div style={{ width: "100%" }}>
      {/* Modals */}
      <AnimatePresence>
        {arDesign && <ARModal design={arDesign} onClose={() => setArDesign(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {previewDesign && <PreviewModal design={previewDesign} onClose={() => setPreviewDesign(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {imgView && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setImgView(null)}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "24px" }}>
            <motion.img
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              src={getImageUrl(imgView.preview_url)} alt={imgView.prompt}
              style={{ maxWidth: "min(90vw, 720px)", maxHeight: "70vh", objectFit: "contain", borderRadius: "16px", border: "1px solid var(--cyan-glow-soft)", boxShadow: "0 0 50px var(--cyan-glow-bg)" }} />
            <div onClick={e => e.stopPropagation()} style={{ maxWidth: "min(90vw, 720px)", textAlign: "center" }}>
              <p style={{ fontSize: "14px", color: "var(--text)", lineHeight: 1.6, margin: "0 0 6px" }}>{imgView.prompt}</p>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "var(--cyan-text-dim)" }}>
                {new Date(imgView.savedAt).toLocaleDateString()}
              </div>
            </div>
            <button onClick={() => setImgView(null)} className="hbtn hbtn-secondary">✕ Close</button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmDeleteId !== null && (
          <ConfirmDeleteModal
            onConfirm={() => {
              const d = designs.find(x => x.id === confirmDeleteId);
              if (d) handleDelete(d);
            }}
            onCancel={() => setConfirmDeleteId(null)}
          />
        )}
      </AnimatePresence>

      <style>{`
        select option { background: var(--bg); color: var(--text); padding: 8px; }
        @media (max-width: 768px) {
          .saved-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)) !important; gap: 12px !important; }
          .saved-controls { flex-wrap: wrap !important; }
        }
        @media (max-width: 480px) {
          .saved-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "28px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ ...mono, fontSize: "11px", letterSpacing: "4px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "8px" }}>
            {t("saved_vault", lang)}
          </div>
          <h1 style={{ ...sg, fontWeight: 700, fontSize: "clamp(22px,3.5vw,38px)", letterSpacing: "-1px", margin: 0 }}>
            {t("saved_blueprints", lang)}
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={load} style={{ padding: "8px", borderRadius: "8px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-mono)", cursor: "pointer", display: "flex", alignItems: "center" }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <div style={{ ...mono, padding: "5px 12px", borderRadius: "8px", background: "var(--cyan-glow-bg)", border: "1px solid var(--cyan-glow-soft)", color: "var(--cyan-text-dim)", fontSize: "11px" }}>
            {filterBy !== "all"
              ? `${designs.length} of ${total} ${total === 1 ? t("saved_design", lang) : t("saved_designs", lang)}`
              : `${total} ${total === 1 ? t("saved_design", lang) : t("saved_designs", lang)}`}
          </div>
        </div>
      </motion.div>

      {/* Controls — shown whenever there's data OR a non-default filter/sort is active */}
      {(totalUnfiltered > 0 || loading || filterBy !== "all" || sortBy !== "newest") && (
        <div className="saved-controls" style={{ display: "flex", gap: "10px", marginBottom: "24px", padding: "12px 16px", borderRadius: "12px", background: "var(--surface)", border: "1px solid var(--border)" }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)} style={selectStyle}>
            <option value="newest">{t("saved_newest", lang)}</option>
            <option value="oldest">{t("saved_oldest", lang)}</option>
            <option value="rating">{t("saved_highest", lang)}</option>
          </select>
          <select value={filterBy} onChange={e => setFilterBy(e.target.value as FilterOption)} style={selectStyle}>
            <option value="all">{t("saved_all", lang)}</option>
            <option value="rated">{t("saved_rated", lang)}</option>
            <option value="has3d">{t("saved_has3d", lang)}</option>
          </select>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && <SkeletonGrid />}

      {/* Empty state */}
      {!loading && designs.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 40px", borderRadius: "18px", border: "1px dashed var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
          <div style={{ width: "64px", height: "64px", borderRadius: "16px", background: "var(--cyan-glow-bg)", border: "1px solid var(--cyan-glow-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px" }}>
            {filterBy !== "all" ? "🔍" : "🗂️"}
          </div>
          <div>
            <div style={{ ...sg, fontSize: "17px", fontWeight: 700, marginBottom: "6px", color: "var(--text)" }}>
              {filterBy !== "all" ? t("saved_no_match", lang) : t("saved_no_designs", lang)}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-mono)", lineHeight: 1.6 }}>
              {filterBy !== "all" ? t("saved_try_filter", lang) : t("saved_gen_first", lang)}
            </div>
          </div>
          {filterBy === "all" ? (
            <a href="/" className="hbtn hbtn-accent" style={{ textDecoration: "none" }}>
              ✦ {t("saved_generate_first", lang)}
            </a>
          ) : (
            <button onClick={() => setFilterBy("all")} className="hbtn hbtn-accent">
              ✕ {t("saved_clear_filter", lang)}
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {!loading && designs.length > 0 && (
        <div className="saved-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "18px" }}>
          {designs.map((design, i) => (
            <motion.div key={`${design.id}-${i}`}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              style={{ borderRadius: "16px", background: "var(--surface)", border: "1px solid var(--border)", overflow: "hidden", transition: "all 0.25s ease" }}
              whileHover={{ borderColor: "var(--cyan-glow-soft)", boxShadow: "0 0 20px var(--cyan-glow-bg)" }}>

              {/* Image */}
              <div style={{ position: "relative", aspectRatio: "1", background: "var(--surface)", overflow: "hidden" }}>
                <img src={getImageUrl(design.preview_url)} alt={design.prompt}
                  onClick={() => setImgView(design)}
                  title="Click to view full image"
                  style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.4s ease", cursor: "zoom-in" }}
                  loading="lazy"
                  onError={e => { (e.target as HTMLImageElement).style.opacity = "0.2"; }}
                  onMouseEnter={e => { (e.target as HTMLImageElement).style.transform = "scale(1.05)"; }}
                  onMouseLeave={e => { (e.target as HTMLImageElement).style.transform = "scale(1)"; }}
                />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(5,8,16,0.85) 0%, transparent 50%)" }} />

                {/* Badges */}
                <div style={{ position: "absolute", top: "10px", right: "10px", display: "flex", gap: "5px" }}>
                  {design.mesh && (
                    <div style={{ ...mono, fontSize: "9px", padding: "2px 7px", borderRadius: "5px", background: "var(--cyan-glow-bg)", border: "1px solid var(--cyan-glow)", color: "var(--cyan-text)", letterSpacing: "1px" }}>3D</div>
                  )}
                  {design.rating && (
                    <div style={{ ...mono, fontSize: "9px", padding: "2px 7px", borderRadius: "5px", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(180,120,0,0.35)", color: "#b97a00", letterSpacing: "1px" }}>⭐{design.rating}</div>
                  )}
                </div>

                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 12px" }}>
                  <p title={design.prompt} style={{ fontSize: "11px", color: "var(--text)", lineHeight: 1.4, margin: "0 0 3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "help" }}>
                    {design.prompt}
                  </p>
                  <div style={{ ...mono, fontSize: "9px", color: "var(--cyan-text-dim)" }}>
                    {new Date(design.savedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Rating */}
              <div style={{ padding: "10px 12px 6px", display: "flex", alignItems: "center", gap: "3px" }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} onClick={() => handleRate(design, star)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", transition: "transform 0.1s" }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.2)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}>
                    <Star size={13} fill={(design.rating ?? 0) >= star ? "#00E5FF" : "transparent"} color={(design.rating ?? 0) >= star ? "#00E5FF" : "var(--border)"} />
                  </button>
                ))}
              </div>

              {/* Actions */}
              <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: "5px" }}>

                {/* Row 1: 2D + 3D actions */}
                <div style={{ display: "flex", gap: "5px" }}>
                  <button onClick={() => handleDownload2D(design)}
                    className="hbtn hbtn-sm hbtn-secondary" style={{ flex: 1 }}>
                    <Download size={11} /> 2D
                  </button>

                  {design.mesh ? (
                    <>
                      {/* Format selector + download */}
                      <div style={{ display: "flex", gap: "3px", flex: 2 }}>
                        <select
                          value={getDlFormat(design.id)}
                          onChange={e => setDlFormat(design.id, e.target.value as DlFormat)}
                          style={{ ...dlSelectStyle, flex: 1 }}>
                          <option value="glb">GLB</option>
                          <option value="stl">STL</option>
                          <option value="obj">OBJ</option>
                        </select>
                        <button onClick={() => handleDl3D(design, getDlFormat(design.id))}
                          title="Download 3D" className="hbtn hbtn-sm hbtn-accent">
                          <Download size={11} />
                        </button>
                      </div>
                      {/* Preview 3D button */}
                      <button onClick={() => setPreviewDesign(design)}
                        title="Preview 3D model" className="hbtn hbtn-sm hbtn-violet">
                        <Eye size={11} />
                      </button>
                      {/* AR button */}
                      <button onClick={() => handleViewAR(design)}
                        title="View in AR" className="hbtn hbtn-sm hbtn-accent">
                        📱
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleGen3D(design)} disabled={generating3D !== null}
                      className="hbtn hbtn-sm hbtn-accent" style={{ flex: 2 }}>
                      {generating3D === design.id ? <Loader2 size={11} className="animate-spin" /> : <Boxes size={11} />}
                      {generating3D === design.id ? t("home_building", lang) : t("home_gen_3d", lang)}
                    </button>
                  )}
                </div>

                {/* Row 2: Open in editor + Delete */}
                <div style={{ display: "flex", gap: "5px" }}>
                  <button onClick={() => openInEditor(design)}
                    title="Open in the editor to refine" className="hbtn hbtn-sm hbtn-secondary" style={{ flex: 1 }}>
                    ✏️ Edit
                  </button>
                  <button onClick={() => setConfirmDeleteId(design.id)} disabled={deleting === design.id}
                    className="hbtn hbtn-sm hbtn-danger" style={{ flex: 1 }}>
                    <Trash2 size={11} />
                    {deleting === design.id ? t("saved_deleting", lang) : t("saved_delete", lang)}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
