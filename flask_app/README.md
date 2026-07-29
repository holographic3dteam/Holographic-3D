# Holographic 3D — Wood Factory

توليد تصاميم أثاث بالذكاء الاصطناعي من وصف نصّي، تعديلها بالكلام، تحويلها لموديل ثلاثي
الأبعاد ملوّن، وتجهيزها للتصنيع (CNC / طباعة 3D)، مع مطابقة مع مخزون الشركة (Factory Match)
وعرض بتقنية الـ AR.

> المشروع بيشتغل **local** على جهاز فيه كارت NVIDIA (مختبَر على RTX 5060 Laptop، 8GB VRAM).
> الموديلات مش في الريبو (GitHub بيرفض الملفات الكبيرة). معظمها موديلات عامة بتتنزّل من
> مصادرها، وموديل واحد بس مخصّص (الـ LoRA) بييجي من Drive — التفاصيل في خطوة الموديلات تحت.

---

## المكوّنات

| الجزء | التقنية |
|------|---------|
| Backend | Python 3.11 + Flask + SQLAlchemy (MySQL) |
| Frontend | React + TypeScript + Vite (فولدر `holographic-frontend`) |
| توليد 2D | SDXL + LoRA مخصّص (`furniture_lora.safetensors`) |
| تعديل بالكلام | FLUX.1 Kontext Dev (GGUF) |
| توليد 3D | Hunyuan3D-2mini (شكل) + hunyuan3d-paint (تلوين) — بيشتغل في venv منفصل |
| مطابقة المخزون | sentence-transformers (`all-MiniLM-L6-v2`) |

---

## المتطلبات

- **Python 3.11** (الموديلات مختبرة عليه)
- **NVIDIA GPU** بـ 8GB VRAM على الأقل + درايفر CUDA 12.8
- **MySQL** (أو MariaDB)
- **Node.js 18+** (للفرونت)
- مساحة قرص ~35GB (للموديلات)

---

## خطوات التشغيل (Backend)

### 0) تنزيل المشروع
```bash
git clone https://github.com/holographic3dteam/Holographic-3D.git
cd "Holographic 3D"
```
الريبو فيه فولدرين: `flask_app` (الـ backend) و `holographic-frontend` (الواجهة).

### 1) البيئة و PyTorch
```bash
cd flask_app
python -m venv venv
venv\Scripts\activate            # Windows

# PyTorch أولاً بنسخة الكارت (CUDA 12.8):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

# باقي المكتبات:
pip install -r requirements.txt
```

### 2) الموديلات
الموديلات بتتقسم ٣ أنواع: **من Drive** (المخصّص بتاعنا)، **بتتنزّل لوحدها** أول تشغيل، و**تنزّلها يدوي**.
الهيكل النهائي المطلوب جوه `flask_app/models/`:
```
models/
 ├─ furniture_lora.safetensors     ← من Drive (الـ LoRA المخصّص)
 ├─ vae/                           ← من Drive (أو HuggingFace)
 └─ flux-kontext/                  ← تنزّله يدوي من HuggingFace
      ├─ flux1-kontext-dev-Q3_K_S.gguf
      ├─ text_encoder/  text_encoder_2/
      ├─ tokenizer/  tokenizer_2/
      ├─ vae/  scheduler/
```

**(أ) من Google Drive** — فيه `furniture_lora.safetensors` (الموديل المخصّص) + فولدر `vae/`.
نزّلهم وحطهم في `models/`:
- 🔗 https://drive.google.com/drive/folders/1xUHLw1KYKzCfMOpXtf6PmA7deE_mOgNP?usp=sharing

