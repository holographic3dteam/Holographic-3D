import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { SESSION_KEY } from "@/pages/login";
import { useSettings, t } from "@/contexts/settings-context";

// ── Shared style tokens ────────────────────────────────────────────────────────
const mono = { fontFamily: "'JetBrains Mono', monospace" } as const;
const sg   = { fontFamily: "'Space Grotesk', sans-serif" } as const;

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "13px 16px", borderRadius: "12px",
  background: "var(--surface)", border: "1px solid var(--border)",
  color: "var(--text)", fontSize: "14px", outline: "none",
  fontFamily: "Manrope, sans-serif", transition: "border-color 0.2s",
  boxSizing: "border-box",
};
const focusCyan  = (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = "var(--cyan-glow)"; };
const blurNormal = (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = "var(--border)"; };

const FieldLabel = ({ text }: { text: string }) => (
  <div style={{ ...mono, fontSize: "10px", letterSpacing: "2px", color: "var(--text-mono)", textTransform: "uppercase", marginBottom: "8px" }}>
    {text}
  </div>
);

const ErrorBox = ({ msg }: { msg: string }) => (
  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
    style={{ padding: "10px 14px", borderRadius: "10px", background: "var(--error-bg)", border: `1px solid var(--error-border)`, color: "var(--error-text)", fontSize: "12px", fontFamily: "Manrope, sans-serif" }}>
    {msg}
  </motion.div>
);

// ── Password strength ──────────────────────────────────────────────────────────
function getStrength(pw: string): { level: number; label: string; color: string } {
  if (!pw) return { level: 0, label: "", color: "transparent" };
  let score = 0;
  if (pw.length >= 8)              score++;
  if (/[A-Z]/.test(pw))           score++;
  if (/[0-9]/.test(pw))           score++;
  if (/[^A-Za-z0-9]/.test(pw))    score++;
  const map = [
    { level: 1, label: "Weak",   color: "#ef4444" },
    { level: 2, label: "Fair",   color: "#f97316" },
    { level: 3, label: "Good",   color: "#eab308" },
    { level: 4, label: "Strong", color: "#22c55e" },
  ];
  return map[Math.min(score, 4) - 1] ?? { level: 0, label: "", color: "transparent" };
}

// ── RegisterPage ───────────────────────────────────────────────────────────────
export default function RegisterPage() {
  const { language: lang } = useSettings();
  const [username,   setUsername]   = useState("");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [confirm,    setConfirm]    = useState("");
  const [showPass,   setShowPass]   = useState(false);
  const [showConf,   setShowConf]   = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");

  const strength = getStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim() || !email.trim() || !password || !confirm) {
      setError("All fields are required."); return;
    }
    if (username.trim().length < 3) {
      setError("Username must be at least 3 characters."); return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters."); return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Please enter a valid email address."); return;
    }
    if (password !== confirm) {
      setError("Passwords do not match."); return;
    }

    setLoading(true);
    try {
      const res  = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed."); return; }

      // Auto-login after successful registration
      localStorage.setItem(SESSION_KEY, "1");
      localStorage.setItem("holo3d_role",     data.role     ?? "user");
      localStorage.setItem("holo3d_username", data.username ?? username.trim());
      localStorage.setItem("holo3d_email",    data.email    ?? email.trim());
      window.location.href = "/";
    } catch {
      setError("Could not reach the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg)",
      backgroundImage: "radial-gradient(ellipse 60% 50% at 50% -10%, rgba(0,229,255,0.07) 0%, transparent 70%)",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "fixed", top: "20%", left: "50%", transform: "translateX(-50%)",
        width: "600px", height: "300px", borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(0,229,255,0.04) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: "100%", maxWidth: "420px", margin: "24px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "20px", padding: "40px 36px",
          backdropFilter: "blur(20px)",
          boxShadow: "0 32px 64px var(--shadow-heavy), 0 0 0 1px var(--surface)",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ ...sg, fontSize: "22px", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.5px" }}>
            Holographic <span style={{ color: "var(--cyan-text)" }}>3D</span>
          </div>
          <div style={{ ...mono, fontSize: "9px", letterSpacing: "4px", color: "var(--text-mono)", marginTop: "6px", textTransform: "uppercase" }}>
            {t("reg_create", lang)}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Username */}
          <div>
            <FieldLabel text={t("reg_username", lang)} />
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder={t("reg_username", lang)}
              style={inputStyle}
              onFocus={focusCyan}
              onBlur={blurNormal}
              autoComplete="username"
              autoFocus
            />
          </div>

          {/* Email */}
          <div>
            <FieldLabel text={t("reg_email", lang)} />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t("reg_email", lang)}
              style={inputStyle}
              onFocus={focusCyan}
              onBlur={blurNormal}
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div>
            <FieldLabel text={t("reg_password", lang)} />
            <div style={{ position: "relative" }}>
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t("reg_password", lang)}
                style={{ ...inputStyle, paddingRight: "44px" }}
                onFocus={focusCyan}
                onBlur={blurNormal}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPass(v => !v)}
                style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-mono)", padding: 0 }}>
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {/* Strength bar */}
            {password && (
              <div style={{ marginTop: "8px" }}>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[1,2,3,4].map(i => (
                    <div key={i} style={{
                      flex: 1, height: "3px", borderRadius: "2px",
                      background: i <= strength.level ? strength.color : "var(--border)",
                      transition: "background 0.25s",
                    }} />
                  ))}
                </div>
                <div style={{ ...mono, fontSize: "9px", color: strength.color, marginTop: "5px", letterSpacing: "1px" }}>
                  {strength.label}
                </div>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <FieldLabel text={t("reg_confirm", lang)} />
            <div style={{ position: "relative" }}>
              <input
                type={showConf ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder={t("reg_confirm", lang)}
                style={{
                  ...inputStyle, paddingRight: "44px",
                  borderColor: confirm && confirm !== password ? "rgba(239,68,68,0.4)" : undefined,
                }}
                onFocus={focusCyan}
                onBlur={blurNormal}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowConf(v => !v)}
                style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-mono)", padding: 0 }}>
                {showConf ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <ErrorBox msg={error} />}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="hbtn hbtn-lg hbtn-primary"
            style={{ width: "100%", marginTop: "4px" }}
          >
            {loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
            {loading ? t("reg_creating", lang) : t("reg_create_btn", lang)}
          </button>

          {/* Link to login */}
          <div style={{ textAlign: "center", marginTop: "4px" }}>
            <span style={{ fontFamily: "Manrope, sans-serif", fontSize: "12px", color: "var(--text-mono)" }}>
              {t("reg_has_account", lang)}{" "}
            </span>
            <a
              href="/login"
              onClick={e => { e.preventDefault(); window.location.href = "/"; }}
              style={{ fontFamily: "Manrope, sans-serif", fontSize: "12px", color: "var(--cyan-text)", textDecoration: "none" }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.7")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              {t("reg_signin", lang)}
            </a>
          </div>
        </form>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </motion.div>
    </div>
  );
}
