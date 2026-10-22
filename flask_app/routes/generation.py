"""
routes/generation.py
Blueprint for AI image generation (polling), image editing (FLUX Kontext),
3D mesh generation (Hunyuan3D), stop control, and health check.
"""

import os
import threading
import time

from flask import Blueprint, request, jsonify, current_app

from decorators import login_required
from extensions import (
    generation_lock,
    is_stop_requested, reset_stop_flag, request_stop,
    edit_jobs, edit_jobs_lock,
    three_d_jobs, three_d_jobs_lock,
    generate_jobs, generate_jobs_lock,
    prune_jobs, new_job_id,
)

generation_bp = Blueprint("generation", __name__)


# ───────────────────────────────────────────────────────────────────────────
# Health check
# ───────────────────────────────────────────────────────────────────────────

@generation_bp.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"ready": True, "status": "All models loaded"}), 200


# ───────────────────────────────────────────────────────────────────────────
# Stop generation
# ───────────────────────────────────────────────────────────────────────────

@generation_bp.route('/api/stop', methods=['POST'])
@login_required
def stop_generation():
    request_stop()
    return jsonify({"message": "Stop requested"}), 200


# ───────────────────────────────────────────────────────────────────────────
# Image Generation (async job with polling — works through any proxy)
# ───────────────────────────────────────────────────────────────────────────

def _run_generate_job(app, job_id, user_prompt, seed, gen_steps):
    """Background worker: runs FLUX image generation."""
    with app.app_context():
        reset_stop_flag()
        try:
            try:
                import edit_logic, ai_logic
                edit_logic.unload_pipe()
                ai_logic.ensure_loaded()
            except Exception as _e:
                print(f"[generate] model handoff warning: {_e}")

            from search_logic import search_factory_products
            best_match = search_factory_products(user_prompt)

            # Update job with factory match as soon as it's ready
            with generate_jobs_lock:
                generate_jobs[job_id]["factory_match"] = {
                    "id":          best_match['id'] if best_match else None,
                    "description": best_match['description'] if best_match else "No close match found",
                    "file_path":   best_match['file_path'] if best_match else None,
                    "match_score": best_match['score'] if best_match else 0,
                }

            def progress_fn(event: dict):
                with generate_jobs_lock:
                    j = generate_jobs.get(job_id)
                    if j is not None:
                        j["last_event"] = event
                        if event.get("type") == "step":
                            j["step"] = event.get("step", 0)
                            j["total_steps"] = event.get("total_steps", gen_steps)
                        elif event.get("type") == "done":
                            j["ai_generated"] = event.get("result")

            from ai_logic import generate_ai_design, StopGenerationError
            generate_ai_design(
                user_prompt,
                progress_fn=progress_fn,
                seed=seed,
                stop_fn=is_stop_requested,
                steps=gen_steps,
            )

            with generate_jobs_lock:
                generate_jobs[job_id]["status"] = "completed"

        except Exception as e:
            if type(e).__name__ == "StopGenerationError":
                with generate_jobs_lock:
                    generate_jobs[job_id].update(status="stopped", error="Generation stopped by user")
            else:
                import traceback
                traceback.print_exc()
                with generate_jobs_lock:
                    generate_jobs[job_id].update(status="error", error=str(e))
        finally:
            generation_lock.release()


@generation_bp.route('/api/generate', methods=['GET'])
@login_required
def generate_design():
    user_prompt = request.args.get('prompt', '').strip()
    seed  = request.args.get('seed', None)
    try:
        gen_steps = max(1, min(50, int(request.args.get('steps', 4))))
    except (ValueError, TypeError):
        gen_steps = 4
    if not user_prompt:
        return jsonify({"error": "prompt query param is required"}), 400
    if len(user_prompt) > 1000:
        return jsonify({"error": "Prompt is too long (max 1000 characters)"}), 400

    if not generation_lock.acquire(blocking=False):
        return jsonify({"error": "A generation is already in progress. Stop it or wait for it to finish."}), 429

    prune_jobs(generate_jobs, generate_jobs_lock)
    job_id = new_job_id()
    with generate_jobs_lock:
        generate_jobs[job_id] = {
            "status": "processing",
            "step": 0,
            "total_steps": gen_steps,
            "ai_generated": None,
            "factory_match": None,
            "error": None,
            "last_event": None,
            "created": time.time(),
        }

    app = current_app._get_current_object()
    t = threading.Thread(
        target=_run_generate_job,
        args=(app, job_id, user_prompt, seed, gen_steps),
        daemon=True,
    )
    t.start()
    return jsonify({"job_id": job_id, "status": "processing"}), 202


@generation_bp.route('/api/generate_status/<job_id>', methods=['GET'])
@login_required
def generate_status(job_id):
    with generate_jobs_lock:
        job = generate_jobs.get(job_id)
        if job is None:
            return jsonify({"error": "Unknown job_id"}), 404
        return jsonify({"job_id": job_id, **job})


# ───────────────────────────────────────────────────────────────────────────
# 3D Mesh Generation (async job)
# ───────────────────────────────────────────────────────────────────────────

