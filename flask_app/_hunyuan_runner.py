"""
_hunyuan_runner.py
Standalone script executed as a subprocess by hunyuan_logic.py.
MUST set PYTORCH_CUDA_ALLOC_CONF before any torch/cuda imports.
"""
import os
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True,max_split_size_mb:256"

import sys
import argparse
import threading
from pathlib import Path

# ── Ensure we run in the Hunyuan venv (diffusers 0.32.1) ──────────────────────
# The main app's diffusers was upgraded for FLUX Kontext, which breaks Hunyuan's
# texture pipeline (it needs diffusers 0.32.1 + its non-trust_remote_code loader).
# If a local hunyuan_venv exists and we're not already running under it, re-exec
# into it. Self-contained: works regardless of which interpreter launched us and
# needs no app restart (this script is read fresh on every 3D run).
_VENV_PY = Path(__file__).resolve().parent / "hunyuan_venv" / "Scripts" / "python.exe"
if not _VENV_PY.exists():
    _VENV_PY = Path(__file__).resolve().parent / "hunyuan_venv" / "bin" / "python"
if (_VENV_PY.exists()
        and Path(sys.executable).resolve() != _VENV_PY.resolve()
        and os.environ.get("_HUNYUAN_REEXEC") != "1"):
    import subprocess as _sp
    print(f"[runner] Re-exec into Hunyuan venv: {_VENV_PY}", flush=True)
    # subprocess.call inherits this process's stdout/stderr (the pipe back to
    # hunyuan_logic), so the parent still sees all output. Wait + exit with code.
    _env = dict(os.environ, _HUNYUAN_REEXEC="1")
    _ret = _sp.call([str(_VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]], env=_env)
    sys.exit(_ret)

from PIL import Image


class _SkipTexture(Exception):
    """Raised to intentionally skip the texture-painting stage."""
    pass


