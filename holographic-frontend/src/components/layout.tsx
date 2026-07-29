import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { logout } from "@/pages/login";
import { useSettings, t, type Theme, type Language } from "@/contexts/settings-context";

// ── Nav definition (key used for i18n) ───────────────────────────────────────
const navItems = [
  {
    href: "/", key: "generate",
    icon: <svg width="22" height="22" viewBox="0 0 18 18" fill="currentColor"><path d="M9 1.6l1.7 4.6L15.4 8l-4.7 1.8L9 14.4l-1.7-4.6L2.6 8l4.7-1.8z"/></svg>
  },
  {
    href: "/saved", key: "saved",
    icon: <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2.6h8v13l-4-3-4 3z"/></svg>
  },
  {
    href: "/upload", key: "upload",
    icon: <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12V3M5 7l4-4 4 4M3 14.5h12"/></svg>
  },
  {
    href: "/request", key: "request",
    icon: <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 3.5h-11a1 1 0 00-1 1v9a1 1 0 001 1h11a1 1 0 001-1v-9a1 1 0 00-1-1z"/><path d="M2.5 6.5l6.5 4 6.5-4"/></svg>
  },
];

// ── Gear icon ─────────────────────────────────────────────────────────────────
const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

// ── Toggle card ───────────────────────────────────────────────────────────────
function ToggleCard<T extends string>({
  options, active, onSelect,
}: {
  options: { value: T; label: string }[];
  active:  T;
  onSelect: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "6px" }}>
      {options.map(opt => (
        <motion.button
          key={opt.value}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => onSelect(opt.value)}
          style={{
            flex: 1, padding: "8px 4px", borderRadius: "10px", cursor: "pointer",
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "11px",
            textAlign: "center", transition: "all 0.2s ease",
            background: active === opt.value
              ? "linear-gradient(135deg, var(--cyan-glow-bg), var(--violet-glow-bg))"
              : "var(--surface)",
            border: active === opt.value
              ? "1px solid var(--cyan-glow)"
              : "1px solid var(--border)",
            color: active === opt.value ? "var(--cyan-text)" : "var(--text-mono)",
            boxShadow: active === opt.value ? "0 0 14px var(--cyan-glow-bg)" : "none",
          }}>
          {opt.label}
        </motion.button>
      ))}
    </div>
  );
}

// ── Settings panel popup ──────────────────────────────────────────────────────
function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, language, setTheme, setLanguage } = useSettings();
  const sg = { fontFamily: "'Space Grotesk', sans-serif" } as const;
  const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;

  const SectionLabel = ({ label }: { label: string }) => (
    <div style={{ ...mono, fontSize: "9px", letterSpacing: "2.5px", color: "var(--text-mono)", textTransform: "uppercase" as const, marginBottom: "9px" }}>
      {label}
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: 0, right: 0,
            zIndex: 200,
            background: "var(--bg)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            border: "1px solid var(--cyan-glow-soft)",
            borderRadius: "16px",
            padding: "16px",
            boxShadow: "0 -16px 48px var(--shadow-heavy), 0 0 0 1px var(--cyan-glow-bg), inset 0 1px 0 var(--surface)",
          }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text)" }}>
              <GearIcon />
              <span style={{ ...sg, fontWeight: 700, fontSize: "14px" }}>
                {t("settings", language)}
              </span>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "var(--text-mono)", cursor: "pointer", fontSize: "13px", padding: "2px 5px", borderRadius: "5px", lineHeight: 1 }}>
              ✕
            </button>
          </div>

          {/* Appearance */}
          <div style={{ marginBottom: "14px" }}>
            <SectionLabel label={t("appearance", language)} />
            <ToggleCard<Theme>
              options={[
                { value: "dark",  label: `◐ ${t("dark",  language)}` },
                { value: "light", label: `○ ${t("light", language)}` },
              ]}
              active={theme}
              onSelect={v => { setTheme(v); onClose(); }}
            />
          </div>

          {/* Language */}
          <div style={{ marginBottom: "16px" }}>
            <SectionLabel label={t("language", language)} />
            <ToggleCard<Language>
              options={[
                { value: "en", label: "EN — English" },
                { value: "ar", label: "عربي — AR"    },
              ]}
              active={language}
              onSelect={v => { setLanguage(v); onClose(); }}
            />
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "var(--border)", marginBottom: "14px" }} />

          {/* Sign out */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={logout}
            style={{
              width: "100%", padding: "10px", borderRadius: "10px",
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
              color: "rgba(239,68,68,0.7)", fontSize: "11px", cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: "1.5px",
              textTransform: "uppercase" as const, transition: "all 0.2s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(239,68,68,0.12)";
              e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)";
              e.currentTarget.style.color = "#ef4444";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(239,68,68,0.06)";
              e.currentTarget.style.borderColor = "rgba(239,68,68,0.2)";
              e.currentTarget.style.color = "rgba(239,68,68,0.7)";
            }}>
            {t("signout", language)}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Main Layout ───────────────────────────────────────────────────────────────
