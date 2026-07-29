"""
gcode_generator.py
Scales an STL/OBJ mesh to exact user dimensions then slices it for 3D printing.

Pipeline:
  mesh (any scale) → scale to user dims × scale_factor → PrusaSlicer CLI → G-code
"""
import os
import subprocess
import shutil
import uuid
import traceback
from pathlib import Path

import trimesh
import numpy as np

OUTPUTS_DIR = Path(__file__).parent / "static" / "cad_outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Slicer auto-detection ──────────────────────────────────────────────────────
PRUSA_CANDIDATES = [
    r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe",
    r"C:\Program Files\PrusaSlicer\prusa-slicer-console.exe",
    r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer.exe",
]
CURA_CANDIDATES = [
    r"C:\Program Files\Ultimaker Cura\CuraEngine.exe",
    r"C:\Program Files\UltiMaker Cura\CuraEngine.exe",
]


def find_slicer() -> tuple[str | None, str | None]:
    """Return (slicer_type, executable_path) or (None, None)."""
    for p in PRUSA_CANDIDATES:
        if os.path.exists(p):
            return ("prusa", p)
    for name in ("prusa-slicer-console", "prusa-slicer"):
        found = shutil.which(name)
        if found:
            return ("prusa", found)
    for p in CURA_CANDIDATES:
        if os.path.exists(p):
            return ("cura", p)
    if shutil.which("CuraEngine"):
        return ("cura", shutil.which("CuraEngine"))
    return (None, None)


# ── Scale mesh ─────────────────────────────────────────────────────────────────
def scale_mesh(
    mesh_path: str,
    target_w: float,
    target_d: float,
    target_h: float,
    scale_factor: float = 1.0,
) -> str:
    """
    Load mesh, auto-detect units, scale to target_w × target_d × target_h (mm),
    then multiply by scale_factor (e.g. 0.1 → 1:10 prototype).
    Returns path to the exported STL.
    """
    mesh = trimesh.load(mesh_path, force="mesh")

    # Auto unit: if max dimension < 10 it's likely in metres
    lo, hi = mesh.bounding_box.bounds
    current = hi - lo
    if max(current) < 10:
        mesh.apply_scale(1000)
        lo, hi = mesh.bounding_box.bounds
        current = hi - lo

    # Scale each axis independently to match user-specified dimensions
    sx = (target_w * scale_factor) / current[0] if current[0] > 0 else 1.0
    sy = (target_d * scale_factor) / current[1] if current[1] > 0 else 1.0
    sz = (target_h * scale_factor) / current[2] if current[2] > 0 else 1.0
    mesh.apply_scale([sx, sy, sz])

    # Center mesh at origin (X/Y centered, Z sits on floor)
    bounds = mesh.bounding_box.bounds
    cx = (bounds[0][0] + bounds[1][0]) / 2
    cy = (bounds[0][1] + bounds[1][1]) / 2
    mesh.apply_translation([-cx, -cy, -bounds[0][2]])

    uid = uuid.uuid4().hex[:8]
    out_path = str(OUTPUTS_DIR / f"print_ready_{uid}.stl")
    mesh.export(out_path)
    return out_path


# ── Slice STL ─────────────────────────────────────────────────────────────────
def slice_stl(stl_path: str) -> dict:
    """
    Run PrusaSlicer CLI on an STL.
    Returns {"gcode": path} on success, {"error": msg} on failure,
    or {"no_slicer": True, "stl": stl_path} if no slicer is installed.
    """
    slicer_type, slicer_exe = find_slicer()
    gcode_path = stl_path.replace(".stl", ".gcode")

    if slicer_type == "prusa":
        cmd = [slicer_exe, "--slice", "--center", "125,105", "--output", gcode_path, stl_path]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if res.returncode == 0 and os.path.exists(gcode_path):
                return {"gcode": gcode_path}
            return {"error": f"PrusaSlicer: {(res.stderr or res.stdout)[:400]}"}
        except subprocess.TimeoutExpired:
            return {"error": "Slicing timed out (>3 min)"}
        except Exception as e:
            return {"error": str(e)}

    elif slicer_type == "cura":
        # CuraEngine needs a full printer-profile JSON; skip for now
        return {"error": "CuraEngine found but requires a printer profile JSON. Install PrusaSlicer for auto-slicing."}

    else:
        # No slicer installed — still useful: return the scaled STL
        return {"no_slicer": True, "stl": stl_path}


# ── Main entry point ───────────────────────────────────────────────────────────
def generate_print_files(
    mesh_abs_path: str,
    width: float,
    depth: float,
    height: float,
    scale_factor: float = 0.1,   # 0.1 = 1:10 prototype
) -> dict:
    """
    Full pipeline:
      1. Scale mesh to (width × depth × height) × scale_factor
      2. Attempt to slice with PrusaSlicer
      3. Return download info

    Returns:
      {
        "type":          "gcode" | "stl_only",
        "file":          absolute path to G-code or STL,
        "real_dims_mm":  {w, d, h},   # furniture at full size
        "print_dims_mm": {w, d, h},   # physical print size
        "note":          str | None,
        "error":         None,
      }
      or {"error": "..."}
    """
    try:
        # 1. Scale
        scaled_stl = scale_mesh(mesh_abs_path, width, depth, height, scale_factor)

        print_dims = {
            "w": round(width  * scale_factor, 1),
            "d": round(depth  * scale_factor, 1),
            "h": round(height * scale_factor, 1),
        }
        real_dims = {"w": width, "d": depth, "h": height}

        # 2. Slice
        slice_result = slice_stl(scaled_stl)

        if "gcode" in slice_result:
            return {
                "type":          "gcode",
                "file":          slice_result["gcode"],
                "scaled_stl":    scaled_stl,
                "real_dims_mm":  real_dims,
                "print_dims_mm": print_dims,
                "note":          None,
                "error":         None,
            }

        if slice_result.get("no_slicer"):
            return {
                "type":          "stl_only",
                "file":          scaled_stl,
                "scaled_stl":    scaled_stl,
                "real_dims_mm":  real_dims,
                "print_dims_mm": print_dims,
                "note":          "PrusaSlicer not found. Download the scaled STL and open it in Cura or PrusaSlicer.",
                "error":         None,
            }

        return {"error": slice_result.get("error", "Slicing failed")}

    except Exception as e:
        traceback.print_exc()
        return {"error": str(e)}