**(ب) بتتنزّل تلقائياً أول تشغيل** (مفيش أي مجهود — بتتحفظ في كاش HuggingFace):
- SDXL base → [`stabilityai/stable-diffusion-xl-base-1.0`](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)
- CLIP (تقييم الجودة) → [`openai/clip-vit-base-patch32`](https://huggingface.co/openai/clip-vit-base-patch32)
- الـ embedding (المطابقة) → [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- إزالة الخلفية → موديل `birefnet-general` (بتاع rembg)
- موديلات الـ 3D → [`tencent/Hunyuan3D-2mini`](https://huggingface.co/tencent/Hunyuan3D-2mini) و [`tencent/Hunyuan3D-2`](https://huggingface.co/tencent/Hunyuan3D-2)

**(ج) تنزّلها يدوي — ملفات `flux-kontext`** (لميزة التعديل بالكلام):
- الـ transformer (بدون توكن): من [`bullerwins/FLUX.1-Kontext-dev-GGUF`](https://huggingface.co/bullerwins/FLUX.1-Kontext-dev-GGUF) — نزّل ملف **`flux1-kontext-dev-Q3_K_S.gguf`** (الأنسب لـ 8GB) وحطه في `models/flux-kontext/`.
- الـ encoders + vae + tokenizers + scheduler (محتاج توكن HuggingFace مجاني): من [`black-forest-labs/FLUX.1-schnell`](https://huggingface.co/black-forest-labs/FLUX.1-schnell) — اقبل الترخيص، اعمل توكن READ من https://huggingface.co/settings/tokens، وبعدين:
  ```bash
  python download_flux_kontext.py --token hf_XXXX
  ```
  (السكربت بينزّل الـ encoders/vae/tokenizers صح؛ الـ GGUF نزّله يدوي زي فوق لو عايز نسخة Q3_K_S الأسرع.)

### 3) خطوة الـ 3D (venv منفصل + مكتبة Hunyuan)
مرحلة التلوين محتاجة `diffusers==0.32.1` (نسخة أقدم من اللي بيستخدمها التطبيق الأساسي)،
عشان كده بتشتغل في **venv منفصل** اسمه `hunyuan_venv` جوه `flask_app/`:
```bash
# نزّل مكتبة Hunyuan3D-2 من المصدر:
#   https://github.com/Tencent/Hunyuan3D-2
git clone https://github.com/Tencent/Hunyuan3D-2

python -m venv hunyuan_venv --system-site-packages
hunyuan_venv\Scripts\activate
pip install diffusers==0.32.1
# ثبّت المكتبة (hy3dgen) + الـ rasterizer المستخدم في التلوين:
cd Hunyuan3D-2
pip install -r requirements.txt
pip install -e .
cd ..
deactivate
```
> موديلات Hunyuan نفسها (`Hunyuan3D-2mini` / `Hunyuan3D-2`) بتتنزّل تلقائياً أول مرة تعمل 3D.

### 4) قاعدة البيانات
```sql
CREATE DATABASE wood_factory CHARACTER SET utf8mb4;
```
الاتصال + الأدمن الأول بيتقروا من `.env` (موجود في الريبو). التطبيق بيعمل الجداول
والأدمن تلقائياً أول تشغيل.

### 5) إعدادات الكارت (مهم لـ 8GB VRAM)
- **NVIDIA Control Panel → Manage 3D Settings → Program Settings → أضف `python.exe` →
  CUDA - Sysmem Fallback Policy → Prefer No Sysmem Fallback.**
  (بيمنع الكارت من السكب البطيء على الرام.)
- زوّد **الـ page file** لـ 20–40GB (مرحلة تلوين الـ 3D بتضغط على الرام).

### 6) التشغيل
```bash
python app.py            # Flask على http://localhost:5000
```
أو استخدم `start.bat` اللي بيشغّل Flask + Vite + ngrok مع بعض.

---

## الفرونت-إند
```bash
cd holographic-frontend
npm install
npm run dev              # على https://localhost:5173
```
الفرونت بيوصل للـ backend بمسارات نسبية (`/api/...`).

---

## ملاحظات أداء (8GB VRAM)
- SDXL بيشتغل بوضع `enable_model_cpu_offload()` — بيحطّ الجزء الشغّال بس على الكارت،
  فبيسع جوه الـ 8GB ويشتغل بسرعة الكارت.
- FLUX Kontext بيعمل تبديل يدوي للموديلات بين CPU/GPU حسب المرحلة (encode / denoise / decode).
- الـ TensorFlow متعطّل (`USE_TF=0`) عشان مايحجزش VRAM على الفاضي.

---

## الأمان
- الجلسات موقّعة، فيه rate-limiting على الدخول/التسجيل/إعادة التعيين، ورفع الملفات
  متحقّق منه (نوع + محتوى فعلي)، وكل يوزر بيوصل لتصاميمه هو بس.
- `.env` فيه إعدادات الاتصال. الريبو Private؛ لو اتحوّل Public في أي وقت غيّر
  بيانات الاتصال والمفاتيح.
