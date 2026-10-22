"""
extensions.py
Shared state used across multiple blueprints — GPU lock, job stores,
stop flag, and helpers. No app-specific imports to avoid circular deps.
"""

import json
import threading
import time
import uuid


# ---------------------------------------------------------------------------
# Single-concurrent generation guard (prevents GPU OOM from parallel runs)
# ---------------------------------------------------------------------------
generation_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Global stop flag for generation (thread-safe)
# ---------------------------------------------------------------------------
_stop_event = threading.Event()


def is_stop_requested() -> bool:
    """Thread-safe read of the stop flag."""
    return _stop_event.is_set()


def reset_stop_flag():
    """Reset the stop flag before a new generation run."""
    _stop_event.clear()


def request_stop():
    """Set the stop flag (called from the /api/stop route)."""
    _stop_event.set()


# ---------------------------------------------------------------------------
# Async job stores (edit & 3D) — background threads update these dicts,
# frontend polls status endpoints.
# ---------------------------------------------------------------------------
edit_jobs: dict = {}
edit_jobs_lock = threading.Lock()

three_d_jobs: dict = {}
three_d_jobs_lock = threading.Lock()

# Finished jobs older than this are pruned when a new job starts.
_JOB_TTL_SECS = 3600


def prune_jobs(store: dict, lock: threading.Lock) -> None:
    """Remove completed/errored jobs older than _JOB_TTL_SECS."""
    now = time.time()
    with lock:
        stale = [
            jid for jid, j in store.items()
            if j.get("status") in ("completed", "error")
            and now - j.get("created", now) > _JOB_TTL_SECS
        ]
        for jid in stale:
            store.pop(jid, None)


def new_job_id() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# SSE helper
# ---------------------------------------------------------------------------
def sse_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"
