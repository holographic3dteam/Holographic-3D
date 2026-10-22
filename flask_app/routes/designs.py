"""
routes/designs.py
Blueprint for saved/generated designs — list, save, delete, rate.
"""

from flask import Blueprint, request, jsonify, session
from models import db, GeneratedDesign
from decorators import login_required

designs_bp = Blueprint("designs", __name__)


@designs_bp.route('/api/save', methods=['GET'])
@login_required
def list_saved_designs():
    try:
        uid = session.get("user_id")
        designs = GeneratedDesign.query.filter_by(user_id=uid)\
            .order_by(GeneratedDesign.created_at.desc()).all()
        return jsonify([
            {
                "id":          d.id,
                "prompt":      d.prompt,
                "preview_url": d.file_path,
                "rating":      d.rating,
                "savedAt":     d.created_at.isoformat() if d.created_at else None,
            }
            for d in designs
        ]), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@designs_bp.route('/api/save', methods=['POST'])
@login_required
def save_design():
    try:
        data = request.json or {}
        prompt      = data.get('prompt')
        preview_url = data.get('preview_url')

        if not prompt or not preview_url:
            return jsonify({"error": "Prompt and preview_url are required"}), 400

        existing = GeneratedDesign.query.filter_by(
            prompt=prompt, file_path=preview_url
        ).first()
        if existing:
            return jsonify({
                "message": "Already saved.",
                "design_id": existing.id,
                "already_saved": True,
            }), 200

        new_generated = GeneratedDesign(
            prompt=prompt,
            file_path=preview_url,
            user_id=session.get("user_id"),
        )
        db.session.add(new_generated)
        db.session.commit()

        return jsonify({
            "message": "Design saved successfully!",
            "design_id": new_generated.id,
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@designs_bp.route('/api/save/<int:design_id>', methods=['DELETE'])
@login_required
def delete_design(design_id):
    try:
        design = db.session.get(GeneratedDesign, design_id)
        if not design or design.user_id != session.get("user_id"):
            return jsonify({"error": "Design not found"}), 404
        db.session.delete(design)
        db.session.commit()
        return jsonify({"message": "Deleted successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@designs_bp.route('/api/save/<int:design_id>/rate', methods=['POST'])
@login_required
def rate_design(design_id):
    try:
        data = request.json or {}
        rating = data.get('rating')
        try:
            rating_int = int(rating) if rating is not None else None
        except (ValueError, TypeError):
            return jsonify({"error": "Rating must be a number 1-5"}), 400
        if rating_int is None or not (1 <= rating_int <= 5):
            return jsonify({"error": "Rating must be 1-5"}), 400

        design = db.session.get(GeneratedDesign, design_id)
        if not design or design.user_id != session.get("user_id"):
            return jsonify({"error": "Design not found"}), 404

        design.rating = rating_int
        db.session.commit()
        return jsonify({"message": "Rating saved", "rating": design.rating}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
