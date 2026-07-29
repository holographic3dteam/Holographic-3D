import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { getHistoryFull, clearHistory, HistoryEntry } from "@/api";
import { showToast } from "@/components/ui/custom-toast";
import { Wand2, Trash2, Clock } from "lucide-react";
import { useSettings, t } from "@/contexts/settings-context";

function formatRelative(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (d.getFullYear() === 1970) return "";
    const now = Date.now();
    const diff = now - d.getTime();
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

export default function HistoryPage() {
  const { language: lang } = useSettings();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loc, navigate] = useLocation();

  // Reload when navigating to this page
  useEffect(() => {
    if (loc === "/history") setHistory(getHistoryFull());
  }, [loc]);

  const handleLoad = (entry: HistoryEntry) => {
    localStorage.setItem("holo3d_load_prompt", entry.prompt);
    if (entry.category)   localStorage.setItem("holo3d_load_category", entry.category);
    if (entry.selections) localStorage.setItem("holo3d_load_selections", JSON.stringify(entry.selections));
    navigate("/");
    const hasSelections = entry.category && entry.selections && Object.keys(entry.selections).length > 0;
    showToast({
      title: "Design loaded!",
      description: hasSelections
        ? "Selections restored — hit Generate to run it."
        : "Hit Generate to run it.",
      type: "success",
    });
  };

  const handleClear = () => { clearHistory(); setHistory([]); showToast({ title: "History cleared", type: "info" }); };

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <div style={{ ...mono, fontSize: "11px", letterSpacing: "4px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "10px" }}>
            {t("hist_timeline", lang)}
          </div>
          <h1 style={{ ...sg, fontWeight: 700, fontSize: "clamp(28px,4vw,42px)", letterSpacing: "-1px", margin: 0 }}>
            {t("hist_prompt", lang)}
          </h1>
        </div>
        {history.length > 0 && (
          <button onClick={handleClear} style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 14px", borderRadius: "10px",
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
            color: "rgba(239,68,68,0.65)", fontSize: "12px", cursor: "pointer",
            fontFamily: "Manrope, sans-serif", fontWeight: 600,
          }}>
            <Trash2 size={12} /> {t("hist_clear", lang)}
          </button>
        )}
      </motion.div>

      {/* Content */}
      {history.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
          <div style={{
            width: "72px", height: "72px", borderRadius: "20px",
            background: "var(--surface)", border: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Clock size={28} style={{ color: "var(--text-mono)" }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ ...sg, fontWeight: 600, fontSize: "16px", marginBottom: "6px", color: "var(--text-dim)" }}>
              {t("hist_no_history", lang)}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-mono)" }}>
              {t("hist_gen_first", lang)}
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px", overflowY: "auto" }}>
          {history.map((entry, i) => {
            const ts = formatRelative(entry.savedAt);
            const hasSelections = entry.category && entry.selections && Object.keys(entry.selections).length > 0;
            return (
              <motion.div key={i}
                initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                className="hist-row"
                style={{
                  display: "flex", alignItems: "center", gap: "16px",
                  padding: "14px 18px", borderRadius: "12px",
                  borderLeft: "2px solid var(--cyan-glow-soft)",
                  background: "var(--surface)",
                  transition: "all 0.25s ease",
                }}>
                <span style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", width: "24px", textAlign: "right", flexShrink: 0 }}>
                  {history.length - i}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ ...mono, fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.5, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.prompt}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
                    {ts && (
                      <span style={{ ...mono, fontSize: "9px", color: "var(--text-mono)", letterSpacing: "0.5px" }}>
                        {ts}
                      </span>
                    )}
                    {hasSelections && (
                      <span style={{ ...mono, fontSize: "9px", padding: "1px 6px", borderRadius: "4px", background: "var(--cyan-glow-bg)", border: "1px solid var(--cyan-glow-soft)", color: "var(--cyan-text-dim)", letterSpacing: "0.5px" }}>
                        {entry.category}
                      </span>
                    )}
                  </div>
                </div>
                {/* Always-visible Use button */}
                <button onClick={() => handleLoad(entry)}
                  style={{
                    flexShrink: 0, display: "flex", alignItems: "center", gap: "5px",
                    padding: "6px 14px", borderRadius: "8px",
                    border: "1px solid var(--cyan-glow)", background: "var(--cyan-glow-bg)",
                    color: "var(--cyan-text)", fontFamily: "Manrope, sans-serif", fontWeight: 600, fontSize: "12px",
                    cursor: "pointer", boxShadow: "0 0 12px var(--cyan-glow-soft)",
                    opacity: 1, transform: "none",
                  }}>
                  <Wand2 size={11} /> {t("hist_use", lang)}
                </button>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
