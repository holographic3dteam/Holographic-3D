import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { showToast } from "@/components/ui/custom-toast";
import { uploadProduct } from "@/api";
import { UploadCloud, X, FileImage, Inbox, Trash2, RefreshCw, ChevronDown, ChevronUp, Pencil, Check, Image } from "lucide-react";
import { useSettings, t } from "@/contexts/settings-context";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProductRequestItem {
  id: number;
  category: string;
  description: string;
  createdAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatRelative(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins < 1)   return "just now";
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7)   return `${days}d ago`;
    return d.toLocaleDateString();
  } catch { return ""; }
}

/** Parse the structured description lines into key-value pairs for display */
function parseDescription(raw: string): { key: string; value: string }[] {
  return raw
    .split("\n")
    .filter(l => l.startsWith("["))
    .map(l => {
      const m = l.match(/^\[(.+?)\]:\s*(.+)$/);
      return m ? { key: m[1], value: m[2] } : null;
    })
    .filter(Boolean) as { key: string; value: string }[];
}

// ── Requests panel ────────────────────────────────────────────────────────────
function RequestsPanel() {
  const { language: lang } = useSettings();
  const [reqs, setReqs]           = useState<ProductRequestItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [deleting, setDeleting]   = useState<number | null>(null);

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/product-requests");
      const data = await res.json();
      setReqs(Array.isArray(data) ? data : []);
    } catch {
      showToast({ type: "error", title: "Failed to load requests" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/product-requests/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setReqs(prev => prev.filter(r => r.id !== id));
      showToast({ title: "Request deleted", type: "info" });
    } catch {
      showToast({ type: "error", title: "Delete failed" });
    } finally { setDeleting(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", letterSpacing: "1px" }}>
          {reqs.length} {t("upload_pending", lang)}
        </div>
        <button onClick={load} style={{ background: "none", border: "none", color: "var(--text-mono)", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontFamily: "Manrope, sans-serif" }}>
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> {t("upload_refresh", lang)}
        </button>
      </div>

      {/* Empty state */}
      {!loading && reqs.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 24px", borderRadius: "16px", border: "1px dashed var(--border)", background: "var(--surface)" }}>
          <Inbox size={28} style={{ color: "var(--text-mono)", marginBottom: "10px" }} />
          <div style={{ ...sg, fontSize: "15px", fontWeight: 600, color: "var(--text-mono)" }}>{t("upload_no_requests", lang)}</div>
        </div>
      )}

      {/* List */}
      <AnimatePresence>
        {reqs.map(req => {
          const fields = parseDescription(req.description);
          const isOpen = expanded === req.id;
          return (
            <motion.div key={req.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}
              style={{ borderRadius: "14px", background: "var(--surface)", border: "1px solid var(--border)", overflow: "hidden" }}>

              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", cursor: "pointer" }}
                onClick={() => setExpanded(isOpen ? null : req.id)}>
                {/* Category badge */}
                <div style={{
                  flexShrink: 0, padding: "3px 10px", borderRadius: "6px",
                  background: "var(--violet-glow-bg)", border: "1px solid var(--violet-glow-soft)",
                  ...mono, fontSize: "10px", color: "var(--violet-text)", letterSpacing: "0.5px", textTransform: "capitalize",
                }}>
                  {req.category}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* First meaningful field as preview */}
                  <div style={{ ...mono, fontSize: "11px", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fields.find(f => f.key === "Details")?.value ?? req.description.slice(0, 80)}
                  </div>
                  <div style={{ ...mono, fontSize: "9px", color: "var(--text-mono)", marginTop: "2px" }}>
                    {formatRelative(req.createdAt)} · #{req.id}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(req.id); }}
                    disabled={deleting === req.id}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(239,68,68,0.4)", padding: "4px", display: "flex", alignItems: "center", transition: "color 0.2s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "rgba(239,68,68,0.8)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(239,68,68,0.4)"; }}>
                    <Trash2 size={13} />
                  </button>
                  {isOpen ? <ChevronUp size={14} style={{ color: "var(--text-mono)" }} /> : <ChevronDown size={14} style={{ color: "var(--text-mono)" }} />}
                </div>
              </div>

              {/* Expanded details */}
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: "hidden" }}>
                    <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      {fields.length > 0 ? fields.map(f => (
                        <div key={f.key} style={{ display: "flex", gap: "10px" }}>
                          <span style={{ ...mono, fontSize: "9px", color: "var(--cyan-text-dim)", textTransform: "uppercase", letterSpacing: "1px", minWidth: "110px", flexShrink: 0, paddingTop: "1px" }}>
                            {f.key}
                          </span>
                          <span style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.5, fontFamily: "Manrope, sans-serif" }}>
                            {f.value}
                          </span>
                        </div>
                      )) : (
                        <p style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.6, margin: 0, fontFamily: "Manrope, sans-serif" }}>
                          {req.description}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Catalog management panel ─────────────────────────────────────────────────
interface CatalogItem {
  id: number;
  description: string;
  filePath: string;
}

function CatalogPanel() {
  const { language: lang } = useSettings();
  const [items, setItems]         = useState<CatalogItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [editId, setEditId]       = useState<number | null>(null);
  const [editText, setEditText]   = useState("");
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<number | null>(null);

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/factory/designs");
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      showToast({ type: "error", title: "Failed to load catalog" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm(lang === "ar" ? "هل أنت متأكد من الحذف؟" : "Delete this reference?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/factory/designs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setItems(prev => prev.filter(i => i.id !== id));
      showToast({ title: t("cat_deleted", lang), type: "info" });
    } catch {
      showToast({ type: "error", title: "Delete failed" });
    } finally { setDeleting(null); }
  };

  const handleEdit = (item: CatalogItem) => {
    setEditId(item.id);
    setEditText(item.description);
  };

  const handleSave = async () => {
    if (!editId || !editText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/factory/designs/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editText.trim() }),
      });
      if (!res.ok) throw new Error("Update failed");
      setItems(prev => prev.map(i => i.id === editId ? { ...i, description: editText.trim() } : i));
      setEditId(null);
      showToast({ title: t("cat_updated", lang), type: "success" });
    } catch {
      showToast({ type: "error", title: "Update failed" });
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", letterSpacing: "1px" }}>
          {items.length} {t("cat_references", lang)}
        </div>
        <button onClick={load} style={{ background: "none", border: "none", color: "var(--text-mono)", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontFamily: "Manrope, sans-serif" }}>
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> {t("upload_refresh", lang)}
        </button>
      </div>

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 24px", borderRadius: "16px", border: "1px dashed var(--border)", background: "var(--surface)" }}>
          <Image size={28} style={{ color: "var(--text-mono)", marginBottom: "10px" }} />
          <div style={{ ...sg, fontSize: "15px", fontWeight: 600, color: "var(--text-mono)" }}>{t("cat_empty", lang)}</div>
        </div>
      )}

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "14px" }}>
        <AnimatePresence>
          {items.map(item => (
            <motion.div key={item.id}
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              style={{ borderRadius: "14px", background: "var(--surface)", border: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>

              {/* Thumbnail */}
              <div style={{ width: "100%", aspectRatio: "4/3", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                <img src={`/${item.filePath}`} alt={item.description}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>

              {/* Info */}
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                {editId === item.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <textarea value={editText} onChange={e => setEditText(e.target.value)}
                      rows={3}
                      style={{
                        width: "100%", padding: "8px 10px", borderRadius: "8px",
                        background: "var(--bg)", border: "1px solid var(--cyan-glow)",
                        color: "var(--text)", fontSize: "12px", resize: "none", outline: "none",
                        fontFamily: "Manrope, sans-serif", boxSizing: "border-box", lineHeight: 1.5,
                      }} />
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={handleSave} disabled={saving || !editText.trim()}
                        style={{ flex: 1, padding: "6px", borderRadius: "8px", border: "none", cursor: "pointer", background: "var(--cyan-glow-bg)", color: "var(--cyan-text)", fontSize: "11px", fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                        <Check size={12} /> {t("cat_save", lang)}
                      </button>
                      <button onClick={() => setEditId(null)}
                        style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid var(--border)", cursor: "pointer", background: "transparent", color: "var(--text-mono)", fontSize: "11px", fontFamily: "'Space Grotesk', sans-serif" }}>
                        {t("cat_cancel", lang)}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ ...mono, fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const }}>
                      {item.description}
                    </div>
                    <div style={{ ...mono, fontSize: "9px", color: "var(--text-mono)" }}>#{item.id}</div>
                  </>
                )}
              </div>

              {/* Actions */}
              {editId !== item.id && (
                <div style={{ display: "flex", borderTop: "1px solid var(--border)" }}>
                  <button onClick={() => handleEdit(item)}
                    style={{ flex: 1, padding: "8px", border: "none", cursor: "pointer", background: "transparent", color: "var(--cyan-text-dim)", fontSize: "11px", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", transition: "background 0.2s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--cyan-glow-bg)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                    <Pencil size={11} /> {t("cat_edit", lang)}
                  </button>
                  <div style={{ width: "1px", background: "var(--border)" }} />
                  <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id}
                    style={{ flex: 1, padding: "8px", border: "none", cursor: "pointer", background: "transparent", color: "var(--error-text)", fontSize: "11px", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", transition: "background 0.2s", opacity: deleting === item.id ? 0.5 : 1 }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                    <Trash2 size={11} /> {t("cat_delete", lang)}
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Upload form ───────────────────────────────────────────────────────────────
function UploadForm() {
  const { language: lang } = useSettings();
  const [description, setDescription] = useState("");
  const [file, setFile]               = useState<File | null>(null);
  const [preview, setPreview]         = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver]       = useState(false);
  const [uploaded, setUploaded]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const handleFile = (f: File) => {
    if (f.size > MAX_FILE_SIZE) {
      showToast({ type: "error", title: "File too large", description: "Maximum file size is 10MB." });
      return;
    }
    if (!f.type.startsWith("image/")) {
      showToast({ type: "error", title: "Invalid file", description: "Please upload an image file (PNG, JPG, SVG)." });
      return;
    }
    setFile(f); setPreview(URL.createObjectURL(f)); setUploaded(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  };

  const handleRemove = () => {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!file || !description.trim()) {
      showToast({ type: "error", title: "Missing fields", description: "Please provide both an image and description." });
      return;
    }
    setIsUploading(true);
    try {
      await uploadProduct(file, description);
      setUploaded(true);
      showToast({ type: "success", title: "Upload successful!", description: "Product added to the factory catalog." });
      setTimeout(() => { handleRemove(); setDescription(""); setUploaded(false); setIsUploading(false); }, 1500);
    } catch (e: unknown) {
      showToast({ type: "error", title: "Upload failed", description: e instanceof Error ? e.message : "Error" });
      setIsUploading(false);
    }
  };

  const canSubmit = !!file && description.trim().length > 0 && !isUploading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", flex: 1 }}>
      {/* Drop zone */}
      {!preview ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            flex: 1, minHeight: "200px", borderRadius: "18px", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px",
            transition: "all 0.3s ease",
            border: dragOver ? "2px solid var(--cyan-glow)" : "2px dashed var(--cyan-glow-soft)",
            background: dragOver ? "var(--cyan-glow-bg)" : "var(--surface)",
            boxShadow: dragOver ? "0 0 40px var(--cyan-glow-soft), inset 0 0 30px var(--cyan-glow-bg)" : "none",
          }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "16px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cyan-glow-bg)", border: "1px solid var(--cyan-glow-soft)", boxShadow: "0 0 20px var(--cyan-glow-soft)" }}>
            <UploadCloud size={24} style={{ color: "var(--cyan-text)" }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "16px", marginBottom: "6px" }}>{t("upload_drag", lang)}</div>
            <div style={{ ...mono, fontSize: "11px", color: "var(--text-mono)", letterSpacing: "1px" }}>PNG · JPG · SVG — up to 10MB</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: "200px", borderRadius: "18px", overflow: "hidden", border: "1px solid var(--cyan-glow-soft)", position: "relative", background: "var(--surface)" }}>
          <img src={preview} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          <button onClick={handleRemove} style={{ position: "absolute", top: "12px", right: "12px", width: "30px", height: "30px", borderRadius: "8px", background: "rgba(0,0,0,0.7)", border: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={14} />
          </button>
          <div style={{ position: "absolute", bottom: "12px", left: "12px", display: "flex", alignItems: "center", gap: "6px", padding: "5px 10px", borderRadius: "8px", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}>
            <FileImage size={11} style={{ color: "var(--cyan-text)" }} />
            <span style={{ ...mono, fontSize: "10px", color: "var(--text-dim)" }}>{file?.name}</span>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {/* Description */}
      <div>
        <div style={{ ...mono, fontSize: "10px", letterSpacing: "2.5px", color: "var(--text-mono)", textTransform: "uppercase", marginBottom: "10px" }}>{t("upload_desc", lang)}</div>
        <textarea
          value={description} onChange={e => setDescription(e.target.value)}
          placeholder={t("upload_desc_hint", lang)}
          rows={4}
          style={{ width: "100%", padding: "14px 16px", borderRadius: "14px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: "13px", lineHeight: 1.6, resize: "none", outline: "none", fontFamily: "Manrope, sans-serif", transition: "border-color 0.2s", boxSizing: "border-box" }}
          onFocus={e => { e.target.style.borderColor = "var(--cyan-glow)"; }}
          onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
          <span style={{ ...mono, fontSize: "10px", color: "var(--text-mono)" }}>{t("upload_desc_hint", lang)}</span>
          <span style={{ ...mono, fontSize: "10px", color: description.length > 20 ? "var(--cyan-text-dim)" : "var(--text-mono)" }}>{description.length} {t("upload_chars", lang)}</span>
        </div>
      </div>

      {/* Submit */}
      <motion.button whileHover={canSubmit ? { translateY: -2 } : {}} whileTap={canSubmit ? { scale: 0.98 } : {}}
        onClick={handleSubmit} disabled={!canSubmit}
        style={{ width: "100%", padding: "15px", borderRadius: "14px", cursor: canSubmit ? "pointer" : "not-allowed", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "15px", background: uploaded ? "linear-gradient(135deg,#00E5FF,#7C3AED)" : canSubmit ? "linear-gradient(135deg,#00E5FF,#3df2ff)" : "var(--surface)", border: "none", color: canSubmit ? "#021018" : "var(--text-mono)", boxShadow: canSubmit ? "0 0 28px var(--cyan-glow)" : "none", transition: "all 0.3s ease" }}>
        {isUploading ? t("upload_processing", lang) : uploaded ? `✅ ${t("upload_added", lang)}` : t("upload_add", lang)}
      </motion.button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type Tab = "upload" | "requests" | "catalog";

export default function UploadPage() {
  const { language: lang } = useSettings();
  const [tab, setTab] = useState<Tab>("upload");
  const [reqCount, setReqCount] = useState(0);

  // Poll request count for badge
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/product-requests");
        if (res.ok) { const data = await res.json(); setReqCount(Array.isArray(data) ? data.length : 0); }
      } catch { /* ignore */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [tab]); // refetch when switching tabs

  // Non-admins: redirect only if they're actually on /upload, otherwise render nothing (page is hidden anyway)
  const role = localStorage.getItem("holo3d_role") ?? "user";
  if (role !== "admin") {
    if (window.location.pathname === "/upload") window.location.href = "/";
    return null;
  }

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px", borderRadius: "10px", cursor: "pointer", border: "none",
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "13px",
    transition: "all 0.2s",
    background: active ? "var(--cyan-glow-bg)" : "transparent",
    color: active ? "var(--cyan-text)" : "var(--text-mono)",
    borderBottom: active ? "2px solid var(--cyan-glow)" : "2px solid transparent",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: "24px" }}>
        <div style={{ ...mono, fontSize: "11px", letterSpacing: "4px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "10px" }}>
          {t("upload_admin", lang)}
        </div>
        <h1 style={{ ...sg, fontWeight: 700, fontSize: "clamp(28px,4vw,42px)", letterSpacing: "-1px", margin: "0 0 20px" }}>
          {tab === "upload" ? t("upload_ref", lang) : tab === "requests" ? t("upload_requests", lang) : t("cat_manage", lang)}
        </h1>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", paddingBottom: "0" }}>
          <button style={tabStyle(tab === "upload")} onClick={() => setTab("upload")}>
            {t("upload_catalog", lang)}
          </button>
          <button style={tabStyle(tab === "catalog")} onClick={() => setTab("catalog")}>
            {t("cat_tab", lang)}
          </button>
          <button style={{ ...tabStyle(tab === "requests"), display: "flex", alignItems: "center", gap: "8px" }} onClick={() => setTab("requests")}>
            {t("upload_inbox", lang)}
            {reqCount > 0 && (
              <span style={{
                minWidth: "20px", height: "20px", borderRadius: "10px",
                background: "linear-gradient(135deg, #7C3AED, #a78bfa)",
                color: "#fff", fontSize: "11px", fontWeight: 700,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 6px", fontFamily: "'JetBrains Mono', monospace",
              }}>
                {reqCount}
              </span>
            )}
          </button>
        </div>
      </motion.div>

      {/* Content */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        style={{ flex: 1 }}>
        {tab === "upload" ? <UploadForm /> : tab === "catalog" ? <CatalogPanel /> : <RequestsPanel />}
      </motion.div>
    </div>
  );
}
