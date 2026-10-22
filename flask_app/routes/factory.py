"""
routes/factory.py
Blueprint for factory catalog management (admin) and product requests.
"""

import os
import secrets

from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename

from config import Config
from models import db, FactoryDesign, ProductRequest
from decorators import login_required, admin_required

factory_bp = Blueprint("factory", __name__)

ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_UPLOAD_MIMETYPES  = {"image/jpeg", "image/png", "image/webp", "image/jpg"}


# ───────────────────────────────────────────────────────────────────────────
# Factory Catalog CRUD (admin only)
# ───────────────────────────────────────────────────────────────────────────

@factory_bp.route('/api/factory/upload', methods=['POST'])
@admin_required
def upload_design():
    try:
        from search_logic import embedding_model

        description = request.form.get('description')
        file = request.files.get('file')

        if not file or not description:
            return jsonify({"error": "Description and file are required"}), 400

        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in ALLOWED_UPLOAD_EXTENSIONS:
            return jsonify({"error": f"Only image files are allowed (.jpg, .png, .webp). Got: {ext or 'none'}"}), 400
        if file.mimetype not in ALLOWED_UPLOAD_MIMETYPES:
            return jsonify({"error": f"Invalid MIME type: {file.mimetype}"}), 400

        try:
            from PIL import Image as _PILImage
            file.stream.seek(0)
            _PILImage.open(file.stream).verify()
            file.stream.seek(0)
        except Exception:
            return jsonify({"error": "File is not a valid image."}), 400

        safe = secure_filename(file.filename or "") or "upload"
        name_part, ext_part = os.path.splitext(safe)
        filename = f"{name_part or 'upload'}_{secrets.token_hex(4)}{ext_part}"
        file_absolute_path = os.path.join(Config.FACTORY_FOLDER, filename)
        file.save(file_absolute_path)
        file_relative_path = f"static/factory_assets/{filename}"

        vector_data = embedding_model.encode(description).tolist()

        new_design = FactoryDesign(description=description, file_path=file_relative_path)
        new_design.set_vector(vector_data)
        db.session.add(new_design)
        db.session.commit()

        return jsonify({
            "message": "Success! Design stored and vectorized.",
            "design_id": new_design.id,
            "path": file_relative_path,
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@factory_bp.route('/api/factory/designs', methods=['GET'])
@admin_required
def list_factory_designs():
    try:
        designs = FactoryDesign.query.order_by(FactoryDesign.id.desc()).all()
        return jsonify([
            {
                "id":          d.id,
                "description": d.description,
                "filePath":    d.file_path,
            }
            for d in designs
        ]), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@factory_bp.route('/api/factory/designs/<int:design_id>', methods=['PUT'])
@admin_required
def update_factory_design(design_id):
    try:
        from search_logic import embedding_model

        design = db.session.get(FactoryDesign, design_id)
        if not design:
            return jsonify({"error": "Not found"}), 404
        data = request.json or {}
        new_desc = (data.get('description') or '').strip()
        if not new_desc:
            return jsonify({"error": "Description required"}), 400

        design.description = new_desc
        vector_data = embedding_model.encode(new_desc).tolist()
        design.set_vector(vector_data)
        db.session.commit()
        return jsonify({"message": "Updated", "id": design.id}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@factory_bp.route('/api/factory/designs/<int:design_id>', methods=['DELETE'])
@admin_required
def delete_factory_design(design_id):
    try:
        design = db.session.get(FactoryDesign, design_id)
        if not design:
            return jsonify({"error": "Not found"}), 404

        abs_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), design.file_path)
        if os.path.exists(abs_path):
            os.remove(abs_path)

        db.session.delete(design)
        db.session.commit()
        return jsonify({"message": "Deleted"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


# ───────────────────────────────────────────────────────────────────────────
# Product Requests
# ───────────────────────────────────────────────────────────────────────────

@factory_bp.route('/api/product-request', methods=['POST'])
@login_required
def product_request_create():
    try:
        data = request.json or {}
        category    = (data.get('category') or '').strip()
        description = (data.get('description') or '').strip()
        if not category or not description:
            return jsonify({"error": "Category and description required"}), 400
        if len(category) > 100 or len(description) > 2000:
            return jsonify({"error": "Input too long"}), 400

        req = ProductRequest(category=category, description=description)
        db.session.add(req)
        db.session.commit()
        return jsonify({"message": "Request submitted!", "id": req.id}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@factory_bp.route('/api/product-requests', methods=['GET'])
@admin_required
def list_product_requests():
    try:
        reqs = ProductRequest.query.order_by(ProductRequest.created_at.desc()).all()
        return jsonify([
            {
                "id":          r.id,
                "category":    r.category,
                "description": r.description,
                "createdAt":   r.created_at.isoformat() if r.created_at else None,
            }
            for r in reqs
        ]), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@factory_bp.route('/api/product-requests/<int:req_id>', methods=['DELETE'])
@admin_required
def delete_product_request(req_id):
    try:
        req = db.session.get(ProductRequest, req_id)
        if not req:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(req)
        db.session.commit()
        return jsonify({"message": "Deleted"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
