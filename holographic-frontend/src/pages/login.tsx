import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { showToast } from "@/components/ui/custom-toast";
import { Loader2, Eye, EyeOff, Mail, CheckCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { useSettings, t } from "@/contexts/settings-context";

export const SESSION_KEY = "holo3d_logged_in";

export function isLoggedIn(): boolean {
  return localStorage.getItem(SESSION_KEY) === "1";
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("holo3d_role");
  localStorage.removeItem("holo3d_username");
  localStorage.removeItem("holo3d_email");
  window.location.href = "/";
}

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

// ── OTP input — 6 individual boxes ────────────────────────────────────────────
interface OtpInputProps {
  value: string[];
  onChange: (v: string[]) => void;
}
function OtpInput({ value, onChange }: OtpInputProps) {
  const ref0 = useRef<HTMLInputElement>(null);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);
  const ref4 = useRef<HTMLInputElement>(null);
  const ref5 = useRef<HTMLInputElement>(null);
  const refs = [ref0, ref1, ref2, ref3, ref4, ref5];

  const handleChange = (idx: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...value];
    next[idx] = digit;
    onChange(next);
    if (digit && idx < 5) refs[idx + 1].current?.focus();
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!value[idx] && idx > 0) {
        const next = [...value]; next[idx - 1] = "";
        onChange(next);
        refs[idx - 1].current?.focus();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      refs[idx - 1].current?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      refs[idx + 1].current?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const next = Array(6).fill("");
    text.split("").forEach((ch, i) => { next[i] = ch; });
    onChange(next);
    const nextFocus = Math.min(text.length, 5);
    refs[nextFocus].current?.focus();
  };

  return (
    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
      {value.map((digit, idx) => (
        <input
          key={idx}
          ref={refs[idx]}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={e => handleChange(idx, e.target.value)}
          onKeyDown={e => handleKeyDown(idx, e)}
          onPaste={handlePaste}
          onFocus={e => { e.target.select(); e.target.style.borderColor = "var(--cyan-glow)"; e.target.style.boxShadow = "0 0 12px var(--cyan-glow-bg)"; }}
          onBlur={e => { e.target.style.borderColor = digit ? "var(--cyan-glow-soft)" : "var(--border)"; e.target.style.boxShadow = "none"; }}
          style={{
            width: "46px", height: "56px", textAlign: "center",
            borderRadius: "12px", border: digit ? "1px solid var(--cyan-glow-soft)" : "1px solid var(--border)",
            background: digit ? "var(--cyan-glow-bg)" : "var(--surface)",
            color: "var(--cyan-text)", fontSize: "22px", fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace", outline: "none",
            transition: "all 0.15s ease", caretColor: "transparent",
            // gap between groups of 3
            ...(idx === 2 ? { marginRight: "8px" } : {}),
          }}
        />
      ))}
    </div>
  );
}