export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const role = localStorage.getItem("holo3d_role") ?? "user";
  const isAdmin = role === "admin";
  const visibleNavItems = navItems.filter(item => item.href !== "/upload" || isAdmin);

  const { theme, language, setTheme, setLanguage } = useSettings();

  // Close settings panel on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // Generation indicator poll
  useEffect(() => {
    const check = () => setIsGenerating(!!localStorage.getItem("holo3d_is_generating"));
    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);

  // Admin: poll request count for notification badge
  const [requestCount, setRequestCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/product-requests");
        if (res.ok) { const data = await res.json(); setRequestCount(Array.isArray(data) ? data.length : 0); }
      } catch { /* ignore */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000); // every 30s
    return () => clearInterval(interval);
  }, [isAdmin]);

  // Close mobile menu on navigation
  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <div className="holo3d-app" style={{
      display: "flex",
      height: "100dvh",
      overflow: "hidden",
      background: "var(--bg)",
      backgroundImage: `
        radial-gradient(circle at 15% 10%, var(--cyan-glow-bg) 0%, transparent 40%),
        radial-gradient(circle at 85% 90%, var(--violet-glow-bg) 0%, transparent 45%)
      `,
      backgroundAttachment: "fixed",
      color: "var(--text)",
      fontFamily: "Manrope, system-ui, sans-serif",
    }}>

      {/* ── Sidebar Desktop ── */}
      <aside className="holo3d-sidebar sidebar-desktop" style={{
        width: "180px",
        flexShrink: 0,
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        padding: "20px 12px 16px",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "0 6px 20px", borderBottom: "1px solid var(--border)", marginBottom: "16px" }}>
          <div style={{
            width: "26px", height: "26px", flexShrink: 0,
            transform: "rotate(45deg)", borderRadius: "5px",
            border: "1.5px solid var(--cyan-glow)",
            background: "linear-gradient(135deg, var(--cyan-glow-bg), var(--violet-glow-bg))",
            boxShadow: "0 0 12px var(--cyan-glow)",
          }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "14px", letterSpacing: "-0.3px", lineHeight: 1 }}>
              Holo<span style={{ color: "var(--cyan-text)" }}>3D</span>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "7px", letterSpacing: "1.5px", color: "var(--text-mono)", textTransform: "uppercase", marginTop: "2px" }}>
              Wood Factory
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: "flex", flexDirection: "column", flex: 1, gap: "6px" }}>
          {visibleNavItems.map((item) => {
            const isActive = location === item.href;
            const showDot  = item.href === "/" && isGenerating && !isActive;
            return (
              <Link key={item.href} href={item.href} style={{ flex: 1, display: "flex" }}>
                <motion.div
                  className={isActive ? "nav-active-pulse" : undefined}
                  whileHover={{ scale: 1.04, y: -2, backgroundColor: "var(--surface-hover)" }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  style={{
                    flex: 1,
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: "7px",
                    borderRadius: "12px", cursor: "pointer",
                    background: isActive ? "var(--cyan-glow-bg)" : "transparent",
                    border: isActive ? "1px solid var(--cyan-glow-soft)" : "1px solid transparent",
                    color: isActive ? "var(--cyan-text)" : "var(--text-mono)",
                    position: "relative",
                  }}>
                  <div style={{ opacity: isActive ? 1 : 0.6 }}>{item.icon}</div>
                  <span style={{
                    fontFamily: "Manrope, sans-serif",
                    fontWeight: isActive ? 800 : 600,
                    fontSize: "13px", letterSpacing: "0.3px",
                    color: isActive ? "var(--cyan-text)" : "var(--text-mono)",
                    textTransform: "uppercase",
                  }}>
                    {t(item.key, language)}
                  </span>
                  {isActive && (
                    <div className="nav-dot-pulse" style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--cyan-text)", boxShadow: "0 0 6px var(--cyan-text)" }} />
                  )}
                  {showDot && (
                    <div style={{ position: "absolute", top: "10px", right: "10px", width: "6px", height: "6px", borderRadius: "50%", background: "var(--cyan-text)", boxShadow: "0 0 8px var(--cyan-text)", animation: "blink 1s ease infinite" }} />
                  )}
                  {/* Request count badge for admin on Upload nav */}
                  {item.href === "/upload" && requestCount > 0 && (
                    <div style={{
                      position: "absolute", top: "6px", right: "6px",
                      minWidth: "18px", height: "18px", borderRadius: "9px",
                      background: "linear-gradient(135deg, #7C3AED, #a78bfa)",
                      color: "#fff", fontSize: "10px", fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "0 5px", fontFamily: "'JetBrains Mono', monospace",
                      boxShadow: "0 0 8px rgba(124,58,237,0.5)",
                    }}>
                      {requestCount}
                    </div>
                  )}
                </motion.div>
              </Link>
            );
          })}
        </nav>

        {/* ── Status + Settings ── */}
        <div
          ref={settingsRef}
          style={{ paddingTop: "14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "10px", position: "relative" }}>

          {/* Panel pops up above this section */}
          <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

          {/* Online indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "center" }}>
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--cyan-text)", boxShadow: "0 0 6px var(--cyan-text)", animation: "blink 2.4s ease infinite" }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", letterSpacing: "1px", color: "var(--text-mono)", textTransform: "uppercase" }}>
              {t("online", language)}
            </span>
          </div>

          {/* Settings button */}
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setSettingsOpen(v => !v)}
            style={{
              width: "100%", padding: "8px", borderRadius: "10px",
              background: settingsOpen ? "var(--cyan-glow-bg)" : "none",
              border: settingsOpen
                ? "1px solid var(--cyan-glow-soft)"
                : "1px solid var(--border)",
              color: settingsOpen ? "var(--cyan-text)" : "var(--text-mono)",
              fontSize: "10px", cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: "1.5px",
              textTransform: "uppercase", transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
              boxShadow: settingsOpen ? "0 0 14px var(--cyan-glow-bg)" : "none",
            }}
            onMouseEnter={e => {
              if (!settingsOpen) {
                e.currentTarget.style.borderColor = "var(--cyan-glow-soft)";
                e.currentTarget.style.color = "var(--cyan-text-dim)";
              }
            }}
            onMouseLeave={e => {
              if (!settingsOpen) {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-mono)";
              }
            }}>
            <GearIcon />
            {t("settings", language)}
          </motion.button>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="mobile-topbar" style={{
        display: "none",
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        height: "56px", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px",
        background: "var(--bg)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "22px", height: "22px", transform: "rotate(45deg)", borderRadius: "4px", border: "1.5px solid var(--cyan-glow)", background: "linear-gradient(135deg, var(--cyan-glow-bg), var(--violet-glow-bg))" }} />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "14px" }}>
            Holo<span style={{ color: "var(--cyan-text)" }}>3D</span>
          </span>
        </div>
        <button onClick={() => setMobileOpen(v => !v)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: "8px" }}>
          {mobileOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
          )}
        </button>
      </div>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="mobile-menu" style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "var(--bg)", paddingTop: "64px",
          display: "flex", flexDirection: "column",
        }}>
          <nav style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "16px", flex: 1 }}>
            {visibleNavItems.map(item => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "14px 16px", borderRadius: "12px",
                    background: isActive ? "var(--cyan-glow-bg)" : "transparent",
                    border: isActive ? "1px solid var(--cyan-glow-soft)" : "1px solid transparent",
                    color: isActive ? "var(--cyan-text)" : "var(--text-dim)",
                    fontSize: "16px", fontWeight: 600, cursor: "pointer",
                  }}>
                    {item.icon}
                    {t(item.key, language)}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Mobile settings + sign out */}
          <div style={{ padding: "16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "8px" }}>
            {/* Theme toggle */}
            <div style={{ display: "flex", gap: "8px" }}>
              {(["dark", "light"] as const).map(th => (
                <button key={th} onClick={() => { setTheme(th); setMobileOpen(false); }}
                  style={{
                    flex: 1, padding: "10px", borderRadius: "10px", cursor: "pointer",
                    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "13px",
                    background: theme === th ? "var(--cyan-glow-bg)" : "var(--surface)",
                    border: theme === th ? "1px solid var(--cyan-glow)" : "1px solid var(--border)",
                    color: theme === th ? "var(--cyan-text)" : "var(--text-mono)",
                  }}>
                  {th === "dark" ? `◐ ${t("dark", language)}` : `○ ${t("light", language)}`}
                </button>
              ))}
            </div>
            {/* Language toggle */}
            <div style={{ display: "flex", gap: "8px" }}>
              {(["en", "ar"] as const).map(lng => (
                <button key={lng} onClick={() => { setLanguage(lng); setMobileOpen(false); }}
                  style={{
                    flex: 1, padding: "10px", borderRadius: "10px", cursor: "pointer",
                    fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "13px",
                    background: language === lng ? "var(--cyan-glow-bg)" : "var(--surface)",
                    border: language === lng ? "1px solid var(--cyan-glow)" : "1px solid var(--border)",
                    color: language === lng ? "var(--cyan-text)" : "var(--text-mono)",
                  }}>
                  {lng === "en" ? "EN" : "عربي"}
                </button>
              ))}
            </div>
            {/* Sign out */}
            <button onClick={logout}
              style={{
                width: "100%", padding: "12px", borderRadius: "10px",
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
                color: "rgba(239,68,68,0.7)", fontSize: "13px", cursor: "pointer",
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600,
              }}>
              {t("signout", language)}
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="main-content" style={{ flex: 1, height: "100dvh", overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "36px 48px 60px", minHeight: "100%" }}>
          {children}
        </div>
      </main>

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .mobile-topbar { display: flex !important; }
          .main-content > div { padding: 72px 16px 40px !important; }
        }
      `}</style>
    </div>
  );
}
