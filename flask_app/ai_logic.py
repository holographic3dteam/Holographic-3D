"""
ai_logic.py
FLUX.1 schnell (GGUF quantized) — text-to-image furniture generation.

Replaces SDXL for significantly higher image quality.
Shares text encoders (CLIP-L, T5-XXL), VAE and tokenizers with the
FLUX Kontext edit model to save ~12 GB of disk space.

Model files:
  models/flux-schnell/
    flux1-schnell-Q3_K_S.gguf   <- transformer (GGUF, ~4.6 GB)
  models/flux-kontext/           <- shared components (already present)
    text_encoder/ text_encoder_2/ tokenizer/ tokenizer_2/ vae/

Run download_flux_schnell.bat to fetch the GGUF file (~4.6 GB).
"""

import os

# Reduce CUDA fragmentation on the 8 GB card.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import re
import gc
import torch

# ── Compatibility patch: older transformers doesn't expose tensor ops on
# BaseModelOutputWithPooling, but newer diffusers calls .norm() and / on it.
try:
    from transformers.modeling_outputs import BaseModelOutputWithPooling as _BMOP
    if not hasattr(_BMOP, "norm"):
        def _bmop_norm(self, *a, **k): return self.pooler_output.norm(*a, **k)
        _BMOP.norm = _bmop_norm
    def _bmop_div(self, other): return self.pooler_output / other
    def _bmop_rdiv(self, other): return other / self.pooler_output
    _BMOP.__truediv__  = _bmop_div
    _BMOP.__rtruediv__ = _bmop_rdiv
except Exception:
    pass

from transformers import CLIPModel, CLIPProcessor
from pathlib import Path
from typing import Callable, Optional

BASE_DIR = Path(__file__).resolve().parent

# ── Model paths ──────────────────────────────────────────────────────────
KONTEXT_DIR = BASE_DIR / "models" / "flux-kontext"     # shared encoders + VAE
SCHNELL_DIR = BASE_DIR / "models" / "flux-schnell"     # schnell transformer GGUF
SCHNELL_DIR.mkdir(exist_ok=True, parents=True)

# Auto-pick the best available GGUF quant for the 8 GB card.
_GGUF_CANDIDATES = [
    "flux1-schnell-Q3_K_S.gguf",   # ~4.6 GB — recommended for 8 GB VRAM
    "flux1-schnell-Q4_0.gguf",     # ~5.5 GB
    "flux1-schnell-Q4_K_S.gguf",   # ~5.9 GB — may be tight on 8 GB
]
_env_gguf = os.environ.get("HOLO_GEN_GGUF_FILE")
if _env_gguf:
    GGUF_FILE = SCHNELL_DIR / _env_gguf
else:
    GGUF_FILE = next(
        (SCHNELL_DIR / n for n in _GGUF_CANDIDATES if (SCHNELL_DIR / n).exists()),
        SCHNELL_DIR / _GGUF_CANDIDATES[0],   # default (may not exist yet)
    )

OUTPUT_DIR = BASE_DIR / "static" / "generated_assets"
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# ── Quality gate settings ────────────────────────────────────────────────
CLIP_SCORE_THRESHOLD = 0.20
MAX_ATTEMPTS         = 2
TOTAL_STEPS          = 4   # schnell is distilled for 4 steps

# Generation resolution — multiples of 16.
GEN_RES = int(os.environ.get("HOLO_GEN_RES", "640"))

