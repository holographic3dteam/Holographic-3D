
import json
import queue
import threading
import os
import secrets
import time
import urllib.request
import urllib.error

# Stop `transformers` from importing TensorFlow. Nothing in this app uses TF, but
# because TF is installed, transformers auto-imports it — and TF reserves a large
# chunk of GPU VRAM for nothing, starving SDXL and forcing the driver into slow
# system-RAM fallback. Must be set BEFORE search_logic/ai_logic (which pull
# transformers) are imported below.
os.environ["USE_TF"] = "0"
os.environ["TRANSFORMERS_NO_TF"] = "1"

from functools import wraps
from flask import Flask, request, jsonify, Response, stream_with_context, session
from flask_cors import CORS
from config import Config
from models import db, FactoryDesign, GeneratedDesign, ProductRequest, User
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from search_logic import search_factory_products, embedding_model
from ai_logic import generate_ai_design, StopGenerationError
from hunyuan_logic import generate_3d_mesh

import mimetypes
mimetypes.add_type("model/gltf-binary", ".glb")
# (USE_TF is set at the very top of this file, before transformers is imported)
mimetypes.add_type("model/stl", ".stl")
mimetypes.add_type("model/obj", ".obj")

app = Flask(__name__)
CORS(app, supports_credentials=True, origins=[
    "http://localhost:5173",
    "https://localhost:5173",
    r"https://.*\.ngrok-free\.app",
    r"https://.*\.ngrok\.io",
])
app.config.from_object(Config)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10 MB upload limit

Config.init_folders()
db.init_app(app)

# ---------------------------------------------------------------------------
# In-memory rate-limit stores (thread-safe)
# ---------------------------------------------------------------------------
import threading as _rl_threading

_rl_lock = _rl_threading.Lock()

# Login brute-force: { username_lower: {"failures": int, "locked_until": float} }
_login_attempts: dict = {}
_LOGIN_MAX_FAILURES = 5
_LOGIN_LOCKOUT_SECS = 15 * 60  # 15 minutes

# Registration spam: { ip: [timestamp, ...] }
_register_log: dict = {}
_REGISTER_MAX_PER_HOUR = 5


def _login_check_lockout(username: str) -> str | None:
    """Return an error string if username is locked out, else None."""
    with _rl_lock:
        entry = _login_attempts.get(username.lower())
        if not entry:
            return None
        if entry["failures"] >= _LOGIN_MAX_FAILURES:
            remaining = int(entry["locked_until"] - time.time())
            if remaining > 0:
                mins = remaining // 60 + 1
                plural = "s" if mins != 1 else ""
                return f"Account locked after too many failed attempts. Try again in {mins} minute{plural}."
            else:
                _login_attempts.pop(username.lower(), None)
        return None


def _login_record_failure(username: str) -> None:
    with _rl_lock:
        key = username.lower()
        entry = _login_attempts.setdefault(key, {"failures": 0, "locked_until": 0.0})
        entry["failures"] += 1
        if entry["failures"] >= _LOGIN_MAX_FAILURES:
            entry["locked_until"] = time.time() + _LOGIN_LOCKOUT_SECS


def _login_clear(username: str) -> None:
    with _rl_lock:
        _login_attempts.pop(username.lower(), None)


def _register_check_ratelimit(ip: str) -> bool:
    """Return True if this IP is allowed to register (under the hourly limit)."""
    with _rl_lock:
        now = time.time()
        timestamps = _register_log.get(ip, [])
        timestamps = [t for t in timestamps if now - t < 3600]
        _register_log[ip] = timestamps
        return len(timestamps) < _REGISTER_MAX_PER_HOUR


def _register_record(ip: str) -> None:
    with _rl_lock:
        _register_log.setdefault(ip, []).append(time.time())


# Password-reset spam: { key: [timestamp, ...] }  (key = email or ip)
_reset_log: dict = {}
_RESET_MAX_PER_WINDOW = 4
_RESET_WINDOW_SECS = 15 * 60  # 15 minutes