// ── Logo block — shared across steps ──────────────────────────────────────────
function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "36px" }}>
      <div style={{
        width: "40px", height: "40px", borderRadius: "12px",
        background: "linear-gradient(135deg, var(--cyan-glow-bg), var(--violet-glow-bg))",
        border: "1px solid var(--cyan-glow-soft)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 0 20px var(--cyan-glow-bg)",
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#00E5FF" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 17l10 5 10-5" stroke="#00E5FF" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 12l10 5 10-5" stroke="rgba(0,229,255,0.5)" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      </div>
      <div>
        <div style={{ ...sg, fontWeight: 700, fontSize: "17px", letterSpacing: "-0.3px" }}>Holo3D</div>
        <div style={{ ...mono, fontSize: "10px", color: "var(--cyan-text-dim)", letterSpacing: "2px", textTransform: "uppercase" }}>Wood Factory</div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
type Step = "login" | "forgot-email" | "forgot-verify" | "forgot-reset" | "forgot-done";

export default function LoginPage() {
  const { language: lang } = useSettings();
  // Login state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError]     = useState("");

  // Forgot-password state
  const [step, setStep]             = useState<Step>("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [otp, setOtp]               = useState<string[]>(Array(6).fill(""));
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [showNewPw, setShowNewPw]   = useState(false);
  const [fpLoading, setFpLoading]   = useState(false);
  const [fpError, setFpError]       = useState("");

  // Resend countdown
  const [resendCooldown, setResendCooldown] = useState(0);

  const userRef    = useRef<HTMLInputElement>(null);
  const emailRef   = useRef<HTMLInputElement>(null);

  useEffect(() => { userRef.current?.focus(); }, []);
  useEffect(() => { if (step === "forgot-email") setTimeout(() => emailRef.current?.focus(), 300); }, [step]);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // ── Login ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username.trim() || !password.trim()) { setLoginError("Please enter both username and password."); return; }
    setLoginLoading(true); setLoginError("");
    try {
      const res  = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.trim(), password }) });
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || "Login failed."); return; }
      localStorage.setItem(SESSION_KEY, "1");
      localStorage.setItem("holo3d_role",     data.role     ?? "user");
      localStorage.setItem("holo3d_username", data.username ?? username.trim());
      localStorage.setItem("holo3d_email",    data.email    ?? "");
      showToast({ title: "Welcome back!", type: "success" });
      window.location.href = "/";
    } catch { setLoginError("Could not reach the server. Is the backend running?"); }
    finally { setLoginLoading(false); }
  };

  // ── Forgot — step 1: send code ─────────────────────────────────────────────
  const handleSendCode = async () => {
    if (!resetEmail.trim()) { setFpError("Please enter your email address."); return; }
    setFpLoading(true); setFpError("");
    try {
      const res  = await fetch("/api/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail.trim() }),
        signal: AbortSignal.timeout(20000), // 20s timeout — SMTP can be slow
      });
      const data = await res.json();
      if (!res.ok) { setFpError(data.error || "Failed to send code."); return; }
      if (data.token) {
        setResetToken(data.token);
        setOtp(Array(6).fill(""));
        setStep("forgot-verify");
        setResendCooldown(60);
      } else {
        // Email not registered but we show same message (no enumeration)
        setFpError("If that email is registered, a code has been sent.");
      }
    } catch (e: unknown) {
      const msg = e instanceof DOMException && e.name === "TimeoutError"
        ? "Request timed out. The email server may be unreachable — check your SMTP settings."
        : "Could not reach the server.";
      setFpError(msg);
    }
    finally { setFpLoading(false); }
  };

  // Resend code (same as send, but token already in state)
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setFpLoading(true); setFpError("");
    try {
      const res  = await fetch("/api/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail.trim() }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      if (!res.ok) { setFpError(data.error || "Failed to resend code."); return; }
      if (data.token) { setResetToken(data.token); setOtp(Array(6).fill("")); setResendCooldown(60); showToast({ title: "New code sent!", type: "info" }); }
    } catch (e: unknown) {
      const msg = e instanceof DOMException && e.name === "TimeoutError"
        ? "Request timed out. The email server may be unreachable."
        : "Could not reach the server.";
      setFpError(msg);
    }
    finally { setFpLoading(false); }
  };

  // ── Forgot — step 2: verify code ──────────────────────────────────────────
  const otpValue = otp.join("");
  const otpReady = otpValue.length === 6;

  const handleVerify = async () => {
    if (!otpReady) return;
    setFpLoading(true); setFpError("");
    try {
      const res  = await fetch("/api/reset-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resetToken, code: otpValue }) });
      const data = await res.json();
      if (!res.ok) { setFpError(data.error || "Invalid code."); return; }
      setNewPw(""); setConfirmPw("");
      setStep("forgot-reset");
    } catch { setFpError("Could not reach the server."); }
    finally { setFpLoading(false); }
  };

  // Auto-verify when all 6 digits are filled (only on digit change, not after failed attempt)
  const prevOtpRef = useRef("");
  useEffect(() => {
    if (otpReady && step === "forgot-verify" && !fpLoading && otpValue !== prevOtpRef.current) {
      prevOtpRef.current = otpValue;
      handleVerify();
    }
  }, [otpValue, otpReady, step, fpLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Forgot — step 3: set new password ─────────────────────────────────────
  const handleResetPassword = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (newPw.length < 6)     { setFpError("Password must be at least 6 characters."); return; }
    if (newPw !== confirmPw)  { setFpError("Passwords don't match."); return; }
    setFpLoading(true); setFpError("");
    try {
      const res  = await fetch("/api/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resetToken, new_password: newPw }) });
      const data = await res.json();
      if (!res.ok) { setFpError(data.error || "Failed to reset password."); return; }
      setStep("forgot-done");
    } catch { setFpError("Could not reach the server."); }
    finally { setFpLoading(false); }
  };

  const goBack = () => { setStep("login"); setFpError(""); setResetEmail(""); setOtp(Array(6).fill("")); setNewPw(""); setConfirmPw(""); };

  // ── Shared submit button ───────────────────────────────────────────────────
  const SubmitBtn = ({ label, onClick, loading: ld, disabled: dis }: { label: string; onClick?: () => void; loading?: boolean; disabled?: boolean }) => (
    <motion.button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      whileHover={!ld && !dis ? { translateY: -1 } : {}}
      whileTap={!ld && !dis ? { scale: 0.98 } : {}}
      disabled={ld || dis}
      className="hbtn hbtn-lg hbtn-primary"
      style={{ width: "100%", marginTop: "4px" }}>
      {ld ? <><Loader2 size={15} className="animate-spin" /> Loading...</> : label}
    </motion.button>
  );

  // ── Ambient background ────────────────────────────────────────────────────
  const Bg = () => (
    <>
      <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: "500px", height: "300px", borderRadius: "50%", background: "radial-gradient(ellipse, var(--cyan-glow-bg) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "15%", left: "50%", transform: "translateX(-50%)", width: "400px", height: "200px", borderRadius: "50%", background: "radial-gradient(ellipse, var(--violet-glow-bg) 0%, transparent 70%)", pointerEvents: "none" }} />
    </>
  );

  const cardStyle: React.CSSProperties = {
    width: "min(420px, 100%)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "22px", padding: "40px 36px",
    boxShadow: "0 0 60px var(--shadow-heavy), 0 0 0 1px var(--surface) inset",
    backdropFilter: "blur(20px)",
    position: "relative",
  };

  const wrap: React.CSSProperties = {
    minHeight: "100vh", background: "var(--bg)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "24px", position: "relative", overflow: "hidden",
  };

  // ── Back link ─────────────────────────────────────────────────────────────
  const BackLink = ({ label = t("fp_back", lang) }: { label?: string }) => (
    <button
      onClick={goBack}
      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", color: "var(--text-mono)", fontSize: "12px", fontFamily: "Manrope, sans-serif", marginTop: "20px", padding: 0 }}
      onMouseEnter={e => e.currentTarget.style.color = "var(--cyan-text-dim)"}
      onMouseLeave={e => e.currentTarget.style.color = "var(--text-mono)"}>
      <ArrowLeft size={12} /> {label}
    </button>
  );

  return (
    <AnimatePresence mode="wait">

      {/* ─────────────── STEP: LOGIN ─────────────── */}
      {step === "login" && (
        <motion.div key="login" style={wrap} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.25 }}>
          <Bg />
          <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} style={cardStyle}>
            <Logo />

            <div style={{ marginBottom: "28px" }}>
              <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "8px" }}>{t("login_access", lang)}</div>
              <h1 style={{ ...sg, fontWeight: 700, fontSize: "26px", letterSpacing: "-0.5px", margin: 0 }}>{t("login_signin", lang)}</h1>
            </div>

            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <FieldLabel text={t("login_username", lang)} />
                <input ref={userRef} type="text" value={username} onChange={e => { setUsername(e.target.value); setLoginError(""); }} placeholder={t("login_username", lang)} autoComplete="username" style={inputStyle} onFocus={focusCyan} onBlur={blurNormal} />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <FieldLabel text={t("login_password", lang)} />
                  <button
                    type="button"
                    onClick={() => { setStep("forgot-email"); setFpError(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", ...mono, fontSize: "9px", color: "var(--cyan-text-dim)", letterSpacing: "0.5px", padding: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = "var(--cyan-text)"}
                    onMouseLeave={e => e.currentTarget.style.color = "var(--cyan-text-dim)"}>
                    {t("login_forgot", lang)}
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input type={showPw ? "text" : "password"} value={password} onChange={e => { setPassword(e.target.value); setLoginError(""); }} placeholder="••••••••" autoComplete="current-password" style={{ ...inputStyle, paddingRight: "44px" }} onFocus={focusCyan} onBlur={blurNormal} />
                  <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-mono)", display: "flex", alignItems: "center", padding: "4px" }}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {loginError && <ErrorBox msg={loginError} />}
              <SubmitBtn label={t("login_signin_btn", lang)} loading={loginLoading} />
            </form>

            <div style={{ marginTop: "20px", textAlign: "center" }}>
              <span style={{ fontFamily: "Manrope, sans-serif", fontSize: "12px", color: "var(--text-mono)" }}>
                {t("login_no_account", lang)}{" "}
              </span>
              <a
                href="/register"
                onClick={e => { e.preventDefault(); window.location.href = "/register"; }}
                style={{ fontFamily: "Manrope, sans-serif", fontSize: "12px", color: "var(--cyan-text)", textDecoration: "none" }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
              >
                {t("login_register", lang)}
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ─────────────── STEP: FORGOT — enter email ─────────────── */}
      {step === "forgot-email" && (
        <motion.div key="forgot-email" style={wrap} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.28, ease: "easeOut" }}>
          <Bg />
          <div style={cardStyle}>
            <Logo />

            <div style={{ marginBottom: "28px" }}>
              <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--violet-text-dim)", textTransform: "uppercase", marginBottom: "8px" }}>{t("fp_reset", lang)}</div>
              <h1 style={{ ...sg, fontWeight: 700, fontSize: "24px", letterSpacing: "-0.5px", margin: "0 0 8px" }}>{t("fp_forgot_q", lang)}</h1>
              <p style={{ color: "var(--text-mono)", fontSize: "13px", margin: 0, lineHeight: 1.6 }}>
                {t("fp_enter_email", lang)}
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <FieldLabel text={t("fp_email", lang)} />
                <div style={{ position: "relative" }}>
                  <input ref={emailRef} type="email" value={resetEmail} onChange={e => { setResetEmail(e.target.value); setFpError(""); }} placeholder="your@example.com" style={{ ...inputStyle, paddingLeft: "42px" }} onFocus={focusCyan} onBlur={blurNormal} onKeyDown={e => { if (e.key === "Enter") handleSendCode(); }} />
                  <Mail size={15} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--text-mono)", pointerEvents: "none" }} />
                </div>
              </div>

              {fpError && <ErrorBox msg={fpError} />}
              <SubmitBtn label={t("fp_send_code", lang)} onClick={handleSendCode} loading={fpLoading} disabled={!resetEmail.trim()} />
            </div>

            <BackLink />
          </div>
        </motion.div>
      )}

      {/* ─────────────── STEP: FORGOT — enter OTP ─────────────── */}
      {step === "forgot-verify" && (
        <motion.div key="forgot-verify" style={wrap} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.28, ease: "easeOut" }}>
          <Bg />
          <div style={cardStyle}>
            <Logo />

            <div style={{ marginBottom: "28px" }}>
              <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--violet-text-dim)", textTransform: "uppercase", marginBottom: "8px" }}>{t("fp_verification", lang)}</div>
              <h1 style={{ ...sg, fontWeight: 700, fontSize: "24px", letterSpacing: "-0.5px", margin: "0 0 8px" }}>{t("fp_enter_code", lang)}</h1>
              <p style={{ color: "var(--text-mono)", fontSize: "13px", margin: 0, lineHeight: 1.6 }}>
                {t("fp_code_sent", lang)} <span style={{ color: "var(--cyan-text-dim)" }}>{resetEmail}</span>
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* OTP boxes */}
              <OtpInput value={otp} onChange={setOtp} />

              {fpError && <ErrorBox msg={fpError} />}

              {/* Verify button (shows if auto-verify didn't fire yet) */}
              {fpLoading && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "var(--cyan-text-dim)", fontSize: "13px" }}>
                  <Loader2 size={14} className="animate-spin" /> {t("fp_verifying", lang)}
                </div>
              )}

              {/* Resend */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <span style={{ ...mono, fontSize: "11px", color: "var(--text-mono)" }}>{t("fp_didnt_receive", lang)}</span>
                <button
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || fpLoading}
                  style={{
                    background: "none", border: "none", cursor: resendCooldown > 0 ? "default" : "pointer",
                    display: "flex", alignItems: "center", gap: "4px",
                    ...mono, fontSize: "11px",
                    color: resendCooldown > 0 ? "var(--text-mono)" : "var(--cyan-text-dim)",
                    transition: "color 0.2s",
                  }}
                  onMouseEnter={e => { if (!resendCooldown) e.currentTarget.style.color = "var(--cyan-text)"; }}
                  onMouseLeave={e => { if (!resendCooldown) e.currentTarget.style.color = "var(--cyan-text-dim)"; }}>
                  <RefreshCw size={10} />
                  {resendCooldown > 0 ? `${t("fp_resend_in", lang)} ${resendCooldown}s` : t("fp_resend_code", lang)}
                </button>
              </div>
            </div>

            <BackLink />
          </div>
        </motion.div>
      )}

      {/* ─────────────── STEP: FORGOT — new password ─────────────── */}
      {step === "forgot-reset" && (
        <motion.div key="forgot-reset" style={wrap} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.28, ease: "easeOut" }}>
          <Bg />
          <div style={cardStyle}>
            <Logo />

            <div style={{ marginBottom: "28px" }}>
              <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", color: "var(--cyan-text-dim)", textTransform: "uppercase", marginBottom: "8px" }}>{t("fp_new_password", lang)}</div>
              <h1 style={{ ...sg, fontWeight: 700, fontSize: "24px", letterSpacing: "-0.5px", margin: "0 0 8px" }}>{t("fp_set_new", lang)}</h1>
              <p style={{ color: "var(--text-mono)", fontSize: "13px", margin: 0 }}>{t("fp_strong_hint", lang)}</p>
            </div>

            <form onSubmit={handleResetPassword} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <FieldLabel text={t("fp_new_password", lang)} />
                <div style={{ position: "relative" }}>
                  <input type={showNewPw ? "text" : "password"} value={newPw} onChange={e => { setNewPw(e.target.value); setFpError(""); }} placeholder={t("fp_at_least_6", lang)} autoComplete="new-password" style={{ ...inputStyle, paddingRight: "44px" }} onFocus={focusCyan} onBlur={blurNormal} />
                  <button type="button" onClick={() => setShowNewPw(v => !v)} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-mono)", display: "flex", alignItems: "center", padding: "4px" }}>
                    {showNewPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {/* Strength bar */}
                {newPw && (
                  <div style={{ marginTop: "6px", height: "3px", borderRadius: "999px", background: "var(--surface)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: "999px", transition: "width 0.3s, background 0.3s",
                      width: newPw.length >= 12 ? "100%" : newPw.length >= 8 ? "66%" : newPw.length >= 6 ? "40%" : "20%",
                      background: newPw.length >= 12 ? "#22c55e" : newPw.length >= 8 ? "#00E5FF" : newPw.length >= 6 ? "#f59e0b" : "#ef4444",
                    }} />
                  </div>
                )}
              </div>

              <div>
                <FieldLabel text={t("fp_confirm", lang)} />
                <input type="password" value={confirmPw} onChange={e => { setConfirmPw(e.target.value); setFpError(""); }} placeholder="••••••••" autoComplete="new-password" style={{ ...inputStyle, borderColor: confirmPw && confirmPw !== newPw ? "rgba(239,68,68,0.4)" : undefined }} onFocus={focusCyan} onBlur={blurNormal} />
                {confirmPw && confirmPw !== newPw && (
                  <div style={{ ...mono, fontSize: "10px", color: "rgba(239,68,68,0.6)", marginTop: "5px" }}>{t("fp_no_match", lang)}</div>
                )}
              </div>

              {fpError && <ErrorBox msg={fpError} />}
              <SubmitBtn label={t("fp_set_btn", lang)} loading={fpLoading} disabled={newPw.length < 6 || newPw !== confirmPw} />
            </form>
          </div>
        </motion.div>
      )}

      {/* ─────────────── STEP: FORGOT — done ─────────────── */}
      {step === "forgot-done" && (
        <motion.div key="forgot-done" style={wrap} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
          <Bg />
          <div style={{ ...cardStyle, textAlign: "center" }}>
            <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 20 }}
              style={{ width: "64px", height: "64px", borderRadius: "50%", background: "linear-gradient(135deg, rgba(34,197,94,0.15), var(--cyan-glow-bg))", border: "1px solid rgba(34,197,94,0.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", boxShadow: "0 0 24px rgba(34,197,94,0.15)" }}>
              <CheckCircle size={28} color="#22c55e" />
            </motion.div>

            <h1 style={{ ...sg, fontWeight: 700, fontSize: "24px", letterSpacing: "-0.5px", margin: "0 0 12px" }}>{t("fp_updated", lang)}</h1>
            <p style={{ color: "var(--text-dim)", fontSize: "13px", lineHeight: 1.7, margin: "0 0 28px" }}>
              {t("fp_updated_desc", lang)}
            </p>

            <motion.button
              whileHover={{ translateY: -1 }} whileTap={{ scale: 0.98 }}
              onClick={goBack}
              style={{
                width: "100%", padding: "14px", borderRadius: "13px", border: "none", cursor: "pointer",
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "15px",
                background: "linear-gradient(135deg, #00E5FF, #3df2ff)",
                color: "#021018", boxShadow: "0 0 28px var(--cyan-glow-soft)",
              }}>
              {t("login_signin_btn", lang)}
            </motion.button>
          </div>
        </motion.div>
      )}

    </AnimatePresence>
  );
}
