// components/ui/custom-toast.tsx
// Custom toast that matches the Holographic3D design system

import { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  type?: ToastType;
  duration?: number;
}

// Global toast state
let _toasts: ToastData[] = [];
let _listeners: Array<(toasts: ToastData[]) => void> = [];

function notify() {
  _listeners.forEach(l => l([..._toasts]));
}

export function showToast(data: Omit<ToastData, "id">) {
  const id = Math.random().toString(36).slice(2);
  const toast: ToastData = { id, duration: 3500, type: "success", ...data };
  _toasts = [toast, ..._toasts].slice(0, 4);
  notify();
  setTimeout(() => {
    _toasts = _toasts.filter(t => t.id !== id);
    notify();
  }, toast.duration);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    _listeners.push(setToasts);
    return () => { _listeners = _listeners.filter(l => l !== setToasts); };
  }, []);

  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
  const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

  const colors: Record<ToastType, { border: string; dot: string; glow: string }> = {
    success: { border: "var(--cyan-glow-soft)", dot: "var(--cyan-text)", glow: "var(--cyan-glow-bg)" },
    error:   { border: "rgba(239,68,68,0.3)",  dot: "#ef4444", glow: "rgba(239,68,68,0.08)" },
    info:    { border: "var(--violet-glow)", dot: "var(--violet-text)", glow: "var(--violet-glow-bg)" },
  };

  return (
    <div style={{
      position: "fixed", bottom: "28px", left: "50%", transform: "translateX(-50%)",
      zIndex: 9999, display: "flex", flexDirection: "column-reverse", gap: "8px",
      alignItems: "center", pointerEvents: "none",
    }}>
      {toasts.map((toast, i) => {
        const c = colors[toast.type ?? "success"];
        return (
          <div key={toast.id} style={{
            pointerEvents: "auto",
            padding: "12px 18px",
            borderRadius: "14px",
            background: "var(--bg)",
            backdropFilter: "blur(20px)",
            border: `1px solid ${c.border}`,
            boxShadow: `0 8px 32px var(--shadow-heavy), 0 0 0 1px ${c.glow}`,
            display: "flex", alignItems: "flex-start", gap: "10px",
            minWidth: "260px", maxWidth: "360px",
            animation: "slideUpToast 0.3s ease",
            opacity: 1 - i * 0.15,
            transform: `scale(${1 - i * 0.04}) translateY(${i * -4}px)`,
            transition: "all 0.3s ease",
          }}>
            {/* Dot */}
            <div style={{
              width: "7px", height: "7px", borderRadius: "50%",
              background: c.dot, flexShrink: 0, marginTop: "4px",
              boxShadow: `0 0 8px ${c.dot}`,
            }} />
            <div>
              <div style={{ ...sg, fontWeight: 700, fontSize: "13px", color: "var(--text)", lineHeight: 1.3 }}>
                {toast.title}
              </div>
              {toast.description && (
                <div style={{ ...mono, fontSize: "11px", color: "var(--text-dim)", marginTop: "3px", lineHeight: 1.4 }}>
                  {toast.description}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <style>{`
        @keyframes slideUpToast {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}