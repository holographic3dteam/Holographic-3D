"""
specs_generator.py
Generates a professional Manufacturing Specification Sheet PDF for a furniture design.
"""
import os
import uuid
from pathlib import Path
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUTPUTS_DIR = Path(__file__).parent / "static" / "cad_outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# Brand colors
DARK_BG    = colors.HexColor("#050810")
CYAN       = colors.HexColor("#00E5FF")
CYAN_DIM   = colors.HexColor("#0a2a30")
WHITE      = colors.HexColor("#E7ECF3")
GREY       = colors.HexColor("#4A5568")
LIGHT_GREY = colors.HexColor("#8896A0")
BORDER     = colors.HexColor("#1a2a35")

# Material recommendations per category
MATERIALS = {
    "chair": [
        ("Frame",       "Beech or Oak hardwood — kiln-dried, mortise & tenon joints"),
        ("Padding",     "High-density foam (35 kg/m³), 60mm seat / 40mm back"),
        ("Upholstery",  "Full-grain leather or woven fabric (min. 50,000 rub cycles)"),
        ("Finish",      "Water-based lacquer, satin sheen, UV-resistant"),
        ("Hardware",    "Stainless steel M8 bolts, nylon glides or swivel casters"),
    ],
    "sofa": [
        ("Frame",       "Kiln-dried hardwood (oak/pine), corner-blocked joints"),
        ("Suspension",  "8-way hand-tied sinuous springs + webbing base"),
        ("Padding",     "High-resilience foam (40 kg/m³) + Dacron fibre wrap"),
        ("Upholstery",  "Performance fabric or top-grain leather, removable covers"),
        ("Legs",        "Solid walnut or lacquered beech, adjustable floor levellers"),
        ("Finish",      "Anti-pill, stain-resistant treatment on fabric"),
    ],
    "table": [
        ("Top",         "Solid oak or walnut slab (28–40mm), live-edge or straight"),
        ("Legs",        "Solid wood or powder-coated steel, 50×50mm section min."),
        ("Joinery",     "Mortise & tenon or metal hairpin brackets"),
        ("Finish",      "Hard-wax oil or polyurethane, heat/water resistant"),
        ("Hardware",    "Levelling feet, cable management grommet (optional)"),
    ],
}

DEFAULT_MATERIALS = [
    ("Frame",   "Hardwood — species TBD per client specification"),
    ("Finish",  "Water-based lacquer or hard-wax oil"),
    ("Hardware","Stainless steel fixings"),
]


