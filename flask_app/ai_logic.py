import os
import re
import torch
from diffusers import StableDiffusionXLPipeline, AutoencoderKL
from transformers import CLIPModel, CLIPProcessor
from pathlib import Path
from typing import Callable, Optional

BASE_DIR = Path(__file__).resolve().parent

LORA_PATH = BASE_DIR / "models" / "furniture_lora.safetensors"
VAE_PATH  = BASE_DIR / "models" / "vae"

# Absolute path — independent of the process' working directory.
OUTPUT_DIR = BASE_DIR / "static" / "generated_assets"
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# ---------------------------------------------------------------------------
# Quality gate settings
# ---------------------------------------------------------------------------
CLIP_SCORE_THRESHOLD = 0.20
MAX_ATTEMPTS         = 2
TOTAL_STEPS          = 30

NEG_PROMPT = (
    "blurry, distorted, low quality, multiple objects, multiple furniture, "
    "group of furniture, cropped, text, watermark, cut off, zoomed in, "
    "close-up, macro, partial view, detail shot, zoomed in on fabric, "
    "room, interior, indoor scene, lifestyle, background scenery, furniture set, "
    "plant, window, desk, computer, rug, floor, wall, people, "
    "dining chairs, dining set, place settings, food on table, cutlery, "
    "tablecloth, multiple tables, product grid, collage, four items, 4 items, "
    "product variations, grid layout"
)

# ---------------------------------------------------------------------------
# Model loading — wrapped in a function so SDXL + CLIP can be unloaded/reloaded.
# On a 15 GB-RAM machine SDXL (~6.5 GB) and the Kontext editor (~14 GB) cannot
# both be resident, so editing / 3D unload SDXL and generation reloads it.
# ---------------------------------------------------------------------------
vae = None
pipe = None
clip_model = None
clip_processor = None


def _load_models():
    """(Re)load SDXL + LoRA + fixed VAE + CLIP onto DEVICE."""
    global vae, pipe, clip_model, clip_processor

    print("Loading SDXL base + local fixed VAE...")
    vae = AutoencoderKL.from_pretrained(VAE_PATH, torch_dtype=torch.float16)
    vae.config.force_upcast = True

    print("Loading SDXL pipeline...")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        vae=vae,
        torch_dtype=torch.float16,
        variant="fp16",
    )
    try:
        from diffusers.models.attention_processor import AttnProcessor2_0
        pipe.unet.set_attn_processor(AttnProcessor2_0())
        print("PyTorch SDPA attention enabled (Blackwell-compatible)")
    except Exception as e:
        print(f"SDPA unavailable ({e}), using attention slicing")
        pipe.enable_attention_slicing(1)

    # The 8GB card is right at the edge with SDXL (~6.9GB resident). These slicing
    # options cut the peak activation/decode memory so generation stays under 8GB
    # instead of overflowing into slow system-RAM fallback. Small (~10%) speed cost,
    # huge win vs the sysmem-fallback crawl.
    try:
        pipe.enable_vae_slicing()
        pipe.enable_vae_tiling()
        pipe.enable_attention_slicing()
        print("VAE slicing/tiling + attention slicing enabled (VRAM headroom)")
    except Exception as _se:
        print(f"Could not enable slicing ({_se})")

    print("Loading furniture LoRA weights...")
    pipe.load_lora_weights(str(LORA_PATH))

    # Model CPU offload: keep only the actively-running component on the GPU. During
    # the denoising loop that's just the UNet (~5-6GB), which fits an 8GB card with
    # headroom and runs at full GPU speed; the text encoders / VAE are paged onto the
    # GPU only for their brief turn, then moved back to CPU. This is what lets SDXL
    # fit in 8GB without the slow system-RAM fallback. Do NOT also call pipe.to(cuda)
    # here — accelerate manages device placement once offload is enabled.
    if DEVICE == "cuda":
        pipe.enable_model_cpu_offload()
        print("SDXL model CPU offload enabled (fits 8GB, full-speed UNet)")
    else:
        pipe.to(DEVICE)

    print("Loading CLIP model for quality scoring...")
    # CLIP loads on the CPU; it's moved to the GPU only for the brief scoring pass
    # (see generate_ai_design), so it never competes with SDXL during diffusion.
    clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to("cpu")
    if clip_processor is None:
        clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    clip_model.eval()
    print("All models ready!")


