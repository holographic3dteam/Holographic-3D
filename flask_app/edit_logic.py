"""
edit_logic.py
FLUX.1 Kontext Dev (GGUF Q4_K_M) — instruction-based furniture image editing.

No fine-tuning required. Prompt examples:
  "change the sofa color to black"
  "change the back from curved to straight, keep the color"
  "make it beige leather, keep the shape and white background"

Model files live in:  models/flux-kontext/
  flux1-kontext-dev-Q4_K_M.gguf   <- transformer (GGUF, ~6.9GB)
  text_encoder/                    <- CLIP-L
  text_encoder_2/                  <- T5-XXL
  tokenizer/ tokenizer_2/
  vae/
  scheduler/

Run download_flux_kontext.bat first to fetch all files (~17 GB).
"""

import os

# Reduce CUDA fragmentation on the 8 GB card (the OOM message recommends this).
# Must be set before torch initialises the CUDA allocator, so it lives here at
# the very top before `import torch`.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import re
import gc
import time
import torch
from pathlib import Path
from PIL import Image

BASE_DIR   = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "static" / "generated_assets"
OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

MODEL_DIR = BASE_DIR / "models" / "flux-kontext"

# Q4_K_M (6.9 GB) doesn't fit an 8 GB card once you add activations → it spills
# to system RAM and crawls (~3.5 min/step). A smaller quant fits fully in VRAM
# and runs at real GPU speed. Auto-pick the smallest available, in order.
# Override with HOLO_GGUF_FILE=<filename> if you want a specific one.
_GGUF_CANDIDATES = [
    "flux1-kontext-dev-Q3_K_S.gguf",   # ~5.2 GB — recommended for 8 GB VRAM
    "flux1-kontext-dev-Q2_K.gguf",     # ~4.0 GB — smaller fallback, lower quality
    "flux1-kontext-dev-Q4_K_M.gguf",   # ~6.9 GB — last resort (spills → slow)
]
_env_gguf = os.environ.get("HOLO_GGUF_FILE")
if _env_gguf:
    GGUF_FILE = MODEL_DIR / _env_gguf
else:
    GGUF_FILE = next(
        (MODEL_DIR / n for n in _GGUF_CANDIDATES if (MODEL_DIR / n).exists()),
        MODEL_DIR / _GGUF_CANDIDATES[0],
    )

# Tunable via environment
EDIT_STEPS    = int(os.environ.get("HOLO_EDIT_STEPS",    "28"))
EDIT_GUIDANCE = float(os.environ.get("HOLO_EDIT_GUIDANCE", "2.5"))
# Working resolution (longest side). FLUX needs multiples of 16.
# 1024 is too big for 8 GB (Kontext concat → 8192 tokens → ~14 GB).
# 704 (= 16×44) → ~3872 tokens. Drop to 640/576/512 if OOM persists.
EDIT_RES      = int(os.environ.get("HOLO_EDIT_RES", "640"))

_pipe = None   # lazy-loaded, stays loaded until unload_pipe() is called