def _reset_check_ratelimit(key: str) -> bool:
    """Return True if this key (email/ip) may request another reset code."""
    with _rl_lock:
        now = time.time()
        stamps = [t for t in _reset_log.get(key, []) if now - t < _RESET_WINDOW_SECS]
        _reset_log[key] = stamps
        if len(stamps) >= _RESET_MAX_PER_WINDOW:
            return False
        stamps.append(now)
        return True

with app.app_context():
    db.create_all()

    # ── Lightweight auto-migration ────────────────────────────────────────
    # Older DBs were created before GeneratedDesign gained `user_id`.
    # db.create_all() never adds columns to existing tables, so add it here if
    # missing — otherwise every query on generated_designs fails with
    # "Unknown column 'generated_designs.user_id'". Idempotent + safe.
    try:
        from sqlalchemy import inspect as _sa_inspect, text as _sa_text
        _insp = _sa_inspect(db.engine)
        if "generated_designs" in _insp.get_table_names():
            _cols = {c["name"] for c in _insp.get_columns("generated_designs")}
            if "user_id" not in _cols:
                print("[migrate] Adding missing column generated_designs.user_id ...")
                db.session.execute(_sa_text(
                    "ALTER TABLE generated_designs ADD COLUMN user_id INT NULL"
                ))
                db.session.commit()
                print("[migrate] generated_designs.user_id added.")
    except Exception as _me:
        db.session.rollback()
        print(f"[migrate] user_id migration skipped: {_me}")
    # ──────────────────────────────────────────────────────────────────────

    # Seed admin user from .env on first run (if no admin exists yet)
    if not User.query.filter_by(role='admin').first():
        seed_user  = os.environ.get('ADMIN_USERNAME', 'admin')
        seed_email = os.environ.get('ADMIN_EMAIL', '') or f"{seed_user}@holo3d.local"
        seed_pass  = os.environ.get('ADMIN_PASSWORD', '')
        if not seed_pass:
            import sys
            print("\n" + "="*60)
            print("ERROR: ADMIN_PASSWORD is not set in your .env file.")
            print("Add this line to your .env file and restart:")
            print("  ADMIN_PASSWORD=your_strong_password_here")
            print("="*60 + "\n")
            sys.exit(1)
        db.session.add(User(
            username=seed_user,
            email=seed_email,
            password_hash=generate_password_hash(seed_pass),
            role='admin',
        ))
        db.session.commit()

# ---------------------------------------------------------------------------
# Security helpers
# ---------------------------------------------------------------------------
ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_UPLOAD_MIMETYPES  = {"image/jpeg", "image/png", "image/webp", "image/jpg"}

# ---------------------------------------------------------------------------
# Session-based login_required decorator
# ---------------------------------------------------------------------------
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Authentication required."}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Authentication required."}), 401
        if session.get("role") != "admin":
            return jsonify({"error": "Admin access required."}), 403
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Single-concurrent generation guard (prevents GPU OOM from parallel runs)
# ---------------------------------------------------------------------------
_is_generating = threading.Lock()   # acquired while a generation is running

# Async edit jobs: job_id -> {status, step, total, preview_url, error, message}
# Edit inference takes minutes; running it synchronously inside the HTTP request
# makes the browser/ngrok connection time out ("Failed to fetch"). We run it in a
# background thread and let the frontend poll /api/edit-status/<job_id> instead.
import uuid as _uuid
_edit_jobs = {}
_edit_jobs_lock = threading.Lock()

# Job dicts (_edit_jobs / _3d_jobs) would otherwise grow forever — one entry per
# run, never removed. Prune finished jobs older than an hour whenever a new job
# starts, so memory stays bounded on a long-running server.
_JOB_TTL_SECS = 3600

def _prune_jobs(store: dict, lock: threading.Lock) -> None:
    now = time.time()
    with lock:
        stale = [
            jid for jid, j in store.items()
            if j.get("status") in ("completed", "error")
            and now - j.get("created", now) > _JOB_TTL_SECS
        ]
        for jid in stale:
            store.pop(jid, None)


