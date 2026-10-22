"""
routes/auth.py
Authentication blueprint — login, register, logout, password reset (OTP flow).
"""

import json
import os
import re
import secrets
import time
import threading
import urllib.request
import urllib.error

from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash

from models import db, User
from rate_limit import (
    login_check_lockout, login_record_failure, login_clear,
    register_check_ratelimit, register_record,
    reset_check_ratelimit,
)
from decorators import login_required

auth_bp = Blueprint("auth", __name__)

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


# ───────────────────────────────────────────────────────────────────────────
# Login / Register / Logout
# ───────────────────────────────────────────────────────────────────────────

@auth_bp.route('/api/login', methods=['POST'])
def login():
    data     = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if len(username) > 80 or len(password) > 256:
        return jsonify({"error": "Invalid credentials"}), 401

    lockout_msg = login_check_lockout(username)
    if lockout_msg:
        return jsonify({"error": lockout_msg}), 429

    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()

    if not user or not check_password_hash(user.password_hash, password):
        login_record_failure(username)
        return jsonify({"error": "Invalid username or password"}), 401

    login_clear(username)
    session.permanent = True
    session["user_id"]  = user.id
    session["username"] = user.username
    session["role"]     = user.role
    return jsonify({
        "ok":       True,
        "role":     user.role,
        "username": user.username,
        "email":    user.email,
    }), 200


@auth_bp.route('/api/register', methods=['POST'])
def register():
    client_ip = request.remote_addr or "unknown"
    if not register_check_ratelimit(client_ip):
        return jsonify({"error": "Too many registration attempts. Please try again later."}), 429

    data     = request.json or {}
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if len(username) > 30:
        return jsonify({"error": "Username must be 30 characters or fewer"}), 400
    if len(email) > 120:
        return jsonify({"error": "Email address is too long"}), 400
    if len(password) > 128:
        return jsonify({"error": "Password is too long"}), 400

    if not username or not email or not password:
        return jsonify({"error": "All fields are required"}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    if not _EMAIL_RE.match(email):
        return jsonify({"error": "Invalid email address"}), 400

    if User.query.filter(db.func.lower(User.username) == username.lower()).first():
        return jsonify({"error": "Username already taken"}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email already registered"}), 409

    user = User(
        username=username,
        email=email,
        password_hash=generate_password_hash(password),
        role='user',
    )
    db.session.add(user)
    db.session.commit()
    register_record(client_ip)

    session.permanent = True
    session["user_id"]  = user.id
    session["username"] = user.username
    session["role"]     = user.role
    return jsonify({
        "ok":       True,
        "role":     user.role,
        "username": user.username,
        "email":    user.email,
    }), 201


@auth_bp.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"ok": True}), 200


# ───────────────────────────────────────────────────────────────────────────
# Password Reset — OTP flow
# ───────────────────────────────────────────────────────────────────────────

_otp_store: dict = {}
_otp_lock = threading.Lock()
_OTP_TTL = 600       # 10 minutes
_OTP_MAX_ATTEMPTS = 5


def _otp_cleanup():
    """Remove expired OTP entries to prevent memory growth."""
    now = time.time()
    with _otp_lock:
        expired = [t for t, e in _otp_store.items() if now > e.get("expiry", 0)]
        for t in expired:
            _otp_store.pop(t, None)


def _send_reset_email(to_email: str, code: str) -> None:
    """Send the 6-digit reset code via Resend API."""
    api_key    = os.environ.get("RESEND_API_KEY", "")
    from_email = os.environ.get("RESEND_FROM", "onboarding@resend.dev")

    if not api_key:
        raise ValueError("RESEND_API_KEY not set in .env")

    html_body = f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#050810;font-family:'Courier New',monospace;">
<div style="max-width:460px;margin:40px auto;padding:40px 36px;
            background:rgba(255,255,255,0.025);border:1px solid rgba(0,229,255,0.18);
            border-radius:20px;box-shadow:0 0 60px rgba(0,229,255,0.06);">
  <div style="margin-bottom:28px;">
    <span style="font-size:20px;font-weight:700;color:#e7ecf3;font-family:'Arial',sans-serif;">
      Holo<span style="color:#00E5FF;">3D</span>
    </span><br>
    <span style="font-size:10px;letter-spacing:3px;color:rgba(0,229,255,0.4);text-transform:uppercase;">
      Wood Factory
    </span>
  </div>
  <p style="color:rgba(231,236,243,0.55);font-size:13px;margin:0 0 24px;">
    Your password reset code:
  </p>
  <div style="text-align:center;padding:22px;margin-bottom:24px;
              background:rgba(0,229,255,0.06);border:1px solid rgba(0,229,255,0.2);
              border-radius:14px;">
    <span style="font-size:42px;font-weight:900;letter-spacing:14px;
                 color:#00E5FF;text-shadow:0 0 24px rgba(0,229,255,0.5);">
      {code}
    </span>
  </div>
  <p style="color:rgba(231,236,243,0.3);font-size:11px;margin:0;line-height:1.6;">
    Expires in <strong style="color:rgba(231,236,243,0.5);">10 minutes</strong>.
    If you did not request this, ignore this email.
  </p>
