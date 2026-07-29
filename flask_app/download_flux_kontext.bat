@echo off
cd /d "%~dp0"

echo ============================================================
echo  Updating required packages...
echo ============================================================
pip install --upgrade diffusers transformers accelerate huggingface-hub gguf
echo.

echo ============================================================
echo  Starting FLUX.1 Kontext download (~17 GB)...
echo ============================================================
python download_flux_kontext.py %*
pause