def unload():
    """Fully free SDXL + CLIP from GPU *and* RAM (for the edit / 3D handoff)."""
    global vae, pipe, clip_model
    import gc
    if pipe is not None:
        try:
            pipe.to("cpu")
        except Exception:
            pass
    pipe = None
    vae = None
    clip_model = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    print("[ai_logic] SDXL + CLIP unloaded (RAM + VRAM freed)")


def ensure_loaded():
    """Reload SDXL + CLIP if they were unloaded; make sure they're on DEVICE."""
    global pipe, clip_model
    if pipe is None:
        print("[ai_logic] Reloading SDXL + CLIP...")
        _load_models()
    # When loaded, SDXL uses accelerate's model-cpu-offload, which manages device
    # placement itself — we must NOT call pipe.to(cuda) here or it breaks the hooks.


# Initial load at import.
_load_models()


# ---------------------------------------------------------------------------
# GPU memory helpers (for Hunyuan handoff)
# ---------------------------------------------------------------------------
def free_gpu_for_hunyuan():
    if DEVICE != "cuda":
        return
    import gc
    pipe.to("cpu")
    clip_model.to("cpu")
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.synchronize()
    free_bytes, total_bytes = torch.cuda.mem_get_info()
    print(f"[Hunyuan] VRAM after offload: {free_bytes/1024**3:.2f}GB free / {total_bytes/1024**3:.2f}GB total")


def restore_gpu_after_hunyuan():
    if DEVICE != "cuda":
        return
    pipe.to(DEVICE)
    clip_model.to(DEVICE)
    print(f"[Hunyuan] SDXL + CLIP restored to {DEVICE}")


# ---------------------------------------------------------------------------
# CLIP score
# ---------------------------------------------------------------------------
@torch.no_grad()
def clip_score(image, prompt: str) -> float:
    inputs = clip_processor(text=[prompt], images=image, return_tensors="pt", padding=True)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}

    image_embeds = clip_model.get_image_features(pixel_values=inputs["pixel_values"])
    text_embeds  = clip_model.get_text_features(
        input_ids=inputs["input_ids"], attention_mask=inputs["attention_mask"]
    )

    image_embeds = image_embeds / image_embeds.norm(dim=-1, keepdim=True)
    text_embeds  = text_embeds  / text_embeds.norm(dim=-1, keepdim=True)

    return (image_embeds @ text_embeds.T).item()


# ---------------------------------------------------------------------------
# SSE step callback
# ---------------------------------------------------------------------------
class StopGenerationError(Exception):
    """Raised inside the diffusion callback when the user clicks Stop."""
    pass


def _make_callback(
    attempt: int,
    progress_fn: Optional[Callable[[dict], None]],
    stop_fn: Optional[Callable[[], bool]] = None,
    total_steps: int = None,
):
    """
    Returns a diffusers-compatible callback that fires every step.
    progress_fn receives a dict that gets sent as an SSE event.
    stop_fn(), if provided, is polled each step — raises StopGenerationError to abort.
    """
    actual_total = total_steps or TOTAL_STEPS
    def callback(pipe_obj, step: int, timestep, callback_kwargs):
        # Check stop flag BEFORE sending progress so the frontend sees it halt
        if stop_fn and stop_fn():
            raise StopGenerationError("Generation stopped by user")
        if progress_fn:
            progress_fn({
                "type":        "step",
                "attempt":     attempt,
                "max_attempts": MAX_ATTEMPTS,
                "step":        step + 1,
                "total_steps": actual_total,
            })
        return callback_kwargs
    return callback