</div>
</body>
</html>
"""

    payload = json.dumps({
        "from": from_email,
        "to": [to_email],
        "subject": "Holo3D — Password Reset Code",
        "html": html_body,
    }).encode()

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"✅ Reset email sent to {to_email} (Resend)")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"Resend API error {e.code}: {body}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Could not reach Resend API: {e.reason}")


@auth_bp.route("/api/reset-request", methods=["POST"])
def reset_request():
    """Step 1 — find user by email, send OTP."""
    data  = request.json or {}
    email = data.get("email", "").strip().lower()

    client_ip = request.remote_addr or "unknown"
    if not reset_check_ratelimit(f"ip:{client_ip}") or (
        email and not reset_check_ratelimit(f"email:{email}")
    ):
        return jsonify({"error": "Too many reset requests. Please try again later."}), 429

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"ok": True}), 200

    if not os.environ.get("RESEND_API_KEY"):
        return jsonify({"error": "Email sending is not configured (RESEND_API_KEY missing in .env)"}), 503

    _otp_cleanup()
    with _otp_lock:
        stale = [t for t, e in _otp_store.items() if e.get("user_id") == user.id]
        for t in stale:
            _otp_store.pop(t, None)

    code  = f"{secrets.randbelow(1_000_000):06d}"
    token = secrets.token_urlsafe(32)
    with _otp_lock:
        _otp_store[token] = {
            "code":     code,
            "expiry":   time.time() + _OTP_TTL,
            "attempts": 0,
            "verified": False,
            "used":     False,
            "user_id":  user.id,
        }

    try:
        _send_reset_email(email, code)
    except Exception as e:
        with _otp_lock:
            _otp_store.pop(token, None)
        return jsonify({"error": f"Failed to send email: {e}"}), 500

    return jsonify({"ok": True, "token": token}), 200


@auth_bp.route("/api/reset-verify", methods=["POST"])
def reset_verify():
    """Step 2 — verify the 6-digit OTP."""
    data  = request.json or {}
    token = data.get("token", "")
    code  = data.get("code", "").strip()

    with _otp_lock:
        entry = _otp_store.get(token)
        if not entry:
            return jsonify({"error": "Invalid or expired session. Please request a new code."}), 400

        if entry["used"]:
            return jsonify({"error": "This reset link has already been used."}), 400

        if time.time() > entry["expiry"]:
            _otp_store.pop(token, None)
            return jsonify({"error": "Code expired. Please request a new one."}), 400

        entry["attempts"] += 1
        remaining = _OTP_MAX_ATTEMPTS - entry["attempts"]

        if code != entry["code"]:
            if remaining <= 0:
                _otp_store.pop(token, None)
                return jsonify({"error": "Too many failed attempts. Please request a new code."}), 429
            word = "attempt" if remaining == 1 else "attempts"
            return jsonify({"error": f"Wrong code. {remaining} {word} left."}), 400

        entry["verified"] = True
    return jsonify({"ok": True}), 200


@auth_bp.route("/api/reset-password", methods=["POST"])
def reset_password():
    """Step 3 — set new password (token must be verified first)."""
    data         = request.json or {}
    token        = data.get("token", "")
    new_password = data.get("new_password", "")

    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    if len(new_password) > 128:
        return jsonify({"error": "Password is too long."}), 400

    with _otp_lock:
        entry = _otp_store.get(token)
        if not entry or not entry.get("verified"):
            return jsonify({"error": "Invalid or unverified session."}), 400
        if entry["used"]:
            return jsonify({"error": "This session has already been used."}), 400
        if time.time() > entry["expiry"]:
            _otp_store.pop(token, None)
            return jsonify({"error": "Session expired. Please start over."}), 400
        entry["used"] = True
        user_id = entry.get("user_id")

    user = db.session.get(User, user_id) if user_id else None
    if not user:
        return jsonify({"error": "User not found."}), 400

    try:
        user.password_hash = generate_password_hash(new_password)
        db.session.commit()
    except Exception as e:
        return jsonify({"error": f"Failed to save new password: {e}"}), 500

    with _otp_lock:
        _otp_store.pop(token, None)
    return jsonify({"ok": True}), 200
