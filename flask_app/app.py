"""
app.py
Application factory — creates the Flask app, registers blueprints,
seeds the database. All route logic lives in routes/*.
"""

import os
import sys

# Stop `transformers` from importing TensorFlow. Must be set BEFORE any
# import that pulls transformers (search_logic, ai_logic).
os.environ["USE_TF"] = "0"
os.environ["TRANSFORMERS_NO_TF"] = "1"

import mimetypes
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/stl", ".stl")
mimetypes.add_type("model/obj", ".obj")

from flask import Flask
from flask_cors import CORS
from werkzeug.security import generate_password_hash

from config import Config
from models import db, User


def create_app() -> Flask:
    app = Flask(__name__)

    CORS(app, supports_credentials=True, origins=[
        "http://localhost:5173",
        "https://localhost:5173",
        r"https://.*\.ngrok-free\.app",
        r"https://.*\.ngrok\.io",
    ])

    app.config.from_object(Config)
    app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10 MB upload limit

    Config.init_folders()
    db.init_app(app)

    # ── Register blueprints ───────────────────────────────────────────────
    from routes.auth import auth_bp
    from routes.generation import generation_bp
    from routes.designs import designs_bp
    from routes.factory import factory_bp
    from routes.manufacturing import manufacturing_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(generation_bp)
    app.register_blueprint(designs_bp)
    app.register_blueprint(factory_bp)
    app.register_blueprint(manufacturing_bp)

    # ── Database init + migration + admin seed ────────────────────────────
    with app.app_context():
        db.create_all()

        # Lightweight auto-migration: add user_id to generated_designs if missing
        try:
            from sqlalchemy import inspect as _sa_inspect, text as _sa_text
            _insp = _sa_inspect(db.engine)
            if "generated_designs" in _insp.get_table_names():
                _cols = {c["name"] for c in _insp.get_columns("generated_designs")}
                if "user_id" not in _cols:
                    print("[migrate] Adding missing column generated_designs.user_id ...")
                    db.session.execute(_sa_text(
                        "ALTER TABLE generated_designs ADD COLUMN user_id INT NULL"
                    ))
                    db.session.commit()
                    print("[migrate] generated_designs.user_id added.")
        except Exception as _me:
            db.session.rollback()
            print(f"[migrate] user_id migration skipped: {_me}")

        # Seed admin user from .env on first run
        if not User.query.filter_by(role='admin').first():
            seed_user  = os.environ.get('ADMIN_USERNAME', 'admin')
            seed_email = os.environ.get('ADMIN_EMAIL', '') or f"{seed_user}@holo3d.local"
            seed_pass  = os.environ.get('ADMIN_PASSWORD', '')
            if not seed_pass:
                print("\n" + "=" * 60)
                print("ERROR: ADMIN_PASSWORD is not set in your .env file.")
                print("Add this line to your .env file and restart:")
                print("  ADMIN_PASSWORD=your_strong_password_here")
                print("=" * 60 + "\n")
                sys.exit(1)
            db.session.add(User(
                username=seed_user,
                email=seed_email,
                password_hash=generate_password_hash(seed_pass),
                role='admin',
            ))
            db.session.commit()

    return app


# ── Entry point ───────────────────────────────────────────────────────────
if __name__ == '__main__':
    app = create_app()

    import werkzeug.serving
    werkzeug.serving.run_simple(
        '0.0.0.0', 5000, app,
        use_reloader=False, use_debugger=False,
        threaded=True,
    )
