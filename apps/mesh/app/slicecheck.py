"""Layer sanity check (Module 6, section 5): slice the mesh into layers and look for empty
layers inside the part, open contours, and contours that cross themselves. This is a
geometric check on the mesh, not a slicer: no toolpaths are produced (rule 6)."""
from __future__ import annotations

from collections import defaultdict

import numpy as np
import trimesh
from trimesh.intersections import mesh_plane

MAX_LAYERS = 1500
MAX_PAIR_CHECKS = 400_000


def _open_contour(segs: np.ndarray, q: float) -> bool:
    # Closed loops: every rounded endpoint is shared by an even number of segments.
    pts = np.round(segs.reshape(-1, 3)[:, :2] / q).astype(np.int64)
    _, counts = np.unique(pts, axis=0, return_counts=True)
    return bool(np.any(counts % 2 == 1))


def _cross(a, b, c, d) -> bool:
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    d1, d2, d3, d4 = orient(c, d, a), orient(c, d, b), orient(a, b, c), orient(a, b, d)
    eps = 1e-9
    return ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and ((d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps))


def _self_intersects(segs: np.ndarray, budget: list[int]) -> bool:
    s2 = segs[:, :, :2]
    lo = s2.min(axis=1)
    hi = s2.max(axis=1)
    span = float(np.max(hi - lo)) if len(s2) else 1.0
    cell = max(span * 2, 0.5)
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i in range(len(s2)):
        for gx in range(int(lo[i, 0] // cell), int(hi[i, 0] // cell) + 1):
            for gy in range(int(lo[i, 1] // cell), int(hi[i, 1] // cell) + 1):
                grid[(gx, gy)].append(i)
    seen: set[tuple[int, int]] = set()
    for members in grid.values():
        for x in range(len(members)):
            for y in range(x + 1, len(members)):
                i, j = members[x], members[y]
                if (i, j) in seen:
                    continue
                seen.add((i, j))
                budget[0] -= 1
                if budget[0] <= 0:
                    return False
                if _cross(s2[i, 0], s2[i, 1], s2[j, 0], s2[j, 1]):
                    return True
    return False


def slice_check(mesh: trimesh.Trimesh, layer_mm: float = 0.2) -> dict:
    zmin, zmax = float(mesh.bounds[0][2]), float(mesh.bounds[1][2])
    height = zmax - zmin
    layer_mm = max(layer_mm, height / MAX_LAYERS, 0.05)
    zs = np.arange(zmin + layer_mm / 2, zmax, layer_mm)
    q = max(1e-4, layer_mm / 100)
    empty: list[float] = []
    open_layers: list[float] = []
    crossing: list[float] = []
    budget = [MAX_PAIR_CHECKS]
    for z in zs:
        segs = mesh_plane(mesh, plane_normal=[0, 0, 1], plane_origin=[0, 0, float(z)])
        if len(segs) == 0:
            empty.append(round(float(z), 3))
            continue
        if _open_contour(segs, q):
            open_layers.append(round(float(z), 3))
        elif budget[0] > 0 and _self_intersects(segs, budget):
            crossing.append(round(float(z), 3))
    return {
        "layer_mm": round(layer_mm, 4),
        "layers": int(len(zs)),
        "empty_layers": empty[:20],
        "empty_count": len(empty),
        "open_layers": open_layers[:20],
        "open_count": len(open_layers),
        "self_intersecting_layers": crossing[:20],
        "self_intersecting_count": len(crossing),
        "exhaustive": budget[0] > 0,
        "ok": not empty and not open_layers and not crossing,
    }
