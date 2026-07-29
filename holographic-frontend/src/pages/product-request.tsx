import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { showToast } from "@/components/ui/custom-toast";
import { SCHEMA, Category } from "@/configuratorSchema";
import { Send, CheckCircle } from "lucide-react";
import { useSettings, t } from "@/contexts/settings-context";

type RequestCategory = Category | "other";
type Material = "wood" | "fabric" | "metal" | "leather" | "mixed" | "other";

const MATERIALS: { value: Material; label: string }[] = [
  { value: "wood",    label: "Wood"    },
  { value: "fabric",  label: "Fabric"  },
  { value: "metal",   label: "Metal"   },
  { value: "leather", label: "Leather" },
  { value: "mixed",   label: "Mixed"   },
  { value: "other",   label: "Other"   },
];

function buildDescription(fields: {
  furnitureType: string;
  material: Material;
  colorFinish: string;
  dimensions: string;
  quantity: number;
  details: string;
}): string {
  const lines: string[] = [];
  if (fields.furnitureType) lines.push(`[Furniture Type]: ${fields.furnitureType}`);
  lines.push(`[Material]: ${fields.material}`);
  if (fields.colorFinish.trim()) lines.push(`[Color / Finish]: ${fields.colorFinish.trim()}`);
  if (fields.dimensions.trim()) lines.push(`[Dimensions]: ${fields.dimensions.trim()}`);
  lines.push(`[Quantity]: ${fields.quantity}`);
  if (fields.details.trim()) lines.push(`[Details]: ${fields.details.trim()}`);
  return lines.join("\n");
}