# ---------------------------------------------------------------------------
# Login — UI auth (separate from API token auth)
# ---------------------------------------------------------------------------
@app.route('/api/login', methods=['POST'])
def login():
    data     = request.json or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    # Input length guard
    if len(username) > 80 or len(password) > 256:
        return jsonify({"error": "Invalid credentials"}), 401

    # Brute-force lockout check
    lockout_msg = _login_check_lockout(username)
    if lockout_msg:
        return jsonify({"error": lockout_msg}), 429

    # Case-insensitive username lookup
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()

    if not user or not check_password_hash(user.password_hash, password):
        _login_record_failure(username)
        return jsonify({"error": "Invalid username or password"}), 401

    _login_clear(username)
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


_EMAIL_RE = __import__('re').compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

@app.route('/api/register', methods=['POST'])
def register():
    # IP-based registration rate limit
    client_ip = request.remote_addr or "unknown"
    if not _register_check_ratelimit(client_ip):
        return jsonify({"error": "Too many registration attempts. Please try again later."}), 429

    data     = request.json or {}
    username = data.get('username', '').strip()
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    # Length limits
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

    # Basic email format check
    if not _EMAIL_RE.match(email):
        return jsonify({"error": "Invalid email address"}), 400

    # Username uniqueness — case-insensitive
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
    _register_record(client_ip)

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


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"ok": True}), 200


# ---------------------------------------------------------------------------
# Global stop flag for generation (thread-safe)
# ---------------------------------------------------------------------------
_stop_event = threading.Event()

@app.route('/api/stop', methods=['POST'])
@login_required
def stop_generation():
    _stop_event.set()
    return jsonify({"message": "Stop requested"}), 200


def is_stop_requested() -> bool:
    """Thread-safe read of the stop flag."""
    return _stop_event.is_set()


def reset_stop_flag():
    """Reset the stop flag before a new generation run."""
    _stop_event.clear()


# ---------------------------------------------------------------------------
# Health check — frontend polls this to know when models are ready
# ---------------------------------------------------------------------------
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"ready": True, "status": "All models loaded"}), 200