# ---------------------------------------------------------------------------
# Image generation (with optional SSE progress)
# ---------------------------------------------------------------------------
@torch.no_grad()
def _generate_image(prompt: str, attempt: int, progress_fn=None, seed: int = None, stop_fn=None, steps: int = None):
    generator = None
    if seed is not None:
        generator = torch.Generator(device=DEVICE).manual_seed(int(seed))
    actual_steps = steps or TOTAL_STEPS
    result = pipe(
        prompt=prompt,
        negative_prompt=NEG_PROMPT,
        num_inference_steps=actual_steps,
        guidance_scale=9.0,
        width=640,
        height=640,
        generator=generator,
        callback_on_step_end=_make_callback(attempt, progress_fn, stop_fn, total_steps=actual_steps),
    )
    return result.images[0]


# ---------------------------------------------------------------------------
# Background removal → pure white composite
# The fine-tuned model sometimes renders a full lifestyle scene. This isolates
# the product on white so (a) the 2D preview matches the intended product-shot
# look, and (b) the 3D stage receives a clean subject (far fewer floaters).
# ---------------------------------------------------------------------------
_REMBG_SESSION = None
_REMBG_DISABLED = False


def _get_rembg_session():
    global _REMBG_SESSION, _REMBG_DISABLED
    if _REMBG_SESSION is not None or _REMBG_DISABLED:
        return _REMBG_SESSION
    try:
        import sys, types
        # rembg imports pymatting at module level even when alpha_matting=False.
        # Stub the names it needs so the import succeeds without pymatting installed.
        if "pymatting" not in sys.modules:
            _dummy = lambda *a, **kw: None
            for _name in ["pymatting", "pymatting.alpha", "pymatting.alpha.estimate_alpha_cf",
                          "pymatting.foreground", "pymatting.foreground.estimate_foreground_ml",
                          "pymatting.util", "pymatting.util.util"]:
                _mod = types.ModuleType(_name)
                sys.modules[_name] = _mod
                if "." in _name:
                    _parts = _name.split(".")
                    setattr(sys.modules[".".join(_parts[:-1])], _parts[-1], _mod)
            sys.modules["pymatting.alpha.estimate_alpha_cf"].estimate_alpha_cf = _dummy
            sys.modules["pymatting.foreground.estimate_foreground_ml"].estimate_foreground_ml = _dummy
            sys.modules["pymatting.util.util"].stack_images = _dummy
        from rembg import new_session
        # isnet-general-use preserves product edges/detail far better than u2net
        # (so it doesn't shave bits off the product). Fall back to u2net if the
        # installed rembg can't provide it.
        # Run background removal on the CPU (CPUExecutionProvider). It runs once
        # per generation, after diffusion, so CPU is fast enough — and keeping the
        # heavy birefnet model off the GPU frees ~1-2GB VRAM for SDXL.
        for _model in (os.environ.get("HOLO_REMBG_MODEL", "birefnet-general"), "isnet-general-use", "u2net"):
            try:
                _REMBG_SESSION = new_session(_model, providers=["CPUExecutionProvider"])
                print(f"[ai_logic] Background remover ({_model}) ready (CPU).")
                break
            except Exception as _me:
                print(f"[ai_logic] rembg model '{_model}' unavailable ({_me}); trying next.")
        if _REMBG_SESSION is None:
            raise RuntimeError("no rembg model could be loaded")
    except Exception as e:
        print(f"[ai_logic] Background remover unavailable ({e}); keeping raw backgrounds.")
        _REMBG_DISABLED = True
    return _REMBG_SESSION


def _clean_white_artifacts(image):
    """Remove isolated semi-transparent white blobs left after background removal."""
    import numpy as np
    from PIL import Image
    if image.mode != "RGBA":
        return image
    arr = np.array(image)
    r, g, b, a = arr[:,:,0], arr[:,:,1], arr[:,:,2], arr[:,:,3]
    # Pixels that are near-white AND semi-transparent are artifacts
    is_near_white   = (r > 200) & (g > 200) & (b > 200)
    is_artifact     = is_near_white & (a > 0) & (a < 230)
    arr[is_artifact, 3] = 0
    return Image.fromarray(arr, "RGBA")


def _is_mostly_white(image, threshold=0.95):
    """Return True if more than `threshold` fraction of pixels are near-white."""
    import numpy as np
    arr = np.array(image.convert("RGB"))
    white_pixels = np.all(arr > 240, axis=-1).sum()
    return (white_pixels / (arr.shape[0] * arr.shape[1])) > threshold


