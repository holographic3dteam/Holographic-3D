import os
from datetime import timedelta

_ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


def _load_env_file(path):
    """Minimal .env loader used as a fallback when python-dotenv isn't installed.
    Without this, a missing python-dotenv would silently ignore the whole .env
    file (so things like RESEND_API_KEY appear 'missing' even though they're set)."""
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                # Don't override variables already set in the real environment.
                if key and key not in os.environ:
                    os.environ[key] = val
    except OSError:
        pass


# Load .env. Prefer python-dotenv; fall back to the simple parser above so the
# app works even when python-dotenv isn't installed.
try:
    from dotenv import load_dotenv
    load_dotenv(_ENV_PATH)
    # Belt-and-suspenders: catch anything dotenv skipped.
    _load_env_file(_ENV_PATH)
except ImportError:
    _load_env_file(_ENV_PATH)

def _resolve_secret_key():
    """Use SECRET_KEY from the environment if set; otherwise generate a random
    key once and persist it to a local file so sessions survive restarts.
    This avoids shipping a publicly-known default key (which would let anyone
    forge a signed session cookie, including an admin one)."""
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    secret_path = os.path.join(os.path.dirname(__file__), ".flask_secret")
    try:
        if os.path.exists(secret_path):
            with open(secret_path, "r", encoding="utf-8") as fh:
                existing = fh.read().strip()
                if existing:
                    return existing
        import secrets
        new_key = secrets.token_hex(32)
        with open(secret_path, "w", encoding="utf-8") as fh:
            fh.write(new_key)
        return new_key
    except OSError:
        # Filesystem not writable — fall back to a per-process random key.
        # Sessions won't survive a restart, but the key is never public.
        import secrets
        return secrets.token_hex(32)


class Config:
    # Secret key for Flask sessions (signed cookies)
    SECRET_KEY = _resolve_secret_key()

    # Keep sessions alive for 7 days (survives tab/browser close)
    SESSION_PERMANENT = True
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)

    # 1. إعدادات قاعدة البيانات — credentials loaded from .env (never hard-coded)
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL")
    if not SQLALCHEMY_DATABASE_URI:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env and fill in your "
            "database connection string before starting the app."
        )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # 2. تحديد المسارات الأساسية
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))
    
    # مسار فولدر الاستاتيك الكلي
    STATIC_FOLDER = os.path.join(BASE_DIR, 'static')
    
    # مسارات الفولدرات الحقيقية (للحفظ الفعلي على الهارد)
    FACTORY_FOLDER = os.path.join(STATIC_FOLDER, 'factory_assets')
    GENERATED_FOLDER = os.path.join(STATIC_FOLDER, 'generated_assets')

    # 3. دالة إنشاء الفولدرات
    @staticmethod
    def init_folders():
        folders = [Config.STATIC_FOLDER, Config.FACTORY_FOLDER, Config.GENERATED_FOLDER]
        for folder in folders:
            if not os.path.exists(folder):
                os.makedirs(folder)
                print(f"✅ تم إنشاء المجلد: {folder}")