# ---------------------------------------------------------------------------
# SSE helper
# ---------------------------------------------------------------------------
def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/api/factory/upload', methods=['POST'])
@admin_required
def upload_design():
    try:
        description = request.form.get('description')
        file = request.files.get('file')

        if not file or not description:
            return jsonify({"error": "Description and file are required"}), 400

        # Server-side file type validation (not just relying on frontend)
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_UPLOAD_EXTENSIONS:
            return jsonify({"error": f"Only image files are allowed (.jpg, .png, .webp). Got: {ext or 'none'}"}), 400
        if file.mimetype not in ALLOWED_UPLOAD_MIMETYPES:
            return jsonify({"error": f"Invalid MIME type: {file.mimetype}"}), 400

        # Content validation: confirm the bytes are actually a valid image, not
        # just a file with an image extension/MIME (both of which can be forged).
        try:
            from PIL import Image as _PILImage
            file.stream.seek(0)
            _PILImage.open(file.stream).verify()
            file.stream.seek(0)
        except Exception:
            return jsonify({"error": "File is not a valid image."}), 400

        # Unique, non-empty filename — secure_filename can return "" for
        # non-ASCII names, and identical names would otherwise overwrite an
        # existing catalog image.
        safe = secure_filename(file.filename or "") or "upload"
        name_part, ext_part = os.path.splitext(safe)
        filename = f"{name_part or 'upload'}_{secrets.token_hex(4)}{ext_part}"
        file_absolute_path = os.path.join(Config.FACTORY_FOLDER, filename)
        file.save(file_absolute_path)
        file_relative_path = f"static/factory_assets/{filename}"

        vector_data = embedding_model.encode(description).tolist()

        new_design = FactoryDesign(description=description, file_path=file_relative_path)
        new_design.set_vector(vector_data)
        db.session.add(new_design)
        db.session.commit()

        return jsonify({
            "message": "Success! Design stored and vectorized.",
            "design_id": new_design.id,
            "path": file_relative_path
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/factory/designs', methods=['GET'])
@admin_required
def list_factory_designs():
    """Admin — list all uploaded catalog references."""
    try:
        designs = FactoryDesign.query.order_by(FactoryDesign.id.desc()).all()
        return jsonify([
            {
                "id":          d.id,
                "description": d.description,
                "filePath":    d.file_path,
            }
            for d in designs
        ]), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/factory/designs/<int:design_id>', methods=['PUT'])
@admin_required
def update_factory_design(design_id):
    """Admin — update description of a catalog reference."""
    try:
        design = db.session.get(FactoryDesign, design_id)
        if not design:
            return jsonify({"error": "Not found"}), 404
        data = request.json or {}
        new_desc = (data.get('description') or '').strip()
        if not new_desc:
            return jsonify({"error": "Description required"}), 400

        design.description = new_desc
        # Re-vectorize with new description
        vector_data = embedding_model.encode(new_desc).tolist()
        design.set_vector(vector_data)
        db.session.commit()
        return jsonify({"message": "Updated", "id": design.id}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/factory/designs/<int:design_id>', methods=['DELETE'])
@admin_required
def delete_factory_design(design_id):
    """Admin — delete a catalog reference and its file."""
    try:
        design = db.session.get(FactoryDesign, design_id)
        if not design:
            return jsonify({"error": "Not found"}), 404

        # Delete the physical file
        abs_path = os.path.join(os.path.dirname(__file__), design.file_path)
        if os.path.exists(abs_path):
            os.remove(abs_path)

        db.session.delete(design)
        db.session.commit()
        return jsonify({"message": "Deleted"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/generate', methods=['GET'])
@login_required
def generate_design_sse():
    user_prompt = request.args.get('prompt', '').strip()
    seed  = request.args.get('seed', None)
    try:
        sdxl_steps = max(10, min(50, int(request.args.get('steps', 30))))
    except (ValueError, TypeError):
        sdxl_steps = 30
    if not user_prompt:
        return jsonify({"error": "prompt query param is required"}), 400
    if len(user_prompt) > 1000:
        return jsonify({"error": "Prompt is too long (max 1000 characters)"}), 400

    # Prevent parallel GPU runs — return 429 if already busy
    if not _is_generating.acquire(blocking=False):
        return jsonify({"error": "A generation is already in progress. Stop it or wait for it to finish."}), 429

    event_queue: queue.Queue = queue.Queue()

    def progress_fn(event: dict):
        event_queue.put(event)

    def run_generation():
        with app.app_context():
            reset_stop_flag()
            try:
                # One-heavy-model-at-a-time: free the Kontext editor's ~14 GB RAM
                # and make sure SDXL is loaded on the GPU before generating.
                try:
                    import edit_logic, ai_logic
                    edit_logic.unload_pipe()
                    ai_logic.ensure_loaded()
                except Exception as _e:
                    print(f"[generate] model handoff warning: {_e}")

                best_match = search_factory_products(user_prompt)
                generate_ai_design(
                    user_prompt,
                    progress_fn=progress_fn,
                    seed=seed,
                    stop_fn=is_stop_requested,
                    steps=sdxl_steps,
                )
                event_queue.put({
                    "type": "factory_match",
                    "factory_match": {
                        "id":          best_match['id'] if best_match else None,
                        "description": best_match['description'] if best_match else "No close match found",
                        "file_path":   best_match['file_path'] if best_match else None,
                        "match_score": best_match['score'] if best_match else 0,
                    }
                })
            except StopGenerationError:
                event_queue.put({"type": "stopped", "message": "Generation stopped by user"})
            except Exception as e:
                event_queue.put({"type": "error", "message": str(e)})
            finally:
                event_queue.put(None)
                _is_generating.release()

    thread = threading.Thread(target=run_generation, daemon=True)
    thread.start()

    def event_stream():
        while True:
            event = event_queue.get()
            if event is None:
                break
            yield _sse_event(event)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


# Async 3D jobs. 3D (shape + texture painting) takes several minutes; running it
# synchronously inside the HTTP request makes the browser/ngrok connection time
# out ("Failed to fetch"). We run it in a background thread and poll, exactly
# like the edit flow.
_3d_jobs = {}
_3d_jobs_lock = threading.Lock()


def _run_3d_job(job_id, preview_url, base_name, steps):
    """Background worker: runs the Hunyuan 3D pipeline, updates _3d_jobs[job_id]."""
    try:
        # One-heavy-model-at-a-time: free the Kontext editor's ~14 GB RAM so the
        # Hunyuan subprocess has room. (Hunyuan itself offloads SDXL from the GPU.)
        try:
            import edit_logic
            edit_logic.unload_pipe()
        except Exception as _e:
            print(f"[3d] Kontext unload warning: {_e}")

        mesh_paths = generate_3d_mesh(preview_url, base_name, steps=steps)
        with _3d_jobs_lock:
            _3d_jobs[job_id].update(status="completed", mesh=mesh_paths)
    except Exception as e:
        import traceback
        traceback.print_exc()
        with _3d_jobs_lock:
            _3d_jobs[job_id].update(status="error", error=str(e))
    finally:
        _is_generating.release()


@app.route('/api/generate_3d', methods=['POST'])
@login_required
def generate_3d():
    data = request.json or {}
    preview_url = data.get('preview_url', '')
    prompt = data.get('prompt', 'mesh')
    try:
        steps = int(data.get('steps', 5))
    except (ValueError, TypeError):
        steps = 5

    if not preview_url:
        return jsonify({"error": "preview_url is required"}), 400

    # Path traversal guard — only allow server-generated asset paths
    safe_prefixes = ("static/generated_assets/", "static/factory_assets/")
    norm = os.path.normpath(preview_url).replace("\\", "/")
    if not any(norm.startswith(p) for p in safe_prefixes):
        return jsonify({"error": "Invalid image path"}), 400

    # Prevent concurrent GPU usage (same lock as 2D generation); released in worker.
    if not _is_generating.acquire(blocking=False):
        return jsonify({"error": "GPU is busy with another generation. Please wait."}), 429

    base_name = "".join(
        c if c.isalnum() or c in (" ", "_") else "" for c in prompt
    )[:50]

    _prune_jobs(_3d_jobs, _3d_jobs_lock)
    job_id = _uuid.uuid4().hex
    with _3d_jobs_lock:
        _3d_jobs[job_id] = {"status": "processing", "mesh": None, "error": None, "created": time.time()}

    t = threading.Thread(
        target=_run_3d_job, args=(job_id, preview_url, base_name, steps), daemon=True
    )
    t.start()
    return jsonify({"job_id": job_id, "status": "processing"}), 202


@app.route('/api/generate_3d_status/<job_id>', methods=['GET'])
@login_required
def generate_3d_status(job_id):
    """Poll the status of an async 3D job."""
    with _3d_jobs_lock:
        job = _3d_jobs.get(job_id)
        if job is None:
            return jsonify({"error": "Unknown job_id"}), 404
        return jsonify({"job_id": job_id, **job})


def _run_edit_job(job_id, image_path, edit_prompt, output_name, steps):
    """Background worker: runs FLUX Kontext edit, updates _edit_jobs[job_id]."""
    from edit_logic import edit_design

    def _progress(step, total):
        with _edit_jobs_lock:
            j = _edit_jobs.get(job_id)
            if j is not None:
                j["step"], j["total"] = step, total

    # ── Free the GPU + RAM for Kontext ────────────────────────────────────
    # One-heavy-model-at-a-time: fully unload SDXL + CLIP (both VRAM and RAM).
    # SDXL (~6.5 GB) + the Kontext editor (~14 GB) can't both live in 15 GB RAM,
    # and if SDXL stays on the 8 GB card the Kontext transformer stacks on top and
    # spills to system RAM (~200 s/step). unload() frees both; the next generation
    # reloads SDXL via ensure_loaded().
    try:
        import ai_logic as _ai, torch as _torch
        _ai.unload()
        if _torch.cuda.is_available():
            free_b, total_b = _torch.cuda.mem_get_info()
            print(f"[edit] SDXL unloaded → {free_b/1024**3:.2f}GB free / {total_b/1024**3:.2f}GB")
    except Exception as _e:
        print(f"[edit] SDXL unload skipped: {_e}")

    try:
        result = edit_design(
            image_path=image_path,
            edit_prompt=edit_prompt,
            output_name=output_name,
            steps=steps,
            progress_cb=_progress,
        )
        with _edit_jobs_lock:
            _edit_jobs[job_id].update(
                status="completed",
                preview_url=result["preview_url"],
                message=result.get("message", ""),
            )
    except FileNotFoundError as e:
        with _edit_jobs_lock:
            _edit_jobs[job_id].update(status="error", error=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        with _edit_jobs_lock:
            _edit_jobs[job_id].update(status="error", error=str(e))
    finally:
        _is_generating.release()


@app.route('/api/edit-design', methods=['POST'])
@login_required
def edit_design_route():
    """Start a FLUX Kontext edit as a background job; returns a job_id to poll."""
    data = request.json or {}
    image_path = data.get('image_path', '').strip()
    edit_prompt = data.get('prompt', '').strip()

    if not image_path or not edit_prompt:
        return jsonify({"error": "image_path and prompt are required"}), 400

    # Path traversal guard — only allow server-generated asset paths
    norm = os.path.normpath(image_path).replace("\\", "/")
    if not norm.startswith("static/generated_assets/"):
        return jsonify({"error": "Invalid image path"}), 400

    if len(edit_prompt) > 1000:
        return jsonify({"error": "Prompt too long (max 1000 characters)"}), 400

    # Acquire the GPU lock up front; released in the worker's finally.
    if not _is_generating.acquire(blocking=False):
        return jsonify({"error": "GPU is busy with another generation. Please wait."}), 429

    steps = int(data['steps']) if 'steps' in data else None
    _prune_jobs(_edit_jobs, _edit_jobs_lock)
    job_id = _uuid.uuid4().hex
    with _edit_jobs_lock:
        _edit_jobs[job_id] = {
            "status": "processing", "step": 0, "total": steps or 28,
            "preview_url": None, "error": None, "message": "", "created": time.time(),
        }

    t = threading.Thread(
        target=_run_edit_job,
        args=(job_id, image_path, edit_prompt, data.get('output_name') or None, steps),
        daemon=True,
    )
    t.start()
    return jsonify({"job_id": job_id, "status": "processing"}), 202


@app.route('/api/edit-status/<job_id>', methods=['GET'])
@login_required
def edit_status_route(job_id):
    """Poll the status of an async edit job."""
    with _edit_jobs_lock:
        job = _edit_jobs.get(job_id)
        if job is None:
            return jsonify({"error": "Unknown job_id"}), 404
        return jsonify({"job_id": job_id, **job})


@app.route('/api/save', methods=['GET'])
@login_required
def list_saved_designs():
    try:
        uid = session.get("user_id")
        designs = GeneratedDesign.query.filter_by(user_id=uid).order_by(GeneratedDesign.created_at.desc()).all()
        return jsonify([
            {
                "id":          d.id,
                "prompt":      d.prompt,
                "preview_url": d.file_path,
                "rating":      d.rating,
                "savedAt":     d.created_at.isoformat() if d.created_at else None,
            }
            for d in designs
        ]), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/save', methods=['POST'])
@login_required
def save_design():
    try:
        data = request.json or {}
        prompt = data.get('prompt')
        preview_url = data.get('preview_url')

        if not prompt or not preview_url:
            return jsonify({"error": "Prompt and preview_url are required"}), 400

        # Guard: don't create duplicate entries
        existing = GeneratedDesign.query.filter_by(prompt=prompt, file_path=preview_url).first()
        if existing:
            return jsonify({
                "message": "Already saved.",
                "design_id": existing.id,
                "already_saved": True
            }), 200

        new_generated = GeneratedDesign(prompt=prompt, file_path=preview_url, user_id=session.get("user_id"))
        db.session.add(new_generated)
        db.session.commit()

        return jsonify({
            "message": "Design saved successfully!",
            "design_id": new_generated.id
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/save/<int:design_id>', methods=['DELETE'])
@login_required
def delete_design(design_id):
    try:
        design = db.session.get(GeneratedDesign, design_id)
        # Ownership check: a user may only delete their OWN designs. Return 404
        # (not 403) so we don't reveal that someone else's design id exists.
        if not design or design.user_id != session.get("user_id"):
            return jsonify({"error": "Design not found"}), 404
        db.session.delete(design)
        db.session.commit()
        return jsonify({"message": "Deleted successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/save/<int:design_id>/rate', methods=['POST'])
@login_required
def rate_design(design_id):
    try:
        data = request.json or {}
        rating = data.get('rating')
        try:
            rating_int = int(rating) if rating is not None else None
        except (ValueError, TypeError):
            return jsonify({"error": "Rating must be a number 1-5"}), 400
        if rating_int is None or not (1 <= rating_int <= 5):
            return jsonify({"error": "Rating must be 1-5"}), 400

        design = db.session.get(GeneratedDesign, design_id)
        # Ownership check: a user may only rate their OWN designs.
        if not design or design.user_id != session.get("user_id"):
            return jsonify({"error": "Design not found"}), 404

        design.rating = rating_int
        db.session.commit()
        return jsonify({"message": "Rating saved", "rating": design.rating}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Product Requests
# ---------------------------------------------------------------------------
@app.route('/api/product-request', methods=['POST'])
@login_required
def product_request():
    try:
        data = request.json or {}
        category    = (data.get('category') or '').strip()
        description = (data.get('description') or '').strip()
        if not category or not description:
            return jsonify({"error": "Category and description required"}), 400
        if len(category) > 100 or len(description) > 2000:
            return jsonify({"error": "Input too long"}), 400

        req = ProductRequest(category=category, description=description)
        db.session.add(req)
        db.session.commit()
        return jsonify({"message": "Request submitted!", "id": req.id}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/product-requests', methods=['GET'])
@admin_required
def list_product_requests():
    """Admin — list all submitted product requests."""
    try:
        reqs = ProductRequest.query.order_by(ProductRequest.created_at.desc()).all()
        return jsonify([
            {
                "id":          r.id,
                "category":    r.category,
                "description": r.description,
                "createdAt":   r.created_at.isoformat() if r.created_at else None,
            }
            for r in reqs
        ]), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@app.route('/api/product-requests/<int:req_id>', methods=['DELETE'])
@admin_required
def delete_product_request(req_id):
    """Admin — delete a product request."""
    try:
        req = db.session.get(ProductRequest, req_id)
        if not req:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(req)
        db.session.commit()
        return jsonify({"message": "Deleted"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Password Reset — OTP flow
# ---------------------------------------------------------------------------

# In-memory OTP store  { token: { code, expiry, attempts, verified, used, user_id } }
_otp_store: dict = {}
_otp_lock = _rl_threading.Lock()
_OTP_TTL   = 600   # 10 minutes
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
    api_key  = os.environ.get("RESEND_API_KEY", "")
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


@app.route("/api/reset-request", methods=["POST"])
def reset_request():
    """Step 1 — find user by email in DB, send OTP."""
    data  = request.json or {}
    email = data.get("email", "").strip().lower()

    # Rate-limit to stop someone spamming reset emails at a known address.
    client_ip = request.remote_addr or "unknown"
    if not _reset_check_ratelimit(f"ip:{client_ip}") or (email and not _reset_check_ratelimit(f"email:{email}")):
        return jsonify({"error": "Too many reset requests. Please try again later."}), 429

    # Always return the same shape — don't reveal whether email exists
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"ok": True}), 200

    if not os.environ.get("RESEND_API_KEY"):
        return jsonify({"error": "Email sending is not configured (RESEND_API_KEY missing in .env)"}), 503

    # Cleanup expired OTPs + invalidate previous OTPs for THIS user
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


@app.route("/api/reset-verify", methods=["POST"])
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
            attempts_left = "attempt" if remaining == 1 else "attempts"
            return jsonify({"error": f"Wrong code. {remaining} {attempts_left} left."}), 400

        entry["verified"] = True
    return jsonify({"ok": True}), 200


@app.route("/api/reset-password", methods=["POST"])
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

        # Claim the token under the lock so a concurrent request can't reuse it.
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


# ---------------------------------------------------------------------------
# Mesh dimensions — read real W/D/H from any STL/OBJ/GLB
# ---------------------------------------------------------------------------
@app.route('/api/mesh-dims', methods=['GET'])
@login_required
def mesh_dims():
    mesh_path = request.args.get('path', '').strip()
    if not mesh_path:
        return jsonify({"error": "path required"}), 400

    safe_prefixes = ("static/generated_meshes/", "static/cad_outputs/")
    norm = os.path.normpath(mesh_path).replace("\\", "/")
    if not any(norm.startswith(p) for p in safe_prefixes):
        return jsonify({"error": "Invalid path"}), 400

    abs_path = os.path.join(os.path.dirname(__file__), norm)
    if not os.path.exists(abs_path):
        return jsonify({"error": "File not found"}), 404

    try:
        import trimesh
        m = trimesh.load(abs_path, force='mesh')
        lo, hi = m.bounding_box.bounds
        extents = hi - lo
        if max(extents) < 10:   # metres → mm
            extents = extents * 1000
        w, d, h = float(extents[0]), float(extents[1]), float(extents[2])
        return jsonify({"w": round(w, 1), "d": round(d, 1), "h": round(h, 1)}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# 3D Print Export — scale mesh to user dims + slice with PrusaSlicer
# ---------------------------------------------------------------------------
@app.route('/api/generate-gcode', methods=['POST'])
@login_required
def generate_gcode():
    """
    Body: { mesh_path, width, depth, height, scale_factor }
    scale_factor: 1.0 = real size, 0.1 = 1:10 prototype (default)
    Returns download URL for G-code (or scaled STL if no slicer found).
    """
    data = request.json or {}
    mesh_path    = data.get('mesh_path', '').strip()
    scale_factor = float(data.get('scale_factor', 0.1))

    try:
        width  = float(data.get('width',  0))
        depth  = float(data.get('depth',  0))
        height = float(data.get('height', 0))
    except (TypeError, ValueError):
        return jsonify({"error": "width / depth / height must be numbers"}), 400

    if not mesh_path or width <= 0 or depth <= 0 or height <= 0:
        return jsonify({"error": "mesh_path, width, depth, height are required"}), 400

    if not (0.01 <= scale_factor <= 1.0):
        return jsonify({"error": "scale_factor must be between 0.01 and 1.0"}), 400

    # Path-traversal guard — only allow server-generated mesh/cad paths
    safe_prefixes = ("static/generated_meshes/", "static/cad_outputs/")
    norm = os.path.normpath(mesh_path).replace("\\", "/")
    if not any(norm.startswith(p) for p in safe_prefixes):
        return jsonify({"error": "Invalid mesh path"}), 400

    abs_path = os.path.join(os.path.dirname(__file__), norm)
    if not os.path.exists(abs_path):
        return jsonify({"error": "Mesh file not found on server"}), 404

    from gcode_generator import generate_print_files
    result = generate_print_files(abs_path, width, depth, height, scale_factor)

    if result.get("error"):
        return jsonify({"error": result["error"]}), 500

    # Make output file downloadable via /static/cad_outputs/...
    file_abs = result["file"]
    file_rel = os.path.relpath(file_abs, os.path.dirname(__file__)).replace("\\", "/")

    return jsonify({
        "type":          result["type"],
        "download_url":  f"/{file_rel}",
        "real_dims_mm":  result["real_dims_mm"],
        "print_dims_mm": result["print_dims_mm"],
        "note":          result.get("note"),
    }), 200


# ---------------------------------------------------------------------------
# Manufacturing Specs Sheet PDF
# ---------------------------------------------------------------------------
@app.route('/api/specs-pdf', methods=['POST'])
@login_required
def specs_pdf():
    data     = request.json or {}
    name     = (data.get('name') or 'Furniture Design').strip()[:120]
    category = (data.get('category') or 'chair').strip().lower()
    ar_url   = (data.get('ar_url') or '').strip()[:500]

    try:
        width  = float(data.get('width',  1200))
        depth  = float(data.get('depth',  700))
        height = float(data.get('height', 750))
    except (TypeError, ValueError):
        return jsonify({"error": "width/depth/height must be numbers"}), 400

    if not (10 <= width <= 5000 and 10 <= depth <= 5000 and 10 <= height <= 5000):
        return jsonify({"error": "Dimensions out of range (10–5000 mm)"}), 400

    try:
        from specs_generator import generate_specs_pdf
        rel_path = generate_specs_pdf(name, category, width, depth, height, ar_url)
        return jsonify({"download_url": f"/{rel_path}"}), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    import werkzeug.serving
    werkzeug.serving.run_simple(
        '0.0.0.0', 5000, app,
        use_reloader=False, use_debugger=False,
        # threaded=True so a long SSE generation / 3D subprocess doesn't block
        # every other request (health checks, static assets, /api/stop).
        threaded=True,
    )