def generate_specs_pdf(
    name: str,
    category: str,
    width: float,
    depth: float,
    height: float,
    ar_url: str = "",
) -> str:
    """
    Generate a spec-sheet PDF and return its relative path
    (relative to flask_app root, suitable for Flask /static/ serving).
    """
    uid      = uuid.uuid4().hex[:8]
    filename = f"specs_{uid}.pdf"
    out_path = str(OUTPUTS_DIR / filename)

    W, H = A4   # 595 × 842 pt
    c = canvas.Canvas(out_path, pagesize=A4)

    # ── Background ──────────────────────────────────────────────────────────────
    c.setFillColor(DARK_BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # ── Top accent bar ──────────────────────────────────────────────────────────
    c.setFillColor(CYAN)
    c.rect(0, H - 4*mm, W, 4*mm, fill=1, stroke=0)

    # ── Header ──────────────────────────────────────────────────────────────────
    c.setFillColor(CYAN)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(20*mm, H - 22*mm, "Holo3D")
    c.setFillColor(WHITE)
    c.setFont("Helvetica", 10)
    c.drawString(20*mm, H - 29*mm, "Wood Factory  ·  AI Design System")

    c.setFillColor(LIGHT_GREY)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 20*mm, H - 22*mm, datetime.now().strftime("%d %B %Y"))
    c.drawRightString(W - 20*mm, H - 29*mm, f"Ref: {uid.upper()}")

    # Divider
    c.setStrokeColor(CYAN)
    c.setLineWidth(0.5)
    c.line(20*mm, H - 34*mm, W - 20*mm, H - 34*mm)

    # ── Title ───────────────────────────────────────────────────────────────────
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20*mm, H - 46*mm, "MANUFACTURING SPECIFICATION SHEET")

    c.setFillColor(LIGHT_GREY)
    c.setFont("Helvetica", 9)
    c.drawString(20*mm, H - 53*mm, f"Design: {name}")
    c.drawString(20*mm, H - 59*mm, f"Category: {category.capitalize()}")

    # ── Dimensions box ───────────────────────────────────────────────────────────
    y_dims = H - 75*mm
    box_h  = 46*mm

    c.setFillColor(CYAN_DIM)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.roundRect(20*mm, y_dims, W - 40*mm, box_h, 4*mm, fill=1, stroke=1)

    c.setFillColor(CYAN)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(28*mm, y_dims + box_h - 10*mm, "DIMENSIONS")

    c.setStrokeColor(CYAN)
    c.setLineWidth(0.3)
    c.line(28*mm, y_dims + box_h - 12*mm, W - 28*mm, y_dims + box_h - 12*mm)

    dims = [
        ("Width  (W)", f"{width:.0f} mm", f"{width/1000:.3f} m"),
        ("Depth  (D)", f"{depth:.0f} mm", f"{depth/1000:.3f} m"),
        ("Height (H)", f"{height:.0f} mm", f"{height/1000:.3f} m"),
    ]

    for i, (label, mm_val, m_val) in enumerate(dims):
        row_y = y_dims + box_h - 22*mm - i * 8*mm
        c.setFillColor(LIGHT_GREY)
        c.setFont("Helvetica", 9)
        c.drawString(28*mm, row_y, label)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(90*mm, row_y, mm_val)
        c.setFillColor(GREY)
        c.setFont("Helvetica", 9)
        c.drawString(130*mm, row_y, m_val)

    # ── Materials table ──────────────────────────────────────────────────────────
    y_mat  = y_dims - 14*mm
    mats   = MATERIALS.get(category.lower(), DEFAULT_MATERIALS)
    rows_h = len(mats) * 9*mm + 16*mm

    c.setFillColor(CYAN_DIM)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.roundRect(20*mm, y_mat - rows_h, W - 40*mm, rows_h, 4*mm, fill=1, stroke=1)

    c.setFillColor(CYAN)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(28*mm, y_mat - 10*mm, "MATERIAL RECOMMENDATIONS")

    c.setStrokeColor(CYAN)
    c.setLineWidth(0.3)
    c.line(28*mm, y_mat - 12*mm, W - 28*mm, y_mat - 12*mm)

    for i, (component, spec) in enumerate(mats):
        row_y = y_mat - 21*mm - i * 9*mm
        c.setFillColor(CYAN)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(28*mm, row_y, component)
        c.setFillColor(LIGHT_GREY)
        c.setFont("Helvetica", 8)
        c.drawString(68*mm, row_y, spec)

    # ── Notes ────────────────────────────────────────────────────────────────────
    y_notes = y_mat - rows_h - 12*mm
    c.setFillColor(GREY)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(20*mm, y_notes, "PRODUCTION NOTES")
    c.setLineWidth(0.3)
    c.setStrokeColor(GREY)
    c.line(20*mm, y_notes - 2*mm, W - 20*mm, y_notes - 2*mm)

    notes = [
        "All dimensions are nominal — allowable tolerance ±2mm unless otherwise specified.",
        "Wood species and grain direction to be confirmed with client before production.",
        "Prototype recommended at 1:10 scale before full manufacturing.",
        "Comply with EN 12520 (seating) / EN 12521 (tables) strength & durability standards.",
    ]
    c.setFillColor(LIGHT_GREY)
    c.setFont("Helvetica", 8)
    for i, note in enumerate(notes):
        c.drawString(20*mm, y_notes - 9*mm - i * 7*mm, f"• {note}")

    # ── QR Code (if ar_url provided) ─────────────────────────────────────────────
    if ar_url:
        try:
            import urllib.request, urllib.parse, io
            qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=120x120&data={urllib.parse.quote(ar_url)}&color=00E5FF&qzone=1"
            qr_data = urllib.request.urlopen(qr_url, timeout=5).read()
            from reportlab.lib.utils import ImageReader
            qr_img  = ImageReader(io.BytesIO(qr_data))
            qr_x    = W - 20*mm - 30*mm
            qr_y    = 18*mm
            c.drawImage(qr_img, qr_x, qr_y, width=30*mm, height=30*mm)
            c.setFillColor(LIGHT_GREY)
            c.setFont("Helvetica", 7)
            c.drawCentredString(qr_x + 15*mm, qr_y - 5*mm, "Scan for AR View")
        except Exception:
            pass  # QR is optional

    # ── Footer ───────────────────────────────────────────────────────────────────
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(20*mm, 14*mm, W - 20*mm, 14*mm)

    c.setFillColor(GREY)
    c.setFont("Helvetica", 7)
    c.drawString(20*mm, 9*mm, "Generated by Holo3D Wood Factory AI Design System")
    c.drawRightString(W - 20*mm, 9*mm, "This document is auto-generated — verify dimensions before production.")

    c.save()

    return f"static/cad_outputs/{filename}"
