"""
routes/manufacturing.py
Blueprint for mesh dimensions, G-code generation, and specs PDF.
"""

import os

from flask import Blueprint, request, jsonify
from decorators import login_required

manufacturing_bp = Blueprint("manufacturing", __name__)


@manufacturing_bp.route('/api/mesh-dims', methods=['GET'])
@login_required
def mesh_dims():
    mesh_path = request.args.get('path', '').strip()
    if not mesh_path:
        return jsonify({"error": "path required"}), 400

    safe_prefixes = ("static/generated_meshes/", "static/cad_outputs/")
    norm = os.path.normpath(mesh_path).replace("\\", "/")
    if not any(norm.startswith(p) for p in safe_prefixes):
        return jsonify({"error": "Invalid path"}), 400

    abs_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), norm)
    if not os.path.exists(abs_path):
        return jsonify({"error": "File not found"}), 404

    try:
        import trimesh
        m = trimesh.load(abs_path, force='mesh')
        lo, hi = m.bounding_box.bounds
        extents = hi - lo
        if max(extents) < 10:   # metres → mm
            extents = extents * 1000
        w, d, h = float(extents[0]), float(extents[1]), float(extents[2])
        return jsonify({"w": round(w, 1), "d": round(d, 1), "h": round(h, 1)}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@manufacturing_bp.route('/api/generate-gcode', methods=['POST'])
@login_required
def generate_gcode():
    data = request.json or {}
    mesh_path    = data.get('mesh_path', '').strip()
    scale_factor = float(data.get('scale_factor', 0.1))

    try:
        width  = float(data.get('width',  0))
        depth  = float(data.get('depth',  0))
        height = float(data.get('height', 0))
    except (TypeError, ValueError):
        return jsonify({"error": "width / depth / height must be numbers"}), 400

    if not mesh_path or width <= 0 or depth <= 0 or height <= 0:
        return jsonify({"error": "mesh_path, width, depth, height are required"}), 400

    if not (0.01 <= scale_factor <= 1.0):
        return jsonify({"error": "scale_factor must be between 0.01 and 1.0"}), 400

    safe_prefixes = ("static/generated_meshes/", "static/cad_outputs/")
    norm = os.path.normpath(mesh_path).replace("\\", "/")
    if not any(norm.startswith(p) for p in safe_prefixes):
        return jsonify({"error": "Invalid mesh path"}), 400

    abs_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), norm)
    if not os.path.exists(abs_path):
        return jsonify({"error": "Mesh file not found on server"}), 404

    from gcode_generator import generate_print_files
    result = generate_print_files(abs_path, width, depth, height, scale_factor)

    if result.get("error"):
        return jsonify({"error": result["error"]}), 500

    file_abs = result["file"]
    file_rel = os.path.relpath(
        file_abs, os.path.dirname(os.path.dirname(__file__))
    ).replace("\\", "/")

    return jsonify({
        "type":          result["type"],
        "download_url":  f"/{file_rel}",
        "real_dims_mm":  result["real_dims_mm"],
        "print_dims_mm": result["print_dims_mm"],
        "note":          result.get("note"),
    }), 200


@manufacturing_bp.route('/api/specs-pdf', methods=['POST'])
@login_required
def specs_pdf():
    data     = request.json or {}
    name     = (data.get('name') or 'Furniture Design').strip()[:120]
    category = (data.get('category') or 'chair').strip().lower()
    ar_url   = (data.get('ar_url') or '').strip()[:500]

    try:
        width  = float(data.get('width',  1200))
        depth  = float(data.get('depth',  700))
        height = float(data.get('height', 750))
    except (TypeError, ValueError):
        return jsonify({"error": "width/depth/height must be numbers"}), 400

    if not (10 <= width <= 5000 and 10 <= depth <= 5000 and 10 <= height <= 5000):
        return jsonify({"error": "Dimensions out of range (10–5000 mm)"}), 400

    try:
        from specs_generator import generate_specs_pdf
        rel_path = generate_specs_pdf(name, category, width, depth, height, ar_url)
        return jsonify({"download_url": f"/{rel_path}"}), 200
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": str(e)}), 500