def _run_3d_job(app, job_id, preview_url, base_name, steps):
    """Background worker: runs the Hunyuan 3D pipeline."""
    with app.app_context():
        try:
            try:
                import edit_logic, ai_logic
                edit_logic.unload_pipe()
                ai_logic.unload()          # free schnell pipeline (~5-6 GB RAM)
            except Exception as _e:
                print(f"[3d] model unload warning: {_e}")

            from hunyuan_logic import generate_3d_mesh
            mesh_paths = generate_3d_mesh(preview_url, base_name, steps=steps)
            with three_d_jobs_lock:
                three_d_jobs[job_id].update(status="completed", mesh=mesh_paths)
        except Exception as e:
            import traceback
            traceback.print_exc()
            with three_d_jobs_lock:
                three_d_jobs[job_id].update(status="error", error=str(e))
        finally:
            generation_lock.release()


@generation_bp.route('/api/generate_3d', methods=['POST'])
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

    safe_prefixes = ("static/generated_assets/", "static/factory_assets/")
    norm = os.path.normpath(preview_url).replace("\\", "/")
    if not any(norm.startswith(p) for p in safe_prefixes):
        return jsonify({"error": "Invalid image path"}), 400

    if not generation_lock.acquire(blocking=False):
        return jsonify({"error": "GPU is busy with another generation. Please wait."}), 429

    base_name = "".join(
        c if c.isalnum() or c in (" ", "_") else "" for c in prompt
    )[:50]

    prune_jobs(three_d_jobs, three_d_jobs_lock)
    job_id = new_job_id()
    with three_d_jobs_lock:
        three_d_jobs[job_id] = {
            "status": "processing", "mesh": None, "error": None,
            "created": time.time(),
        }

    app = current_app._get_current_object()
    t = threading.Thread(
        target=_run_3d_job,
        args=(app, job_id, preview_url, base_name, steps),
        daemon=True,
    )
    t.start()
    return jsonify({"job_id": job_id, "status": "processing"}), 202


@generation_bp.route('/api/generate_3d_status/<job_id>', methods=['GET'])
@login_required
def generate_3d_status(job_id):
    with three_d_jobs_lock:
        job = three_d_jobs.get(job_id)
        if job is None:
            return jsonify({"error": "Unknown job_id"}), 404
        return jsonify({"job_id": job_id, **job})


# ───────────────────────────────────────────────────────────────────────────
# Image Edit — FLUX Kontext (async job)
# ───────────────────────────────────────────────────────────────────────────

def _run_edit_job(app, job_id, image_path, edit_prompt, output_name, steps):
    """Background worker: runs FLUX Kontext edit."""
    with app.app_context():
        from edit_logic import edit_design

        def _progress(step, total):
            with edit_jobs_lock:
                j = edit_jobs.get(job_id)
                if j is not None:
                    j["step"], j["total"] = step, total

        try:
            import gc, ai_logic as _ai, torch as _torch
            _ai.unload()
            # Extra cleanup: drop any lingering tensor refs in this process
            gc.collect()
            if _torch.cuda.is_available():
                _torch.cuda.empty_cache()
                free_b, total_b = _torch.cuda.mem_get_info()
                print(f"[edit] FLUX schnell unloaded → {free_b/1024**3:.2f}GB free / {total_b/1024**3:.2f}GB")
        except Exception as _e:
            print(f"[edit] FLUX schnell unload skipped: {_e}")

        try:
            result = edit_design(
                image_path=image_path,
                edit_prompt=edit_prompt,
                output_name=output_name,
                steps=steps,
                progress_cb=_progress,
            )
            with edit_jobs_lock:
                edit_jobs[job_id].update(
                    status="completed",
                    preview_url=result["preview_url"],
                    message=result.get("message", ""),
                )
        except FileNotFoundError as e:
            with edit_jobs_lock:
                edit_jobs[job_id].update(status="error", error=str(e))
        except Exception as e:
            import traceback
            traceback.print_exc()
            with edit_jobs_lock:
                edit_jobs[job_id].update(status="error", error=str(e))
        finally:
            generation_lock.release()


@generation_bp.route('/api/edit-design', methods=['POST'])
@login_required
def edit_design_route():
    data = request.json or {}
    image_path  = data.get('image_path', '').strip()
    edit_prompt = data.get('prompt', '').strip()

    if not image_path or not edit_prompt:
        return jsonify({"error": "image_path and prompt are required"}), 400

    norm = os.path.normpath(image_path).replace("\\", "/")
    if not norm.startswith("static/generated_assets/"):
        return jsonify({"error": "Invalid image path"}), 400

    if len(edit_prompt) > 1000:
        return jsonify({"error": "Prompt too long (max 1000 characters)"}), 400

    if not generation_lock.acquire(blocking=False):
        return jsonify({"error": "GPU is busy with another generation. Please wait."}), 429

    steps = int(data['steps']) if 'steps' in data else None
    prune_jobs(edit_jobs, edit_jobs_lock)
    job_id = new_job_id()
    with edit_jobs_lock:
        edit_jobs[job_id] = {
            "status": "processing", "step": 0, "total": steps or 28,
            "preview_url": None, "error": None, "message": "",
            "created": time.time(),
        }

    app = current_app._get_current_object()
    t = threading.Thread(
        target=_run_edit_job,
        args=(app, job_id, image_path, edit_prompt,
              data.get('output_name') or None, steps),
        daemon=True,
    )
    t.start()
    return jsonify({"job_id": job_id, "status": "processing"}), 202


@generation_bp.route('/api/edit-status/<job_id>', methods=['GET'])
@login_required
def edit_status_route(job_id):
    with edit_jobs_lock:
        job = edit_jobs.get(job_id)
        if job is None:
            return jsonify({"error": "Unknown job_id"}), 404
        return jsonify({"job_id": job_id, **job})