def _get_pipe():
    global _pipe
    if _pipe is not None:
        return _pipe

    if not GGUF_FILE.exists():
        raise FileNotFoundError(
            f"GGUF not found: {GGUF_FILE}\n"
            "Run download_flux_kontext.bat to download the model files."
        )

    from diffusers import (
        FluxKontextPipeline,
        FluxTransformer2DModel,
        AutoencoderKL,
        FlowMatchEulerDiscreteScheduler,
    )
    from transformers import (
        CLIPTextModel, CLIPTokenizer,
        T5EncoderModel, T5TokenizerFast,
    )

    # ── Transformer (GGUF Q4_K_M) ────────────────────────────────────────
    # GGUFQuantizationConfig enables the GGUF-aware loading path:
    #   - replaces Linear → GGUFLinear (handles Q4_K_M + BF16 byte tensors)
    #   - shape checks use _quant_shape_from_byte_shape (byte shape → float shape)
    from diffusers.quantizers.quantization_config import GGUFQuantizationConfig

    print(f"[edit_logic] Loading GGUF transformer: {GGUF_FILE.name}")
    transformer = FluxTransformer2DModel.from_single_file(
        str(GGUF_FILE),
        quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
        torch_dtype=torch.bfloat16,
        in_channels=64,  # FLUX Kontext uses sequence-concat → in_channels=64 (same as FLUX Dev)
                         # BF16 byte shapes cause wrong detection (128 instead of 64)
    )

    # ── CLIP text encoder ─────────────────────────────────────────────────
    print("[edit_logic] Loading CLIP text encoder...")
    text_encoder = CLIPTextModel.from_pretrained(
        str(MODEL_DIR / "text_encoder"),
        torch_dtype=torch.bfloat16,
    )
    tokenizer = CLIPTokenizer.from_pretrained(str(MODEL_DIR / "tokenizer"))

    # ── T5-XXL text encoder ───────────────────────────────────────────────
    print("[edit_logic] Loading T5-XXL text encoder (this may take a minute)...")
    text_encoder_2 = T5EncoderModel.from_pretrained(
        str(MODEL_DIR / "text_encoder_2"),
        torch_dtype=torch.bfloat16,
    )
    tokenizer_2 = T5TokenizerFast.from_pretrained(str(MODEL_DIR / "tokenizer_2"))

    # ── VAE ───────────────────────────────────────────────────────────────
    print("[edit_logic] Loading VAE...")
    vae = AutoencoderKL.from_pretrained(
        str(MODEL_DIR / "vae"),
        torch_dtype=torch.bfloat16,
    )

    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(
        str(MODEL_DIR / "scheduler"),
    )

    # ── Assemble pipeline ─────────────────────────────────────────────────
    print("[edit_logic] Assembling FluxKontextPipeline...")
    pipe = FluxKontextPipeline(
        transformer=transformer,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        text_encoder_2=text_encoder_2,
        tokenizer_2=tokenizer_2,
        vae=vae,
        scheduler=scheduler,
    )

    # ── Patch GGUFParameter for accelerate compatibility ──────────────────
    # enable_sequential_cpu_offload() calls GGUFParameter(tensor) without
    # quant_type → KeyError: None.  Fix:
    #   __new__: handle quant_type=None (meta tensors) + inherit from GGUFParam data
    #   to():    preserve quant_type across CPU↔GPU moves
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
    # ─────────────────────────────────────────────────────────────────────

    # ── Manual device placement for 8 GB VRAM ────────────────────────────
    # T5 (text_encoder_2) is ~9.4 GB BF16 — too large for an 8 GB GPU.
    # Transformer (GGUF Q4_K_M ~6.9 GB) + VAE (~0.4 GB) fit together in 8 GB.
    # T5 and CLIP encode on CPU; their output embeddings are moved to CUDA
    # before the transformer sees them, so the full denoising loop runs on GPU.
    import types as _types

    _exec_device = torch.device("cuda")
    # NOTE: transformer stays on CPU here. It is moved to GPU only during the
    # denoising loop (via the VAE-encode swap's restore step) and back to CPU
    # before VAE decode. This keeps idle GPU usage at ~0.4 GB (VAE only) instead
    # of a permanent 6.9 GB, and gives each stage the full card to itself.
    pipe.vae.to(_exec_device)           # ~0.4 GB on GPU (small, stays resident)

    # Pin _execution_device to CUDA on the class level.
    # In some diffusers versions _execution_device iterates self.components
    # (backed by a set) in arbitrary order and may return "cpu"; in others it
    # just returns self.device (which is CPU since we never called pipe.to()).
    # Patching the property on the class is the only version-safe fix.
    # This is permanent for this Python process, which is fine — Flask restarts
    # create a fresh process, and we only ever create one pipeline instance.
    type(pipe)._execution_device = property(
        lambda self: torch.device("cuda", torch.cuda.current_device())
    )

    # Enable VAE tiling — mandatory for 1024×1024 on 8 GB.
    # The pipeline auto-resizes any square image to 1024×1024 via _auto_resize.
    # Without tiling, the VAE encoder/decoder intermediate activations alone
    # can exceed 2 GB on top of the 6.9 GB transformer, causing an OOM.
    pipe.vae.enable_tiling()

    # ── Transformer CPU↔GPU swap around VAE encode/decode ─────────────────
    # Transformer (6.9 GB) + VAE (0.4 GB) = 7.3 GB on GPU.
    # VAE 1024×1024 intermediate activations (~256 MB+) push over the 7.96 GB limit.
    # Fix: move transformer to CPU before VAE encode/decode, restore for denoising.
    # Each swap adds ~0.5 s over PCIe; 28 denoising steps still run fully on GPU.
    # Stage-based GPU ownership. Only one big model on the card at a time:
    #   VAE encode  : VAE on GPU, transformer on CPU
    #   Denoise loop: transformer on GPU, VAE on CPU
    #   VAE decode  : VAE on GPU, transformer on CPU
    # T5/CLIP always on CPU (patched below). Idle = ~0.4 GB (whatever ran last).
    _orig_encode_vae = pipe._encode_vae_image.__func__
    def _encode_vae_with_swap(self, image, generator):
        self.transformer.to("cpu")
        self.vae.to(_exec_device)
        torch.cuda.empty_cache()
        try:
            result = _orig_encode_vae(self, image, generator)
        finally:
            # Hand the card to the transformer for the denoising loop.
            self.vae.to("cpu")
            self.transformer.to(_exec_device)
            torch.cuda.empty_cache()
        return result
    pipe._encode_vae_image = _types.MethodType(_encode_vae_with_swap, pipe)

    _orig_vae_decode = pipe.vae.decode
    def _vae_decode_with_swap(latents, **kwargs):
        # Denoising is done — free the transformer, give the card to the VAE.
        pipe.transformer.to("cpu")
        pipe.vae.to(_exec_device)
        torch.cuda.empty_cache()
        return _orig_vae_decode(latents, **kwargs)
    pipe.vae.decode = _vae_decode_with_swap
    # ─────────────────────────────────────────────────────────────────────

    # Ensure flash attention is used for the 8192-token sequences in Kontext.
    # At 1024×1024 the transformer sees 2×4096 = 8192 tokens (latent + image).
    # Standard attention: 8192² × 24 heads × 2 bytes ≈ 3.2 GB → OOM.
    # Flash attention: O(n×d) ≈ ~100 MB → fine.
    # PyTorch ≥ 2.0 selects flash automatically, but we force it to be safe.
    torch.backends.cuda.enable_flash_sdp(True)

    # Patch T5: compute on CPU → move result to CUDA
    _orig_t5 = pipe._get_t5_prompt_embeds.__func__
    def _t5_cpu(self, prompt, num_images_per_prompt=1,
                max_sequence_length=512, device=None, dtype=None):
        emb = _orig_t5(self, prompt, num_images_per_prompt,
                       max_sequence_length,
                       device=torch.device("cpu"), dtype=dtype)
        return emb.to(_exec_device)
    pipe._get_t5_prompt_embeds = _types.MethodType(_t5_cpu, pipe)

    # Patch CLIP: compute on CPU → move result to CUDA
    _orig_clip = pipe._get_clip_prompt_embeds.__func__
    def _clip_cpu(self, prompt, num_images_per_prompt=1, device=None):
        emb = _orig_clip(self, prompt, num_images_per_prompt,
                         device=torch.device("cpu"))
        return emb.to(_exec_device)
    pipe._get_clip_prompt_embeds = _types.MethodType(_clip_cpu, pipe)
    # ─────────────────────────────────────────────────────────────────────

    _pipe = pipe
    print("[edit_logic] FLUX.1 Kontext pipeline ready.")
    return _pipe