# ── Module-level state (lazy-loaded) ─────────────────────────────────────
pipe           = None   # FluxPipeline
clip_model     = None
clip_processor = None
_exec_device   = None   # set to torch.device("cuda") on load


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
def _load_models():
    """Load FLUX.1 schnell (GGUF) + CLIP. Called lazily on first generate."""
    global pipe, clip_model, clip_processor, _exec_device

    if not GGUF_FILE.exists():
        raise FileNotFoundError(
            f"FLUX.1 schnell GGUF not found: {GGUF_FILE}\n"
            "Run download_flux_schnell.bat to download it."
        )

    import types as _types
    from diffusers import (
        FluxPipeline,
        FluxTransformer2DModel,
        AutoencoderKL,
        FlowMatchEulerDiscreteScheduler,
    )
    from transformers import (
        CLIPTextModel, CLIPTokenizer,
        T5EncoderModel, T5TokenizerFast,
    )
    from diffusers.quantizers.quantization_config import GGUFQuantizationConfig

    _exec_device = torch.device("cuda")

    # ── Transformer (GGUF) ───────────────────────────────────────────────
    print(f"[ai_logic] Loading FLUX.1 schnell GGUF: {GGUF_FILE.name}")
    transformer = FluxTransformer2DModel.from_single_file(
        str(GGUF_FILE),
        quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
        torch_dtype=torch.bfloat16,
    )

    # ── Text encoders (shared with Kontext) ──────────────────────────────
    print("[ai_logic] Loading CLIP text encoder...")
    text_encoder = CLIPTextModel.from_pretrained(
        str(KONTEXT_DIR / "text_encoder"),
        torch_dtype=torch.bfloat16,
    )
    tokenizer = CLIPTokenizer.from_pretrained(str(KONTEXT_DIR / "tokenizer"))

    gc.collect()
    print("[ai_logic] Loading T5-XXL text encoder (may take a minute)...")
    text_encoder_2 = T5EncoderModel.from_pretrained(
        str(KONTEXT_DIR / "text_encoder_2"),
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
    )
    tokenizer_2 = T5TokenizerFast.from_pretrained(str(KONTEXT_DIR / "tokenizer_2"))

    # ── VAE (shared with Kontext) ────────────────────────────────────────
    print("[ai_logic] Loading VAE...")
    vae = AutoencoderKL.from_pretrained(
        str(KONTEXT_DIR / "vae"),
        torch_dtype=torch.bfloat16,
    )

    # ── Scheduler (schnell uses shift=1.0) ───────────────────────────────
    scheduler = FlowMatchEulerDiscreteScheduler(
        num_train_timesteps=1000,
        shift=1.0,
    )

    # ── Assemble pipeline ────────────────────────────────────────────────
    print("[ai_logic] Assembling FluxPipeline...")
    pipe = FluxPipeline(
        transformer=transformer,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        text_encoder_2=text_encoder_2,
        tokenizer_2=tokenizer_2,
        vae=vae,
        scheduler=scheduler,
    )

    # ── GGUFParameter patches (for accelerate compatibility) ─────────────
    from diffusers.quantizers.gguf.utils import (
        GGUFParameter as _GGUFParam,
        GGML_QUANT_SIZES as _GGML_SIZES,
        _quant_shape_from_byte_shape as _quant_shape,
    )

    def _gguf_new(cls, data, requires_grad=False, quant_type=None):
        if quant_type is None and isinstance(data, _GGUFParam) and data.quant_type is not None:
            quant_type = data.quant_type
        self = torch.Tensor._make_subclass(cls, data, requires_grad)
        self.quant_type = quant_type
        if quant_type is not None:
            block_size, type_size = _GGML_SIZES[quant_type]
            self.quant_shape = _quant_shape(self.shape, type_size, block_size)
        else:
            self.quant_shape = tuple(self.shape)
        return self

    def _gguf_to(self, *args, **kwargs):
        qt = getattr(self, 'quant_type', None)
        qs = getattr(self, 'quant_shape', None)
        result = torch.Tensor.to(self, *args, **kwargs)
        if isinstance(result, _GGUFParam) and (not hasattr(result, 'quant_type') or result.quant_type is None):
            result.quant_type = qt
            result.quant_shape = qs
        return result

    _GGUFParam.__new__ = _gguf_new
    _GGUFParam.to = _gguf_to

    # ── Device placement ─────────────────────────────────────────────────
    # Strategy: only one big model on GPU at a time.
    #   Text encoding : T5 + CLIP on CPU → embeddings moved to GPU
    #   Denoising     : transformer on GPU
    #   VAE decode    : transformer → CPU, VAE → GPU
    # Keeps peak VRAM ≈ max(transformer, VAE+activations) ≈ 4.6 GB.
    pipe.vae.to(_exec_device)            # ~0.4 GB (small, starts resident)

    # Pin _execution_device to CUDA (same fix as edit_logic.py)
    type(pipe)._execution_device = property(
        lambda self: torch.device("cuda", torch.cuda.current_device())
    )

    # Enable VAE tiling for large images (safety net)
    pipe.vae.enable_tiling()

    # ── Transformer CPU↔GPU swap around VAE decode ───────────────────────
    # For text-to-image there's no VAE encode; only decode at the end.
    _orig_vae_decode = pipe.vae.decode
    def _vae_decode_with_swap(latents, **kwargs):
        pipe.transformer.to("cpu")
        pipe.vae.to(_exec_device)
        torch.cuda.empty_cache()
        return _orig_vae_decode(latents, **kwargs)
    pipe.vae.decode = _vae_decode_with_swap

    # Flash attention for long token sequences
    torch.backends.cuda.enable_flash_sdp(True)

    # ── T5/CLIP text encoding on CPU → results to GPU ────────────────────
    _orig_t5 = pipe._get_t5_prompt_embeds.__func__
    def _t5_cpu(self, prompt, num_images_per_prompt=1,
                max_sequence_length=256, device=None, dtype=None):
        emb = _orig_t5(self, prompt, num_images_per_prompt,
                       max_sequence_length,
                       device=torch.device("cpu"), dtype=dtype)
        return emb.to(_exec_device)
    pipe._get_t5_prompt_embeds = _types.MethodType(_t5_cpu, pipe)

    _orig_clip = pipe._get_clip_prompt_embeds.__func__
    def _clip_cpu(self, prompt, num_images_per_prompt=1, device=None):
        emb = _orig_clip(self, prompt, num_images_per_prompt,
                         device=torch.device("cpu"))
        return emb.to(_exec_device)
    pipe._get_clip_prompt_embeds = _types.MethodType(_clip_cpu, pipe)

    # ── CLIP model for quality scoring ───────────────────────────────────
    print("[ai_logic] Loading CLIP model for quality scoring...")
    clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to("cpu")
    if clip_processor is None:
        clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    clip_model.eval()

    print("[ai_logic] FLUX.1 schnell pipeline ready!")