def _fix_stl(stl_path: str) -> None:
    """Repair mesh topology so the STL is watertight and 3D-printer-ready."""
    try:
        import trimesh
        m = trimesh.load(stl_path)
        trimesh.repair.fix_normals(m)
        trimesh.repair.fix_winding(m)
        trimesh.repair.fill_holes(m)
        m.merge_vertices()
        m.update_faces(m.nondegenerate_faces())
        m.remove_unreferenced_vertices()
        m.export(stl_path)
        print(f"[runner] STL repaired → watertight={m.is_watertight}")
    except Exception as _e:
        print(f"[runner] STL repair skipped ({_e}).")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--glb",   required=True)
    parser.add_argument("--stl",   required=True)
    parser.add_argument("--obj",   required=True)
    parser.add_argument("--steps", type=int, default=5)
    args = parser.parse_args()

    # Real-time logs — without this, prints to the parent's pipe are block-buffered
    # and progress is invisible until the buffer flushes.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    # Diagnostic: confirm which interpreter + diffusers version this subprocess uses.
    try:
        import sys as _sys, diffusers as _dfx
        print(f"[runner] python={_sys.executable}")
        print(f"[runner] diffusers={_dfx.__version__} (from {_dfx.__file__})")
    except Exception as _de:
        print(f"[runner] diffusers version check failed: {_de}")

    print(f"[runner] Loading image: {args.image}")
    image = Image.open(args.image)

    print("[runner] Removing background...")
    if image.mode == "RGB":
        try:
            # Stub pymatting — rembg imports it at module level even when alpha_matting=False.
            # We only need the names to exist; they'll never be called with alpha_matting=False.
            import sys, types
            if "pymatting" not in sys.modules:
                _dummy = lambda *a, **kw: None

                _pm = types.ModuleType("pymatting")
                _sub_names = [
                    "pymatting.alpha", "pymatting.alpha.estimate_alpha_cf",
                    "pymatting.foreground", "pymatting.foreground.estimate_foreground_ml",
                    "pymatting.util", "pymatting.util.util",
                    "pymatting.laplacian", "pymatting.preconditioner",
                    "pymatting.solver",
                ]
                sys.modules["pymatting"] = _pm
                for _name in _sub_names:
                    _mod = types.ModuleType(_name)
                    sys.modules[_name] = _mod
                    _parts = _name.split(".")
                    _parent = sys.modules[".".join(_parts[:-1])]
                    setattr(_parent, _parts[-1], _mod)

                # Set the actual function names rembg imports at top level:
                #   from pymatting.alpha.estimate_alpha_cf import estimate_alpha_cf
                #   from pymatting.foreground.estimate_foreground_ml import estimate_foreground_ml
                #   from pymatting.util.util import stack_images
                sys.modules["pymatting.alpha.estimate_alpha_cf"].estimate_alpha_cf = _dummy
                sys.modules["pymatting.foreground.estimate_foreground_ml"].estimate_foreground_ml = _dummy
                sys.modules["pymatting.util.util"].stack_images = _dummy

            from rembg import remove, new_session
            # isnet-general-use keeps product edges intact better than u2net.
            session = None
            for _m in (os.environ.get("HOLO_REMBG_MODEL", "birefnet-general"), "isnet-general-use", "u2net"):
                try:
                    session = new_session(_m)
                    print(f"[runner] Background remover model: {_m}")
                    break
                except Exception as _me:
                    print(f"[runner] rembg model '{_m}' unavailable ({_me}); trying next.")
            image = remove(image, session=session, bgcolor=[255, 255, 255, 0],
                           alpha_matting=False, post_process_mask=True)
            # Remove isolated near-white semi-transparent artifacts
            if image.mode == "RGBA":
                import numpy as np
                arr = np.array(image)
                r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
                is_artifact = (r > 200) & (g > 200) & (b > 200) & (a > 0) & (a < 230)
                arr[is_artifact, 3] = 0
                image = Image.fromarray(arr, "RGBA")
            print(f"[runner] Background removed. Mode: {image.mode}")
        except Exception as e:
            print(f"[runner] Background removal failed, using original image: {e}")
        finally:
            # Explicitly free rembg session from GPU before loading Hunyuan.
            # birefnet-general is large and holds VRAM — without this the
            # texture pipeline runs out of memory and crashes.
            try:
                del session
            except NameError:
                pass
            import gc as _gc
            _gc.collect()
            try:
                import torch as _torch
                if _torch.cuda.is_available():
                    _torch.cuda.empty_cache()
                    print("[runner] VRAM cleared after background removal.")
            except Exception:
                pass

    print("[runner] Loading Hunyuan3D shape pipeline...")
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        "tencent/Hunyuan3D-2mini",
        subfolder="hunyuan3d-dit-v2-mini-turbo",
    )

    # Speed optimizations (no quality loss)
    try:
        pipeline.enable_flashvdm(enabled=True)
        print("[runner] FlashVDM enabled (faster VAE decoding)")
    except Exception as e:
        print(f"[runner] FlashVDM not available: {e}")

    print(f"[runner] Generating mesh ({args.steps} steps)...")
    mesh = pipeline(image=image, num_inference_steps=args.steps)[0]

    # Free shape pipeline VRAM before texture painting
    del pipeline
    import torch, gc
    gc.collect()
    torch.cuda.empty_cache()

    if mesh is None:
        print("[runner] ERROR: Mesh generation returned None (no surface found).")
        print("[runner] This usually means background removal failed and the image still has a background.")
        sys.exit(1)

    # Clean + decimate the mesh BEFORE texturing. The raw shape mesh can have
    # hundreds of thousands of faces, which makes xatlas UV-unwrapping (CPU,
    # single-threaded, inside the paint pipeline) take many minutes and look
    # completely frozen. Capping the face count makes UV-unwrap + rendering fast.
    # Tune with HUNYUAN_MAX_FACES (default 40000).
    try:
        from hy3dgen.shapegen import FloaterRemover, DegenerateFaceRemover, FaceReducer
        try:
            _max_faces = int(os.environ.get("HUNYUAN_MAX_FACES", "40000"))
        except ValueError:
            _max_faces = 40000
        _n0 = len(mesh.faces) if hasattr(mesh, "faces") else -1
        print(f"[runner] Cleaning + decimating mesh (from {_n0} faces -> target {_max_faces})...")
        mesh = FloaterRemover()(mesh)
        mesh = DegenerateFaceRemover()(mesh)
        mesh = FaceReducer()(mesh, max_facenum=_max_faces)
        # Extra floater cull: drop small disconnected fragments the shape model
        # sometimes hallucinates (the "floating clouds" above the object).
        try:
            import trimesh as _tm
            comps = mesh.split(only_watertight=False)
            if len(comps) > 1:
                biggest = max(len(c.faces) for c in comps)
                # Conservative: only drop truly tiny specks (<2% of the main body)
                # so real product parts (armrests, thin legs) are never removed.
                keep = [c for c in comps if len(c.faces) >= 0.02 * biggest]
                if keep and len(keep) < len(comps):
                    mesh = _tm.util.concatenate(keep)
                    print(f"[runner] Removed {len(comps) - len(keep)} floating fragment(s).")
        except Exception as _fe:
            print(f"[runner] Floater removal skipped ({_fe}).")
        _n1 = len(mesh.faces) if hasattr(mesh, "faces") else -1
        print(f"[runner] Mesh ready for texturing: {_n1} faces.")
    except Exception as _re:
        print(f"[runner] Mesh cleanup/decimation skipped ({_re}); continuing with raw mesh.")

    # Save untextured mesh first (safety net in case texture painting crashes)
    Path(args.glb).parent.mkdir(parents=True, exist_ok=True)
    print(f"[runner] Saving untextured mesh as backup...")
    mesh.export(args.glb)
    mesh.export(args.stl)
    mesh.export(args.obj)
    _fix_stl(args.stl)

    # Step 2: Paint textures onto the mesh
    textured = False
    paint_pipeline = None
    # Opt-out switch for low-VRAM machines where texture painting is too slow /
    # unsupported (e.g. fp16 on CPU). The untextured mesh is fully usable.
    skip_texture = os.environ.get("HUNYUAN_SKIP_TEXTURE", "").strip().lower() in ("1", "true", "yes", "on")
    try:
        paint_timeout = int(os.environ.get("HUNYUAN_PAINT_TIMEOUT", "900"))
    except ValueError:
        paint_timeout = 900
    try:
        if skip_texture:
            raise _SkipTexture("HUNYUAN_SKIP_TEXTURE is set")

        # Check CUDA rasterizer extension first
        try:
            import custom_rasterizer_kernel  # noqa: F401
            print("[runner] custom_rasterizer_kernel OK")
        except ImportError:
            raise ImportError(
                "custom_rasterizer_kernel not compiled! "
                "Run: cd Hunyuan3D-2-main/hy3dgen/texgen/custom_rasterizer && python setup.py install"
            )

        print("[runner] Loading texture paint pipeline to CPU first (8GB VRAM mode)...")
        from hy3dgen.texgen import Hunyuan3DPaintPipeline
        from hy3dgen.texgen.pipelines import Hunyuan3DTexGenConfig

        # Texture/render resolution. Higher = sharper texture. 1024 gives good
        # quality; the baking step's big numpy arrays are handled by the enlarged
        # Windows page file (so no MemoryError), at the cost of a slower bake.
        # Drop to 512 (via HUNYUAN_TEXTURE_SIZE) if the bake is too slow.
        try:
            _tex_size = int(os.environ.get("HUNYUAN_TEXTURE_SIZE", "512"))
        except ValueError:
            _tex_size = 1024

        _orig_init = Hunyuan3DTexGenConfig.__init__
        def _cpu_init(self, *a, **kw):
            _orig_init(self, *a, **kw)
            # Load models on CPU, then stream each to GPU per-forward via
            # enable_model_cpu_offload() below. This keeps VRAM free during the
            # multiview stage → ~2-3 s/step (fast) instead of loading everything
            # to CUDA which fills the 8 GB → spills to system RAM → ~26 s/step.
            self.device = 'cpu'
            self.render_size = _tex_size
            self.texture_size = _tex_size
        Hunyuan3DTexGenConfig.__init__ = _cpu_init
        print(f"[runner] Texture/render resolution: {_tex_size}px")
        try:
            paint_pipeline = Hunyuan3DPaintPipeline.from_pretrained(
                "tencent/Hunyuan3D-2",
                subfolder="hunyuan3d-paint-v2-0-turbo",
            )
        finally:
            Hunyuan3DTexGenConfig.__init__ = _orig_init

        # Stream each module to GPU only during its forward pass — keeps VRAM free
        # so the multiview diffusion runs on-GPU (fast) instead of spilling to RAM.
        print("[runner] Enabling model CPU offload...")
        paint_pipeline.enable_model_cpu_offload()

        # Re-enable the diffusion progress bars — the library disables them, which
        # makes the (multi-minute) painting stage look completely frozen. With
        # these on you can watch the de-light (50 steps) and multiview (30 steps)
        # samplers actually progress.
        try:
            paint_pipeline.models['delight_model'].pipeline.set_progress_bar_config(disable=False)
            paint_pipeline.models['multiview_model'].pipeline.set_progress_bar_config(disable=False)
            print("[runner] Progress bars re-enabled for painting stages.")
        except Exception as _pe:
            print(f"[runner] Could not re-enable progress bars: {_pe}")

        # ── VRAM cleanup hook ──────────────────────────────────────────────
        # After the delight stage (50 steps), its UNet is moved back to CPU
        # by enable_model_cpu_offload(), BUT PyTorch's CUDA allocator still
        # holds the freed blocks in its cache. The multiview UNet then can't
        # fit because torch.cuda.mem_get_info() shows free space but the
        # allocator won't release it without an explicit empty_cache().
        # Fix: wrap the multiview pipeline's __call__ to force a full VRAM
        # flush before the multiview UNet gets moved to GPU.
        try:
            _mv_pipeline = paint_pipeline.models['multiview_model'].pipeline
            _orig_mv_call = _mv_pipeline.__class__.__call__

            def _mv_call_with_vram_flush(self, *args, **kwargs):
                # Force ALL delight-stage VRAM back to the OS before multiview
                gc.collect()
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
                _free, _total = torch.cuda.mem_get_info()
                print(f"[runner] VRAM flushed before multiview: {_free/1024**3:.2f}GB free / {_total/1024**3:.2f}GB total", flush=True)
                return _orig_mv_call(self, *args, **kwargs)

            # Bind as an unbound method on the class won't work if there are
            # other instances; safer to patch THIS instance's __call__:
            import types
            _mv_pipeline.__call__ = types.MethodType(
                lambda self, *a, **kw: _mv_call_with_vram_flush(self, *a, **kw),
                _mv_pipeline,
            )
            print("[runner] VRAM flush hook installed between delight → multiview stages.")
        except Exception as _hook_err:
            print(f"[runner] Could not install VRAM flush hook: {_hook_err}")

        free_bytes, total_bytes = torch.cuda.mem_get_info()
        print(f"[runner] VRAM before painting: {free_bytes/1024**3:.2f}GB free / {total_bytes/1024**3:.2f}GB total")

        # Run painting in a worker thread guarded by a timeout. On low-VRAM /
        # CPU-offload setups this stage can hang indefinitely instead of raising,
        # which would otherwise block the whole request forever.
        print(f"[runner] Painting textures (timeout {paint_timeout}s)...")
        _paint_result: dict = {}

        def _run_paint():
            try:
                _paint_result["mesh"] = paint_pipeline(mesh, image=image)
            except BaseException as _pe:  # noqa: BLE001
                _paint_result["error"] = _pe

        _paint_thread = threading.Thread(target=_run_paint, daemon=True)
        _paint_thread.start()
        _paint_thread.join(paint_timeout)

        if _paint_thread.is_alive():
            # Stuck — the untextured GLB/STL/OBJ were already exported above,
            # so force-exit cleanly and let the caller serve the geometry mesh.
            print(f"[runner] *** Texture painting exceeded {paint_timeout}s — keeping geometry-only mesh.")
            print("[runner] Tip: set HUNYUAN_SKIP_TEXTURE=1 to skip texturing on this machine.")
            os._exit(0)

        if "error" in _paint_result:
            raise _paint_result["error"]

        mesh = _paint_result["mesh"]
        textured = True
        print("[runner] Textures applied successfully!")

        # Overwrite with textured version
        print(f"[runner] Saving textured mesh...")
        mesh.export(args.glb)
        mesh.export(args.stl)
        mesh.export(args.obj)
        _fix_stl(args.stl)

    except _SkipTexture as e:
        print(f"[runner] Skipping texture painting ({e}). Using geometry-only mesh (already saved).")
    except Exception as e:
        import traceback
        print(f"[runner] *** TEXTURE PAINTING FAILED: {e}")
        traceback.print_exc()
        print("[runner] Falling back to untextured mesh (already saved).")
    finally:
        # Always free VRAM after paint attempt — success or failure
        if paint_pipeline is not None:
            del paint_pipeline
        gc.collect()
        torch.cuda.empty_cache()

    print(f"[runner] Done. {'(textured)' if textured else '(geometry only)'}")


if __name__ == "__main__":
    main()