def unload_pipe():
    """Free VRAM and RAM before loading the generation pipeline."""
    global _pipe
    if _pipe is not None:
        del _pipe
        _pipe = None
        gc.collect()
        torch.cuda.empty_cache()
        print("[edit_logic] FLUX.1 Kontext pipeline unloaded.")


def edit_design(
    image_path: str,
    edit_prompt: str,
    output_name: str | None = None,
    steps: int | None = None,
    guidance_scale: float | None = None,
    progress_cb=None,   # callable(step:int, total:int) — for async job progress
    # Legacy params kept for API compat (not used by FLUX Kontext):
    image_guidance_scale: float | None = None,
    strength: float | None = None,
    controlnet_scale: float | None = None,
) -> dict:
    """
    Edit a furniture image using FLUX.1 Kontext Dev.

    edit_prompt examples:
      "change the color to black, keep the shape and white background"
      "change the back style to straight, keep the beige color"
    """
    _steps = steps or EDIT_STEPS
    _gs    = guidance_scale if guidance_scale is not None else EDIT_GUIDANCE

    full_path = BASE_DIR / image_path
    if not full_path.exists():
        raise FileNotFoundError(f"Source image not found: {full_path}")

    source = Image.open(full_path).convert("RGB")

    # Force a small working resolution: 1024 is too big for 8 GB (see EDIT_RES).
    # Preserve aspect ratio, longest side = EDIT_RES, round both to multiples of 16.
    w0, h0 = source.size
    scale = EDIT_RES / max(w0, h0)
    tw = max(16, round(w0 * scale / 16) * 16)
    th = max(16, round(h0 * scale / 16) * 16)
    source = source.resize((tw, th), Image.LANCZOS)

    print(f"[edit_logic] Editing: {edit_prompt[:150]}")
    print(f"[edit_logic] steps={_steps}, guidance={_gs}, size={source.size}")

    pipe = _get_pipe()

    with torch.inference_mode():
        # _auto_resize=False → keep our small size; otherwise the pipeline snaps
        # the image back up to ~1024² (its PREFERRED_KONTEXT_RESOLUTIONS list).
        def _step_cb(pipe_self, step, timestep, cb_kwargs):
            if progress_cb is not None:
                try:
                    progress_cb(step + 1, _steps)   # step is 0-indexed
                except Exception:
                    pass
            return cb_kwargs

        result = pipe(
            prompt=edit_prompt,
            image=source,
            height=th,
            width=tw,
            max_area=tw * th,        # THIS is what actually sets generation size.
                                     # height/width are only used for aspect ratio;
                                     # the pipeline recomputes them from max_area.
            num_inference_steps=_steps,
            guidance_scale=_gs,
            _auto_resize=False,      # keep our small image; don't snap it back to ~1MP
            callback_on_step_end=_step_cb,
        )
    edited = result.images[0]

    base     = output_name or edit_prompt or "edit"
    safe     = re.sub(r"[^a-zA-Z0-9_-]+", "_", base).strip("_")[:40] or "edit"
    filename = f"{safe}_edit_{int(time.time())}.png"
    filepath = OUTPUT_DIR / filename
    edited.save(filepath)
    print(f"[edit_logic] Saved: {filepath}")

    return {
        "message":     f"Edited: {edit_prompt[:80]}",
        "preview_url": f"static/generated_assets/{filename}",
        "status":      "completed",
    }
