"""
hunyuan_logic.py
Offloads FLUX schnell from GPU, then spawns Hunyuan3D as a subprocess.
Subprocess gets full VRAM. FLUX schnell reloads on next generation request.
"""
import os
import subprocess
import sys
import gc
import re
import uuid
import torch
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
RUNNER   = BASE_DIR / "_hunyuan_runner.py"

# Hunyuan's texture pipeline needs diffusers 0.32.1, but the main app's diffusers
# was upgraded for FLUX Kontext. Since Hunyuan runs as a subprocess, run it in a
# separate venv (created with --system-site-packages + diffusers==0.32.1) so it
# uses the old diffusers while the main app keeps the new one.
# Resolution order: HUNYUAN_PYTHON env var → local hunyuan_venv → current python.
_VENV_PY = BASE_DIR / "hunyuan_venv" / "Scripts" / "python.exe"        # Windows
_VENV_PY_NIX = BASE_DIR / "hunyuan_venv" / "bin" / "python"           # Linux/mac
HUNYUAN_PYTHON = (
    os.environ.get("HUNYUAN_PYTHON")
    or (str(_VENV_PY) if _VENV_PY.exists() else None)
    or (str(_VENV_PY_NIX) if _VENV_PY_NIX.exists() else None)
    or sys.executable
)
# Absolute path — must not depend on the process' current working directory,
# otherwise the file gets written somewhere Flask can't serve it from.
MESH_DIR = BASE_DIR / "static" / "generated_meshes"
MESH_DIR.mkdir(exist_ok=True, parents=True)


def _free_all_vram():
    """Aggressively free ALL GPU memory from the Flask process."""
    if not torch.cuda.is_available():
        return
    import ai_logic  # import here to avoid circular import at module level

    # Fully unload FLUX schnell + CLIP (VRAM *and* RAM), not just offload to CPU.
    # The Hunyuan subprocess also needs system RAM (texture painting spills there),
    # and a 15 GB machine can't hold FLUX (~4.6 GB parked in RAM) alongside it →
    # MemoryError. The next generation reloads FLUX via ai_logic.ensure_loaded().
    try:
        ai_logic.unload()
    except Exception as _ue:
        print(f"[Hunyuan] FLUX schnell unload failed ({_ue}); offloading to CPU instead.")
        if ai_logic.pipe is not None:
            ai_logic.pipe.to("cpu")
        if ai_logic.clip_model is not None:
            ai_logic.clip_model.to("cpu")

    # Delete all references
    gc.collect()

    # Force PyTorch to release reserved VRAM segments
    torch.cuda.empty_cache()
    torch.cuda.synchronize()

    # Report how much is free now
    free_bytes, total_bytes = torch.cuda.mem_get_info()
    print(f"[Hunyuan] VRAM after offload: {free_bytes/1024**3:.2f}GB free / {total_bytes/1024**3:.2f}GB total")


def _restore_vram():
    """Move FLUX schnell + CLIP back to GPU after Hunyuan subprocess exits."""
    if not torch.cuda.is_available():
        return
    import ai_logic
    # If FLUX was fully unloaded (edit / one-model-at-a-time policy), don't
    # reload it here — the next generation restores it lazily via ensure_loaded().
    if ai_logic.pipe is None:
        print("[Hunyuan] FLUX schnell is unloaded; leaving it for the next generation to reload.")
        return
    device = ai_logic.DEVICE
    try:
        ai_logic.pipe.to(device)
        ai_logic.clip_model.to(device)
        print(f"[Hunyuan] FLUX schnell + CLIP restored to {device}")
    except Exception as e:
        # Rollback — ensure both stay on CPU (no mixed state where some layers
        # are on GPU and others on CPU, which causes cryptic runtime errors).
        print(f"[Hunyuan] VRAM restore failed ({e}), rolling back to CPU.")
        try:
            ai_logic.pipe.to("cpu")
            ai_logic.clip_model.to("cpu")
        except Exception:
            pass
        raise


def generate_3d_mesh(image_relative_path: str, base_name: str, steps: int = 5) -> dict:
    # URL-safe slug (no spaces — spaces break the AR viewer's path validation
    # and complicate URL handling). Collapse any run of invalid chars to "_".
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", base_name or "").strip("_")[:40] or "mesh"
    # Unique suffix so two designs that share the same prompt prefix never
    # overwrite each other's mesh files.
    safe_name = f"{slug}_{uuid.uuid4().hex[:8]}"

    glb = str(MESH_DIR / f"{safe_name}.glb")
    stl = str(MESH_DIR / f"{safe_name}.stl")
    obj = str(MESH_DIR / f"{safe_name}.obj")

    args = [
        HUNYUAN_PYTHON, str(RUNNER),
        "--image", str(BASE_DIR / image_relative_path),
        "--glb",   glb,
        "--stl",   stl,
        "--obj",   obj,
        "--steps", str(max(5, min(50, steps))),
    ]

    # Step 1: Free VRAM from Flask process so subprocess can use full GPU
    _free_all_vram()

    try:
        print(f"[Hunyuan] Spawning subprocess with interpreter: {HUNYUAN_PYTHON}")
        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge stderr into stdout
            text=True,
            bufsize=1,                 # line-buffered
        )

        # Stream output line by line in real-time. flush=True is important —
        # otherwise Flask's stdout buffers these lines and the painting stage
        # looks frozen even though the subprocess is making progress.
        stderr_lines = []
        for line in process.stdout:
            line = line.rstrip()
            print(f"[runner] {line}", flush=True)
            stderr_lines.append(line)

        process.wait()

        if process.returncode != 0:
            # Check if the mesh files were saved before the crash (the runner
            # exports untextured meshes BEFORE attempting texture painting).
            # If they exist, return them instead of failing — the user gets a
            # geometry-only 3D model, which is far better than an error page.
            if os.path.exists(glb) and os.path.getsize(glb) > 0:
                print(f"[Hunyuan] Subprocess crashed (exit {process.returncode}) but mesh files exist — returning geometry-only mesh.")
                return {
                    "glb": f"static/generated_meshes/{safe_name}.glb",
                    "stl": f"static/generated_meshes/{safe_name}.stl",
                    "obj": f"static/generated_meshes/{safe_name}.obj",
                }

            tail = "\n".join(stderr_lines[-20:])
            raise RuntimeError(
                f"Hunyuan3D subprocess failed (exit {process.returncode}):\n{tail}"
            )

    finally:
        # Step 2: Give the subprocess time to fully release VRAM before restoring SDXL.
        import time
        gc.collect()
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
        time.sleep(1)

        # Retry up to 3 times with backoff — texture pipeline used all 8GB,
        # so VRAM might need a moment to fully free after subprocess exit.
        for _attempt in range(3):
            try:
                _restore_vram()
                break
            except Exception as _e:
                if _attempt < 2:
                    print(f"[Hunyuan] Restore attempt {_attempt + 1}/3 failed ({_e}), retrying in {(_attempt + 1) * 3}s...")
                    time.sleep((_attempt + 1) * 3)
                    gc.collect()
                    torch.cuda.empty_cache()
                else:
                    print(f"[Hunyuan] All restore attempts failed. FLUX schnell will run on CPU until next generation (self-healing).")

    return {
        "glb": f"static/generated_meshes/{safe_name}.glb",
        "stl": f"static/generated_meshes/{safe_name}.stl",
        "obj": f"static/generated_meshes/{safe_name}.obj",
    }