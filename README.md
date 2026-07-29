# Holo3D — Wood Factory Design System

AI furniture design studio: configure a chair / sofa / table, generate a product
image (SDXL + a fine-tuned furniture LoRA), turn it into a textured 3D model
(Hunyuan3D-2), and view it in AR.

- **Frontend:** React + Vite + TypeScript (`holographic-frontend/`), runs on port **5173**
- **Backend:** Flask (`flask_app/`), runs on port **5000**, MySQL database
- The Vite dev server proxies `/api` and `/static` to the Flask backend.

---

## Prerequisites

- **Python 3.11**
- **Node.js 18+**
- **MySQL** (a database named `wood_factory`)
- **NVIDIA GPU with ~8 GB VRAM + CUDA** (needed for image and 3D generation)
- The **Hunyuan3D-2** library (`hy3dgen`) installed/available on the machine
  (the 3D step imports it and downloads its model weights from Hugging Face on
  first run).

---

## Get the code

```bash
git clone https://github.com/yassen-ahmed-bakry/Holographic-3D.git
cd Holographic-3D
```

---

## Model files (shared separately — not in this repo)

These are too large for GitHub and are intentionally git-ignored. The project
owner will share **two items** (e.g. via Google Drive):

1. the file `furniture_lora.safetensors`
2. the folder `vae` (it contains `config.json` and `diffusion_pytorch_model.safetensors`)

Put **both** inside `flask_app/models/` so the final structure looks **exactly** like this:

```
flask_app/
└─ models/
   ├─ furniture_lora.safetensors
   └─ vae/
      ├─ config.json
      └─ diffusion_pytorch_model.safetensors
```

That's it — the app looks for the LoRA at `flask_app/models/furniture_lora.safetensors`
and the VAE at `flask_app/models/vae/`.

The Hunyuan3D shape/paint models (used for the 3D step) download automatically
from Hugging Face the first time you generate a 3D model — you don't need to copy those.

---

## Backend setup

```bash
cd flask_app

# 1. Create + activate a virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

# 2. Install dependencies
pip install -r requirements.txt
#   NOTE: install a CUDA build of torch that matches your GPU, e.g.:
#   pip install torch --index-url https://download.pytorch.org/whl/cu121

# 3. Configure environment
copy .env.example .env          # Windows  (cp on macOS/Linux)
#   then edit .env with your DB password, admin account, and Resend API key

# 4. Create the MySQL database
#   CREATE DATABASE wood_factory;   (tables are created automatically on first run)

# 5. Run
python app.py                   # serves on http://0.0.0.0:5000
```

> **Install PyTorch FIRST** (before `requirements.txt`) using the CUDA build that
> matches your GPU — see the note at the top of `requirements.txt`.

## Frontend setup

```bash
cd holographic-frontend
npm install
npm run dev                     # serves on https://<your-ip>:5173
```

Open the printed URL. The dev server uses a self-signed certificate, so accept
the browser security warning (Advanced → Proceed). AR on phones requires HTTPS,
which is why the self-signed cert is used.

**First login:** use the `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set in `flask_app/.env`
(an admin account is created automatically on the backend's first run). You can
register more users from the login page.

---

## 3D engine — Hunyuan3D-2 (hy3dgen)  ← needed only for the 3D / AR step

The web app and 2D image generation work without this. The **3D model
generation** step needs the **Hunyuan3D-2** library (`hy3dgen`), which also
compiles a small CUDA texture rasterizer. This is the trickiest part of setup.

**Requirements:** the NVIDIA **CUDA Toolkit** (matching your PyTorch CUDA version)
and a **C++ build toolchain** (on Windows: "Visual Studio Build Tools" with the
C++ workload).

Two ways to get it:

- **Easiest — use the owner's copy.** Ask the owner to share their working
  `Hunyuan3D-2` folder (zip it from Drive). Then:
  ```bash
  cd Hunyuan3D-2
  pip install -e .
  ```
- **Or install fresh from source:**
  ```bash
  git clone https://github.com/Tencent/Hunyuan3D-2
  cd Hunyuan3D-2
  pip install -r requirements.txt
  pip install -e .
  # build the texture rasterizer used for painting:
  cd hy3dgen/texgen/custom_rasterizer
  python setup.py install
  ```

> Don't have a working CUDA/C++ build setup? You can still use everything except
> 3D generation, or set `HUNYUAN_SKIP_TEXTURE=1` to get an untextured 3D mesh once
> the library is installed. The Hunyuan model weights download automatically on
> the first 3D run.

---

## The `.bat` launcher scripts — edit the paths first!

The repo includes `start.bat`, `start_backend.bat`, and `start_frontend.bat` as
convenience launchers. **They contain hardcoded paths from the original author's
PC, so they will NOT work as-is on your machine.** Before using them, open each
`.bat` file in a text editor (Notepad is fine) and change two things:

1. **The project path** — replace every `D:\Projects\Holographic 3D` with the
   folder where you cloned this repo (e.g. `C:\Users\you\Holographic-3D`).
2. **The Python path** — replace
   `C:\Users\rog\AppData\Local\Programs\Python\Python311\python.exe` with the path
   to your own Python 3.11 (or just `python` if it's on your PATH and points to
   the right install).

Save, then double-click `start.bat` to launch both servers.

**Prefer not to edit them?** Just ignore the scripts and run the commands from the
setup sections above manually: `python app.py` (backend) and `npm run dev` (frontend).

---

## Environment variables

See `flask_app/.env.example`. Key ones:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MySQL connection string |
| `SECRET_KEY` | Flask session signing key (auto-generated if unset) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | Seed admin account (first run) |
| `RESEND_API_KEY` / `RESEND_FROM` | Password-reset emails (one-time owner setup) |
| `HUNYUAN_TEXTURE_SIZE` | 3D texture resolution (default 1024; lower = faster) |
| `HUNYUAN_MAX_FACES` | Mesh face cap before texturing (default 40000) |
| `HUNYUAN_SKIP_TEXTURE` | `1` to skip texturing and return geometry-only |
| `HOLO_WHITE_BG` | `1` to isolate generated products on a white background |

---

## Notes

- First 3D generation downloads several GB of Hunyuan3D weights — it's slow only once.
- 3D texturing is tuned for 8 GB GPUs (loads on CPU, streams to GPU, 1024 textures).
