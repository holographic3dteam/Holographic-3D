"""
Download FLUX.1 Kontext Dev (GGUF Q4_K_M) + supporting models.

Total download: ~17GB
  [~6.9GB] flux1-kontext-dev-Q4_K_M.gguf  — from bullerwins/FLUX.1-Kontext-dev-GGUF (no token)
  [~9.2GB] text_encoder_2 (T5-XXL)         — from black-forest-labs/FLUX.1-schnell
  [~246MB] text_encoder  (CLIP-L)          — from black-forest-labs/FLUX.1-schnell
  [~335MB] vae                             — from black-forest-labs/FLUX.1-schnell
  [ tiny ] scheduler / tokenizers          — from black-forest-labs/FLUX.1-schnell

If FLUX.1-schnell requires a token:
  1. Go to https://huggingface.co/black-forest-labs/FLUX.1-schnell and accept the license
  2. Go to https://huggingface.co/settings/tokens and create a READ token
  3. Re-run:  python download_flux_kontext.py --token hf_XXXX
"""

import os
import sys
import argparse
from pathlib import Path


def _download_direct(repo_id, dest, prefixes, token=None):
    """
    Download HuggingFace repo files using requests directly.
    Bypasses huggingface_hub's cache (which creates invalid temp filenames on Windows).
    """
    import requests
    from huggingface_hub import list_repo_files

    dest = Path(dest)
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    print("      Fetching file list...", flush=True)
    all_files = list(list_repo_files(repo_id, token=token))

    to_get = [
        f for f in all_files
        if any(f.startswith(p) for p in prefixes)
        and not f.endswith(".bin")           # skip .bin, prefer .safetensors
        and not f.startswith(".")
    ]
    print(f"      {len(to_get)} files to download.", flush=True)

    for filename in to_get:
        dest_file = dest / filename
        if dest_file.exists() and dest_file.stat().st_size > 512:
            print(f"      ✓ {filename}  (exists)", flush=True)
            continue

        dest_file.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"

        r = requests.get(url, headers=headers, stream=True, allow_redirects=True)
        r.raise_for_status()

        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        chunk_size = 8 * 1024 * 1024   # 8 MB

        with open(dest_file, "wb") as fh:
            for chunk in r.iter_content(chunk_size=chunk_size):
                fh.write(chunk)
                downloaded += len(chunk)
                if total > 1_000_000:
                    mb  = downloaded / 1_048_576
                    tmb = total      / 1_048_576
                    pct = downloaded / total * 100
                    print(f"\r      {filename}: {mb:.0f}/{tmb:.0f} MB ({pct:.0f}%)",
                          end="", flush=True)

        if total > 1_000_000:
            print()
        print(f"      ✓ {filename}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN", ""),
                        help="HuggingFace read token (needed if FLUX.1-schnell is gated)")
    args = parser.parse_args()

    try:
        from huggingface_hub import hf_hub_download, snapshot_download, login
    except ImportError:
        print("ERROR: huggingface_hub not installed. Run: pip install huggingface-hub")
        sys.exit(1)

    if args.token:
        login(token=args.token)
        print("Logged in to HuggingFace.\n")

    BASE = Path(__file__).resolve().parent
    DEST = BASE / "models" / "flux-kontext"
    DEST.mkdir(parents=True, exist_ok=True)

    print("=" * 65)
    print("  FLUX.1 Kontext Dev — Download Script")
    print("=" * 65)
    print(f"  Destination : {DEST}")
    print(f"  Total size  : ~17 GB")
    print("=" * 65)
    print()

    # ── 1. GGUF Transformer ──────────────────────────────────────────────
    gguf_path = DEST / "flux1-kontext-dev-Q4_K_M.gguf"
    if gguf_path.exists() and gguf_path.stat().st_size > 1_000_000_000:
        size_gb = gguf_path.stat().st_size / (1024 ** 3)
        print(f"[1/2] GGUF already exists ({size_gb:.1f} GB) — skipping.")
    else:
        print("[1/2] Downloading GGUF transformer (~6.9 GB) ...")
        print("      Repo : bullerwins/FLUX.1-Kontext-dev-GGUF  (no token needed)")
        hf_hub_download(
            repo_id="bullerwins/FLUX.1-Kontext-dev-GGUF",
            filename="flux1-kontext-dev-Q4_K_M.gguf",
            local_dir=str(DEST),
        )
        print("      Done!\n")

    # ── 2. Text encoders / VAE / scheduler from FLUX.1-schnell ──────────
    te2_dir = DEST / "text_encoder_2"
    already_have = te2_dir.exists() and any(te2_dir.glob("*.safetensors"))

    if already_have:
        print("[2/2] Supporting files already present — skipping.")
    else:
        print("[2/2] Downloading text encoders + VAE + scheduler (~10.5 GB) ...")
        print("      Repo : black-forest-labs/FLUX.1-schnell  (Apache-2.0)")
        try:
            _download_direct(
                repo_id="black-forest-labs/FLUX.1-schnell",
                dest=DEST,
                prefixes=["text_encoder/", "text_encoder_2/",
                          "tokenizer/", "tokenizer_2/",
                          "vae/", "scheduler/"],
                token=args.token or None,
            )
            print("\n      Done!\n")
        except Exception as e:
            print(f"\n  ERROR: {e}\n")
            print("  If you see a 401 / 403 / gated-repo error:")
            print("  1. Visit https://huggingface.co/black-forest-labs/FLUX.1-schnell")
            print("     and click 'Agree and access repository'")
            print("  2. Create a token at https://huggingface.co/settings/tokens")
            print("  3. Re-run:  python download_flux_kontext.py --token hf_XXXX")
            sys.exit(1)

    # ── Summary ──────────────────────────────────────────────────────────
    print()
    print("=" * 65)
    print("  Download complete!")
    print()
    print("  Key files:")
    for pattern in ["*.gguf", "text_encoder_2/*.safetensors", "vae/*.safetensors"]:
        for f in sorted(DEST.glob(pattern)):
            size_mb = f.stat().st_size / (1024 ** 2)
            label = f"{size_mb/1024:.1f} GB" if size_mb > 1024 else f"{size_mb:.0f} MB"
            print(f"    {f.relative_to(DEST)}  ({label})")
    print()
    print("  Next step: restart the Flask app — edit will now use FLUX Kontext.")
    print("=" * 65)


if __name__ == "__main__":
    main()