export default function ProductRequest() {
  const { language: lang } = useSettings();
  const [category, setCategory]       = useState<RequestCategory>("chair");
  const [furnitureType, setFurnitureType] = useState("");  // for "other"
  const [material, setMaterial]       = useState<Material>("wood");
  const [colorFinish, setColorFinish] = useState("");
  const [dimensions, setDimensions]   = useState("");
  const [quantity, setQuantity]       = useState(1);
  const [details, setDetails]         = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [submitted, setSubmitted]     = useState(false);

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 14px", borderRadius: "12px",
    background: "var(--surface)", border: "1px solid var(--border)",
    color: "var(--text)", fontSize: "13px", outline: "none",
    fontFamily: "Manrope, sans-serif", transition: "border-color 0.2s",
    boxSizing: "border-box",
  };
  const focusCyan  = (e: React.FocusEvent<HTMLElement>) => { (e.target as HTMLElement).style.borderColor = "var(--cyan-glow)"; };
  const blurNormal = (e: React.FocusEvent<HTMLElement>) => { (e.target as HTMLElement).style.borderColor = "var(--border)"; };
  const focusViolet = (e: React.FocusEvent<HTMLElement>) => { (e.target as HTMLElement).style.borderColor = "var(--violet-glow)"; };

  const canSubmit = details.trim().length >= 15 &&
    (category !== "other" || furnitureType.trim().length >= 2);

  const handleSubmit = async () => {
    if (category === "other" && furnitureType.trim().length < 2) {
      showToast({ type: "error", title: "Missing furniture type", description: "Please specify what type of furniture you need (at least 2 characters)." });
      return;
    }
    if (details.trim().length < 15) {
      showToast({ type: "error", title: "Details too short", description: "Please add at least 15 characters of detail so we can understand your request." });
      return;
    }

    const finalCategory = category === "other" ? furnitureType.trim() : category;
    const description = buildDescription({
      furnitureType: category === "other" ? furnitureType.trim() : SCHEMA[category as Category].label,
      material, colorFinish, dimensions, quantity, details,
    });

    setSubmitting(true);
    try {
      const res = await fetch("/api/product-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: finalCategory, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSubmitted(true);
      showToast({ type: "success", title: "Request submitted!", description: "The factory team will review it." });
      // Reset form immediately — don't use a timer that can wipe new input
      setFurnitureType(""); setColorFinish(""); setDimensions("");
      setDetails(""); setQuantity(1); setMaterial("wood");
      setCategory("chair");
      setTimeout(() => setSubmitted(false), 2000);
    } catch (e: unknown) {
      showToast({ type: "error", title: "Failed to submit", description: e instanceof Error ? e.message : "Server error" });
    } finally { setSubmitting(false); }
  };

  const FieldLabel = ({ text }: { text: string }) => (
    <div style={{ ...mono, fontSize: "10px", letterSpacing: "2.5px", color: "var(--text-mono)", textTransform: "uppercase", marginBottom: "8px" }}>
      {text}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{`
        @media (max-width: 768px) {
          .request-row-2col { grid-template-columns: 1fr !important; }
          .request-row-qty { grid-template-columns: 1fr auto !important; }
        }
      `}</style>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: "28px" }}>
        <div style={{ ...mono, fontSize: "11px", letterSpacing: "4px", color: "var(--violet-text-dim)", textTransform: "uppercase", marginBottom: "10px" }}>
          {t("req_custom", lang)}
        </div>
        <h1 style={{ ...sg, fontWeight: 700, fontSize: "clamp(26px,4vw,40px)", letterSpacing: "-1px", margin: "0 0 8px" }}>
          {t("req_title", lang)}
        </h1>
        <p style={{ color: "var(--text-mono)", fontSize: "14px", lineHeight: 1.6, margin: 0 }}>
          {t("req_desc", lang)}
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        style={{ display: "flex", flexDirection: "column", gap: "20px", flex: 1 }}>

        {/* ── Category ── */}
        <div>
          <FieldLabel text={t("req_category", lang)} />
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {([...Object.keys(SCHEMA) as Category[], "other"] as RequestCategory[]).map(cat => (
              <motion.button key={cat} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setCategory(cat)}
                style={{
                  flex: 1, minWidth: "72px", padding: "10px 8px", borderRadius: "11px", cursor: "pointer",
                  fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "13px",
                  transition: "all 0.22s ease", textAlign: "center",
                  background: category === cat ? "linear-gradient(135deg, var(--violet-glow-bg), var(--cyan-glow-bg))" : "var(--surface)",
                  border: category === cat ? "1px solid var(--violet-glow)" : "1px solid var(--border)",
                  color: category === cat ? "var(--violet-text)" : "var(--text-dim)",
                  boxShadow: category === cat ? "0 0 18px var(--violet-glow-soft)" : "none",
                }}>
                {cat === "other" ? t("req_other", lang) : t(`cat_${cat}`, lang)}
              </motion.button>
            ))}
          </div>

          {/* Other — furniture type name */}
          <AnimatePresence>
            {category === "other" && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: "auto", marginTop: 10 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                style={{ overflow: "hidden" }}>
                <input
                  value={furnitureType}
                  onChange={e => setFurnitureType(e.target.value)}
                  placeholder={t("req_ph_furniture", lang)}
                  maxLength={60}
                  style={{ ...inputStyle, borderColor: "var(--violet-glow)" }}
                  onFocus={focusViolet} onBlur={blurNormal}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                  <span style={{ ...mono, fontSize: "9px", color: furnitureType.length >= 2 ? "var(--violet-text-dim)" : "var(--text-mono)" }}>
                    {furnitureType.length}/60
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Row: Material + Quantity ── */}
        <div className="request-row-qty" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px" }}>
          <div>
            <FieldLabel text={t("req_material", lang)} />
            <select
              value={material}
              onChange={e => setMaterial(e.target.value as Material)}
              style={{
                ...inputStyle,
                appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(0,229,255,0.5)' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
                paddingRight: "32px",
                cursor: "pointer",
              }}
              onFocus={focusCyan} onBlur={blurNormal}>
              {MATERIALS.map(m => (
                <option key={m.value} value={m.value} style={{ background: "var(--bg)" }}>{t(`req_mat_${m.value}`, lang)}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel text={t("req_qty", lang)} />
            <input
              type="number" min={1} max={999}
              value={quantity}
              onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: "80px", textAlign: "center" }}
              onFocus={focusCyan} onBlur={blurNormal}
            />
          </div>
        </div>

        {/* ── Row: Color/Finish + Dimensions ── */}
        <div className="request-row-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <FieldLabel text={t("req_color_finish", lang)} />
            <input
              value={colorFinish}
              onChange={e => setColorFinish(e.target.value)}
              placeholder={t("req_ph_color", lang)}
              maxLength={60}
              style={inputStyle}
              onFocus={focusCyan} onBlur={blurNormal}
            />
          </div>
          <div>
            <FieldLabel text={t("req_dimensions", lang)} />
            <input
              value={dimensions}
              onChange={e => setDimensions(e.target.value)}
              placeholder={t("req_ph_dimensions", lang)}
              maxLength={60}
              style={inputStyle}
              onFocus={focusCyan} onBlur={blurNormal}
            />
          </div>
        </div>

        {/* ── Details ── */}
        <div style={{ flex: 1 }}>
          <FieldLabel text={t("req_details", lang)} />
          <textarea
            value={details}
            onChange={e => setDetails(e.target.value)}
            placeholder={t("req_ph_details", lang)}
            rows={5}
            style={{
              ...inputStyle,
              resize: "none", lineHeight: 1.7, minHeight: "120px",
            }}
            onFocus={focusCyan} onBlur={blurNormal}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px" }}>
            <span style={{ ...mono, fontSize: "9px", color: details.length >= 15 ? "var(--cyan-text-dim)" : "var(--error-text)" }}>
              {details.length < 15 ? `${15 - details.length} ${t("req_more_required", lang)}` : `✓ ${t("req_good", lang)}`}
            </span>
            <span style={{ ...mono, fontSize: "9px", color: "var(--text-mono)" }}>
              {details.length} {t("req_chars", lang)}
            </span>
          </div>
        </div>

        {/* ── Submit ── */}
        <motion.button
          whileHover={canSubmit && !submitting ? { translateY: -2 } : {}}
          whileTap={canSubmit && !submitting ? { scale: 0.98 } : {}}
          onClick={handleSubmit} disabled={submitting || !canSubmit}
          style={{
            width: "100%", padding: "15px", borderRadius: "14px",
            cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "15px",
            background: submitted
              ? "linear-gradient(135deg, #22c55e, #16a34a)"
              : canSubmit
              ? "linear-gradient(135deg, #7C3AED, #a78bfa)"
              : "var(--surface)",
            border: "none",
            color: canSubmit ? "#fff" : "var(--text-mono)",
            boxShadow: canSubmit ? "0 0 28px var(--violet-glow)" : "none",
            transition: "all 0.3s ease",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          }}>
          {submitted
            ? <><CheckCircle size={16} /> {t("req_submitted", lang)}</>
            : submitting
            ? t("req_submitting", lang)
            : <><Send size={16} /> {t("req_submit", lang)}</>}
        </motion.button>
      </motion.div>
    </div>
  );
}