def _isolate_on_white(image):
    """Cut out the main product and composite it on a pure white background."""
    try:
        session = _get_rembg_session()
        if session is None:
            return image
        from rembg import remove
        # post_process_mask cleans mask edges without needing pymatting
        cut = remove(image, session=session, bgcolor=(255, 255, 255, 255),
                     alpha_matting=False, post_process_mask=True)
        cut = _clean_white_artifacts(cut)
        result = cut.convert("RGB")
        if _is_mostly_white(result):
            print("[ai_logic] rembg removed too much (mostly white), using original image.")
            return image
        return result
    except Exception as e:
        print(f"[ai_logic] Background isolation failed ({e}); using original image.")
        return image


# ---------------------------------------------------------------------------
# Main generation function
# ---------------------------------------------------------------------------
def generate_ai_design(user_prompt: str, progress_fn=None, seed=None, stop_fn=None, steps: int = None):
    """
    Generate an image with quality gate + retry.
    progress_fn(event_dict) is called on every diffusion step (for SSE).
    stop_fn() is polled each step — if it returns True, generation is aborted immediately.
    """
    # SDXL runs with accelerate's model-cpu-offload, which pages each component onto
    # the GPU as it's needed — no manual device juggling here.

    # Prepend framing guidance so SDXL always shows the full furniture piece,
    # not a zoomed-in detail of part of it.
    full_prompt = f"full view, {user_prompt}"

    best_image = None
    best_score = -1.0
    attempts_log = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        # Notify frontend: new attempt starting
        if progress_fn:
            progress_fn({
                "type":        "attempt_start",
                "attempt":     attempt,
                "max_attempts": MAX_ATTEMPTS,
            })

        # Move CLIP to CPU during generation to free ~400MB VRAM for activations
        clip_model.to("cpu")
        torch.cuda.empty_cache()
        image = _generate_image(full_prompt, attempt, progress_fn, seed=seed, stop_fn=stop_fn, steps=steps)
        # Restore CLIP to GPU for scoring
        clip_model.to(DEVICE)
        score = clip_score(image, user_prompt)
        attempts_log.append({"attempt": attempt, "clip_score": round(score, 4)})

        if score > best_score:
            best_score = score
            best_image = image

        # Notify frontend: attempt done
        if progress_fn:
            progress_fn({
                "type":    "attempt_done",
                "attempt": attempt,
                "score":   round(score, 4),
                "passed":  score >= CLIP_SCORE_THRESHOLD,
            })

        if score >= CLIP_SCORE_THRESHOLD:
            break

    # Isolate the product on a pure white background (set HOLO_WHITE_BG=0 to disable).
    # Send a heartbeat first — background removal (esp. first-time model download) can
    # take minutes, which would trigger the frontend's 5-minute silence timeout.
    if progress_fn:
        progress_fn({"type": "refining"})
    if os.environ.get("HOLO_WHITE_BG", "1").strip().lower() in ("1", "true", "yes", "on"):
        best_image = _isolate_on_white(best_image)

    # URL-safe slug (no spaces) so filenames don't need URL-encoding and stay
    # consistent with the 3D mesh naming.
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", user_prompt or "").strip("_")[:50] or "design"
    # لو في seed (Design Variation) نضيف suffix عشان الملف يكون unique
    seed_suffix = f"_v{seed}" if seed is not None else ""
    filename  = f"{safe_name}{seed_suffix}.png"
    filepath  = OUTPUT_DIR / filename
    best_image.save(filepath)

    passed = best_score >= CLIP_SCORE_THRESHOLD

    result = {
        "message":     f"Generated design for: {user_prompt}",
        "preview_url": f"static/generated_assets/{filename}",
        "status":      "completed",
        "quality": {
            "clip_score": round(best_score, 4),
            "threshold":  CLIP_SCORE_THRESHOLD,
            "passed":     passed,
            "attempts":   attempts_log,
        },
    }

    # Final event
    if progress_fn:
        progress_fn({"type": "done", "result": result})

    return result