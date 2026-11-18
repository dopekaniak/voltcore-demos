"""Turn a raw generated mesh into a print-ready one: clean, scale to millimetres, sit on the bed.

Input meshes are Z-up in arbitrary units (TRELLIS decodes into a unit cube). Meshes that are not
closed are rebuilt as solids from a voxel grid so every result can be printed. Output is Z-up in
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

    # Size first, so the voxel pitch below is in millimetres.
    extent = float(max(m.extents))
    if extent <= 0:
        raise ValueError("the model came back with no size")
    m.apply_scale(size_mm / extent)

    rebuilt = False
    if not m.is_watertight:
        solid = make_watertight(m)
        if solid is not None:
            m, rebuilt = solid, True
            # The rebuilt surface can differ by a voxel; keep the requested size exact.
            m.apply_scale(size_mm / float(max(m.extents)))
    if len(m.faces) > max_faces:
        m = reduce_faces(m, max_faces)

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
            "rebuilt_solid": rebuilt,
        },
    )


# Smallest voxel used to rebuild a closed surface: finer than an FDM nozzle can print.
MIN_PITCH_MM = 0.2
REBUILD_DIVISIONS = 320


def make_watertight(m: trimesh.Trimesh) -> trimesh.Trimesh | None:
    """Rebuild a closed, solid surface from a voxel grid of the mesh.

    Generated meshes carry many small non-manifold tangles; removing them leaves holes, so they
    cannot be repaired in place. Instead the surface is sampled densely, the voxels it touches
    are closed and filled, and marching cubes extracts a new surface. Detail finer than the
    voxel pitch (about 0.25 mm on an 80 mm part) is lost, which FDM printing cannot show anyway.
    Tries a smoothed grid, then a plain one, then a coarser one; None if none comes out closed.
    """
    base = max(float(max(m.extents)) / REBUILD_DIVISIONS, MIN_PITCH_MM)
    for pitch, smooth in ((base, True), (base, False), (base * 1.3, False)):
        try:
            r = _voxel_surface(m, pitch, smooth)
        except (ValueError, MemoryError, RuntimeError):
            continue
        if r.is_watertight and r.is_volume:
            return r
    return None


def _voxel_surface(m: trimesh.Trimesh, pitch: float, smooth: bool) -> trimesh.Trimesh:
    from scipy import ndimage
    from skimage import measure

    pad = 3
    lo, hi = m.bounds
    count = int(min(m.area / (pitch * pitch) * 4, 20_000_000))
    pts, _ = trimesh.sample.sample_surface(m, max(count, 1000), seed=0)
    idx = np.floor((pts - lo) / pitch).astype(np.int64) + pad
    grid = np.zeros(np.ceil((hi - lo) / pitch).astype(np.int64) + 2 * pad + 1, dtype=bool)
    grid[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    # Close pinholes in the sampled shell, fill the inside, then undo the dilation.
    grid = ndimage.binary_erosion(ndimage.binary_fill_holes(ndimage.binary_dilation(grid)))
    field = ndimage.gaussian_filter(grid.astype(np.float32), sigma=0.8) if smooth else grid.astype(np.float32)
    verts, faces, _, _ = measure.marching_cubes(field, 0.5)
    out = trimesh.Trimesh((verts - pad + 0.5) * pitch + lo, faces, process=True)
    trimesh.repair.fix_normals(out)
    return out


def reduce_faces(m: trimesh.Trimesh, max_faces: int) -> trimesh.Trimesh:
    """Cut the face count without opening a closed mesh. open3d's quadric decimation keeps closed
    meshes closed in our tests; fast-simplification is the fallback where open3d is not installed.
    A reduction that opens a closed mesh is discarded."""
    candidates = []
    try:
        import open3d as o3d

        o = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(np.asarray(m.vertices)), o3d.utility.Vector3iVector(np.asarray(m.faces)))
        o = o.simplify_quadric_decimation(max_faces)
        candidates.append(trimesh.Trimesh(np.asarray(o.vertices), np.asarray(o.triangles), process=True))
    except ImportError:
        pass
    candidates.append(_fast_simplify(m, max_faces))
    for c in candidates:
        trimesh.repair.fix_normals(c)
        if c.is_watertight or not m.is_watertight:
            return c
    # Every reduction opened the mesh: keep it closed and denser rather than open.
    return m


def _fast_simplify(m: trimesh.Trimesh, max_faces: int) -> trimesh.Trimesh:
    import fast_simplification

    ratio = 1 - max_faces / len(m.faces)
    v, f = fast_simplification.simplify(np.asarray(m.vertices, dtype=np.float32), np.asarray(m.faces, dtype=np.int32), target_reduction=ratio)
    return trimesh.Trimesh(vertices=v, faces=f, process=True)


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
