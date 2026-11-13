"""Turn a raw generated mesh into a print-ready one: clean, scale to millimetres, sit on the bed.

Input meshes are Z-up in arbitrary units (TRELLIS decodes into a unit cube). Output is Z-up in
millimetres for STL and OBJ, and Y-up for GLB (glTF convention; the mesh service rotates it
back when it loads a GLB).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import trimesh

Z_UP_TO_Y_UP = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])

# Pieces smaller than this share of the faces are floaters, not parts of the model.
FLOATER_SHARE = 0.01


@dataclass
class Prepared:
    mesh: trimesh.Trimesh
    stats: dict


def prepare(raw: trimesh.Trimesh, *, size_mm: float, max_faces: int) -> Prepared:
    m = raw.copy()
    m.merge_vertices()
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    if len(m.faces) == 0:
        raise ValueError("the model came back empty")

    parts = m.split(only_watertight=False)
    if len(parts) > 1:
        keep = [p for p in parts if len(p.faces) >= FLOATER_SHARE * len(m.faces)]
        removed = len(parts) - len(keep)
        m = trimesh.util.concatenate(keep) if keep else max(parts, key=lambda p: len(p.faces))
    else:
        removed = 0

    trimesh.repair.fill_holes(m)
    trimesh.repair.fix_normals(m)

    if len(m.faces) > max_faces:
        m = _simplify(m, max_faces)

    extent = float(max(m.extents))
    if extent <= 0:
        raise ValueError("the model has no size")
    m.apply_scale(size_mm / extent)
    lo = m.bounds[0]
    hi = m.bounds[1]
    m.apply_translation([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])

    return Prepared(
        mesh=m,
        stats={
            "triangles": int(len(m.faces)),
            "watertight": bool(m.is_watertight),
            "bbox_mm": [round(float(x), 2) for x in m.extents],
            "floaters_removed": int(removed),
        },
    )


def _simplify(m: trimesh.Trimesh, max_faces: int) -> trimesh.Trimesh:
    import fast_simplification

    ratio = 1 - max_faces / len(m.faces)
    v, f = fast_simplification.simplify(np.asarray(m.vertices, dtype=np.float32), np.asarray(m.faces, dtype=np.int32), target_reduction=ratio)
    out = trimesh.Trimesh(vertices=v, faces=f, process=True)
    trimesh.repair.fix_normals(out)
    return out


def export_all(m: trimesh.Trimesh) -> dict[str, bytes]:
    glb = m.copy()
    glb.apply_transform(Z_UP_TO_Y_UP)
    return {
        "stl": m.export(file_type="stl"),
        "obj": _bytes(m.export(file_type="obj")),
        "glb": glb.export(file_type="glb"),
    }


def _bytes(x: str | bytes) -> bytes:
    return x.encode() if isinstance(x, str) else x