# ---------------------------------------------------------------------------
# Unload / reload
# ---------------------------------------------------------------------------
def unload():
    """Fully free FLUX.1 schnell + CLIP from GPU *and* RAM."""
    global pipe, clip_model
    if pipe is not None:
        try:
            pipe.maybe_free_model_hooks()
        except Exception:
            pass
        for attr in ("transformer", "text_encoder", "text_encoder_2", "vae"):
            try:
                delattr(pipe, attr)
            except Exception:
                pass
    del pipe
    del clip_model
    pipe = None
    clip_model = None
    gc.collect()
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    print("[ai_logic] FLUX.1 schnell + CLIP unloaded (RAM + VRAM freed)")


def _reload_t5_if_needed():
    """Reload T5-XXL if it was freed (moved to meta device) after a previous generation."""
    if pipe is None:
        return
    t5 = getattr(pipe, 'text_encoder_2', None)
    if t5 is None:
        return
    # Check if any parameter is on meta device (= was freed)
    try:
        first_param = next(t5.parameters())
        if first_param.device.type == "meta":
            from transformers import T5EncoderModel
            # Drop the old meta-device model first to free any residual memory
            pipe.text_encoder_2 = None
            gc.collect()
            print("[ai_logic] Reloading T5-XXL text encoder...")
            pipe.text_encoder_2 = T5EncoderModel.from_pretrained(
                str(KONTEXT_DIR / "text_encoder_2"),
                torch_dtype=torch.bfloat16,
                low_cpu_mem_usage=True,
            )
            gc.collect()
            print("[ai_logic] T5-XXL reloaded to CPU")
    except StopIteration:
        pass


def ensure_loaded():
    """Reload FLUX.1 schnell + CLIP if they were unloaded."""
    global pipe
    if pipe is None:
        print("[ai_logic] Reloading FLUX.1 schnell + CLIP...")
        _load_models()
    else:
        _reload_t5_if_needed()


# NOTE: No _load_models() call at import time.  Loading is lazy — triggered
# by the first ensure_loaded() / generate call.  This lets Flask start fast
# and gives a clear FileNotFoundError if the GGUF hasn't been downloaded yet.


# ---------------------------------------------------------------------------
# GPU memory helpers (for Hunyuan handoff)
# ---------------------------------------------------------------------------
def free_gpu_for_hunyuan():
    if DEVICE != "cuda":
        return
    if pipe is not None:
        try:
            pipe.transformer.to("cpu")
        except Exception:
            pass
        try:
            pipe.vae.to("cpu")
        except Exception:
            pass
    if clip_model is not None:
        clip_model.to("cpu")
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.synchronize()
    free_bytes, total_bytes = torch.cuda.mem_get_info()
    print(f"[Hunyuan] VRAM after offload: {free_bytes/1024**3:.2f}GB free / {total_bytes/1024**3:.2f}GB total")


