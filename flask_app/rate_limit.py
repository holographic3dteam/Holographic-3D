"""
rate_limit.py
In-memory, thread-safe rate-limiting helpers for login, registration,
and password-reset flows.
"""

import threading
import time

_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Login brute-force protection
# ---------------------------------------------------------------------------
_login_attempts: dict = {}
_LOGIN_MAX_FAILURES = 5
_LOGIN_LOCKOUT_SECS = 15 * 60  # 15 minutes


def login_check_lockout(username: str) -> str | None:
    """Return an error string if username is locked out, else None."""
    with _lock:
        entry = _login_attempts.get(username.lower())
        if not entry:
            return None
        if entry["failures"] >= _LOGIN_MAX_FAILURES:
            remaining = int(entry["locked_until"] - time.time())
            if remaining > 0:
                mins = remaining // 60 + 1
                plural = "s" if mins != 1 else ""
                return (
                    f"Account locked after too many failed attempts. "
                    f"Try again in {mins} minute{plural}."
                )
            else:
                _login_attempts.pop(username.lower(), None)
        return None


def login_record_failure(username: str) -> None:
    with _lock:
        key = username.lower()
        entry = _login_attempts.setdefault(
            key, {"failures": 0, "locked_until": 0.0}
        )
        entry["failures"] += 1
        if entry["failures"] >= _LOGIN_MAX_FAILURES:
            entry["locked_until"] = time.time() + _LOGIN_LOCKOUT_SECS


def login_clear(username: str) -> None:
    with _lock:
        _login_attempts.pop(username.lower(), None)


# ---------------------------------------------------------------------------
# Registration spam protection
# ---------------------------------------------------------------------------
_register_log: dict = {}
_REGISTER_MAX_PER_HOUR = 5


def register_check_ratelimit(ip: str) -> bool:
    """Return True if this IP is allowed to register."""
    with _lock:
        now = time.time()
        timestamps = _register_log.get(ip, [])
        timestamps = [t for t in timestamps if now - t < 3600]
        _register_log[ip] = timestamps
        return len(timestamps) < _REGISTER_MAX_PER_HOUR


def register_record(ip: str) -> None:
    with _lock:
        _register_log.setdefault(ip, []).append(time.time())


# ---------------------------------------------------------------------------
# Password-reset spam protection
# ---------------------------------------------------------------------------
_reset_log: dict = {}
_RESET_MAX_PER_WINDOW = 4
_RESET_WINDOW_SECS = 15 * 60  # 15 minutes


def reset_check_ratelimit(key: str) -> bool:
    """Return True if this key (email/ip) may request another reset code."""
    with _lock:
        now = time.time()
        stamps = [
            t for t in _reset_log.get(key, [])
            if now - t < _RESET_WINDOW_SECS
        ]
        _reset_log[key] = stamps
        if len(stamps) >= _RESET_MAX_PER_WINDOW:
            return False
        stamps.append(now)
        return True