def restore_gpu_after_hunyuan():
    if DEVICE != "cuda" or pipe is None:
        return
    try:
        pipe.vae.to(DEVICE)
        # Transformer stays on CPU — moved to GPU at denoising time
        print(f"[Hunyuan] FLUX.1 schnell VAE restored to {DEVICE}")
    except Exception as e:
        print(f"[Hunyuan] VRAM restore failed ({e}), leaving on CPU.")


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
    actual_total = total_steps or TOTAL_STEPS
    def callback(pipe_obj, step: int, timestep, callback_kwargs):
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
# Image generation
# ---------------------------------------------------------------------------
@torch.no_grad()
def _generate_image(prompt: str, attempt: int, progress_fn=None, seed: int = None,
                    stop_fn=None, steps: int = None):
    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(int(seed))
    actual_steps = steps or TOTAL_STEPS

    # ── Phase 1: Text encoding (T5 + CLIP on CPU) ───────────────────────
    # Encode the prompt FIRST, then free T5-XXL from RAM (~9 GB) before
    # denoising starts. This prevents MemoryError during background
    # removal which also needs significant RAM.
    prompt_embeds, pooled_prompt_embeds, text_ids = pipe.encode_prompt(
        prompt=prompt,
        prompt_2=None,
        max_sequence_length=256,
    )

    # ── Free T5-XXL from RAM ────────────────────────────────────────────
    if hasattr(pipe, 'text_encoder_2') and pipe.text_encoder_2 is not None:
        pipe.text_encoder_2.to("meta")   # moves params to zero-memory meta device
        gc.collect()
        print("[ai_logic] T5-XXL moved to meta device (RAM freed)")

    # ── Phase 2: Denoising (transformer on GPU) ─────────────────────────
    pipe.vae.to("cpu")
    pipe.transformer.to(_exec_device)
    torch.cuda.empty_cache()

    result = pipe(
        prompt_embeds=prompt_embeds,
        pooled_prompt_embeds=pooled_prompt_embeds,
        num_inference_steps=actual_steps,
        guidance_scale=0.0,              # schnell is guidance-free (distilled)
        width=GEN_RES,
        height=GEN_RES,
        generator=generator,
        callback_on_step_end=_make_callback(attempt, progress_fn, stop_fn,
                                            total_steps=actual_steps),
    )
    return result.images[0]


# ---------------------------------------------------------------------------
# Background removal → pure white composite
# ---------------------------------------------------------------------------
_REMBG_SESSION = None
_REMBG_DISABLED = False


def _get_rembg_session():
    global _REMBG_SESSION, _REMBG_DISABLED
    if _REMBG_SESSION is not None or _REMBG_DISABLED:
        return _REMBG_SESSION
    try:
        import sys, types
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
def generate_ai_design(user_prompt: str, progress_fn=None, seed=None,
                       stop_fn=None, steps: int = None):
    """
    Generate an image with quality gate + retry.
    progress_fn(event_dict) is called on every diffusion step (for SSE).
    stop_fn() is polled each step — if it returns True, generation is aborted.
    """
    ensure_loaded()

    # FLUX.1 schnell responds well to detailed prompts. Add framing guidance
    # so the model always produces a clean product shot.
    full_prompt = (
        f"professional product photography, {user_prompt}, "
        "full view, centered, on a clean white background, "
        "high quality, detailed, studio lighting"
    )

    best_image = None
    best_score = -1.0
    attempts_log = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        if progress_fn:
            progress_fn({
                "type":        "attempt_start",
                "attempt":     attempt,
                "max_attempts": MAX_ATTEMPTS,
            })

        # Move CLIP to CPU during generation (it's already on CPU, but be safe)
        if clip_model is not None:
            clip_model.to("cpu")
        torch.cuda.empty_cache()

        image = _generate_image(full_prompt, attempt, progress_fn, seed=seed,
                                stop_fn=stop_fn, steps=steps)

        # CLIP scoring — model stays on CPU, brief move to GPU for scoring
        clip_model.to(DEVICE)
        score = clip_score(image, user_prompt)
        clip_model.to("cpu")
        attempts_log.append({"attempt": attempt, "clip_score": round(score, 4)})

        if score > best_score:
            best_score = score
            best_image = image

        if progress_fn:
            progress_fn({
                "type":    "attempt_done",
                "attempt": attempt,
                "score":   round(score, 4),
                "passed":  score >= CLIP_SCORE_THRESHOLD,
            })

        if score >= CLIP_SCORE_THRESHOLD:
            break

    # ── Post-generation RAM cleanup before background removal ─────────
    # Transformer → CPU, free VRAM so rembg can work without MemoryError
    if pipe is not None:
        try:
            pipe.transformer.to("cpu")
            pipe.vae.to("cpu")
        except Exception:
            pass
    if clip_model is not None:
        clip_model.to("cpu")
    gc.collect()
    torch.cuda.empty_cache()

    # Background removal → white background
    if progress_fn:
        progress_fn({"type": "refining"})
    if os.environ.get("HOLO_WHITE_BG", "1").strip().lower() in ("1", "true", "yes", "on"):
        best_image = _isolate_on_white(best_image)

    # Save
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", user_prompt or "").strip("_")[:50] or "design"
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

    if progress_fn:
        progress_fn({"type": "done", "result": result})

    return result
