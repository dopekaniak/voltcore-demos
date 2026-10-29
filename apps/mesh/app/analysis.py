"""Printability analysis (build prompt 4.4) and repair."""
from __future__ import annotations

import math
from collections import Counter

import numpy as np
import trimesh

OVERHANG_DEG = 45.0


def _edge_use(mesh: trimesh.Trimesh) -> Counter:
    edges = np.sort(mesh.edges, axis=1)
    return Counter(map(tuple, edges.tolist()))


def analyze(mesh: trimesh.Trimesh, build_volume=(256.0, 256.0, 256.0), scale_pct: float = 100.0) -> dict:
    m = mesh.copy()
    if scale_pct != 100.0:
        m.apply_scale(scale_pct / 100.0)
    merged = m.copy()
    merged.merge_vertices()
    tris = int(len(m.faces))
    area_faces = merged.area_faces
    degenerate = int(np.count_nonzero(area_faces < 1e-10))
    use = _edge_use(merged)
    boundary_edges = sum(1 for c in use.values() if c == 1)
    nonmanifold_edges = sum(1 for c in use.values() if c > 2)
    watertight = boundary_edges == 0 and nonmanifold_edges == 0
    winding = bool(merged.is_winding_consistent)
    volume = float(merged.volume) if watertight else float(abs(merged.volume))
    flipped = bool(watertight and winding and merged.volume < 0) or not winding
    bounds = merged.bounds
    size = (bounds[1] - bounds[0]).tolist()
    # Overhangs: downward faces steeper than 45 degrees, ignoring the bed band.
    normals = merged.face_normals
    centroids = merged.triangles_center
    limit = -math.cos(math.radians(90 - OVERHANG_DEG))
    over = (normals[:, 2] < limit) & (centroids[:, 2] > bounds[0][2] + 0.5)
    overhang_area = float(area_faces[over].sum())
    largest = max(size) if size else 0.0
    fits = all(s <= b + 1e-6 for s, b in zip(sorted(size), sorted(build_volume)))
    notes: list[str] = []
    units = "mm"
    if largest < 1.0:
        units = "m"
        notes.append("The model is under 1 mm across; it was probably exported in metres. Try 100000%.")
    elif largest < 12.0:
        notes.append("The model is small. If it was designed in inches, scale it by 2540%.")
    if not watertight:
        notes.append(f"{boundary_edges} open edges and {nonmanifold_edges} non-manifold edges.")
    if flipped:
        notes.append("Some faces point inward; repair will fix the normals.")
    if not fits:
        notes.append("The model is larger than the build volume.")
    printable = watertight and winding and not flipped and degenerate == 0 and fits and largest >= 1.0
    components = int(len(merged.split(only_watertight=False))) if tris < 200_000 else None
    return {
        "triangles": tris,
        "vertices": int(len(merged.vertices)),
        "bbox_mm": [round(v, 3) for v in size],
        "volume_mm3": round(volume, 3),
        "surface_area_mm2": round(float(area_faces.sum()), 3),
        "watertight": watertight,
        "manifold": nonmanifold_edges == 0,
        "winding_consistent": winding,
        "flipped_normals": flipped,
        "degenerate_faces": degenerate,
        "boundary_edges": boundary_edges,
        "nonmanifold_edges": nonmanifold_edges,
        "components": components,
        "overhang_area_mm2": round(overhang_area, 3),
        "units_guess": units,
        "fits_build_volume": fits,
        "printable": printable,
        "scale_pct": scale_pct,
        "notes": notes,
    }


def repair(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, list[str]]:
    """Repair for printing. Always returns a new mesh; the original is never modified."""
    m = mesh.copy()
    actions: list[str] = []
    before_v = len(m.vertices)
    m.merge_vertices()
    if len(m.vertices) != before_v:
        actions.append(f"merged {before_v - len(m.vertices)} duplicate vertices")
    keep = m.nondegenerate_faces(height=1e-8)
    if not keep.all():
        actions.append(f"removed {int((~keep).sum())} degenerate faces")
        m.update_faces(keep)
    unique = m.unique_faces()
    if not unique.all():
        actions.append(f"removed {int((~unique).sum())} duplicate faces")
        m.update_faces(unique)
    # Drop faces on non-manifold edges beyond the first two (fins).
    use = _edge_use(m)
    bad = {e for e, c in use.items() if c > 2}
    if bad:
        edges = np.sort(m.edges, axis=1).reshape(-1, 3, 2)
        seen: Counter = Counter()
        keep_mask = np.ones(len(m.faces), dtype=bool)
        for fi in range(len(m.faces)):
            fe = [tuple(e) for e in edges[fi].tolist()]
            if any(e in bad and seen[e] >= 2 for e in fe):
                keep_mask[fi] = False
                continue
            for e in fe:
                if e in bad:
                    seen[e] += 1
        if not keep_mask.all():
            actions.append(f"removed {int((~keep_mask).sum())} faces on non-manifold edges")
            m.update_faces(keep_mask)
    m.remove_unreferenced_vertices()
    if not m.is_winding_consistent or m.volume < 0:
        trimesh.repair.fix_normals(m, multibody=True)
        actions.append("made face winding consistent and normals point outward")
    if not m.is_watertight:
        trimesh.repair.fill_holes(m)
        if not m.is_watertight:
            m = _fan_fill(m)
        actions.append("filled holes" if m.is_watertight else "tried to fill holes (some remain)")
        trimesh.repair.fix_normals(m, multibody=True)
    if not actions:
        actions.append("no problems found")
    return m, actions


def remesh(mesh: trimesh.Trimesh, target_faces: int) -> tuple[trimesh.Trimesh, list[str]]:
    import fast_simplification

    n = len(mesh.faces)
    if target_faces >= n:
        return mesh.copy(), [f"already at {n} faces"]
    reduction = 1.0 - target_faces / n
    pts, faces = fast_simplification.simplify(np.asarray(mesh.vertices, dtype=np.float32), np.asarray(mesh.faces, dtype=np.int64), target_reduction=reduction)
    out = trimesh.Trimesh(vertices=pts, faces=faces, process=True)
    return out, [f"decimated from {n} to {len(out.faces)} faces"]


def _fan_fill(m: trimesh.Trimesh) -> trimesh.Trimesh:
    """Close each boundary loop with a fan around its centroid (handles holes of any size)."""
    faces = np.asarray(m.faces)
    directed = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    pairs = {tuple(e) for e in directed.tolist()}
    boundary = [(a, b) for a, b in directed.tolist() if (b, a) not in pairs]
    nxt: dict[int, int] = {}
    for a, b in boundary:
        nxt.setdefault(a, b)
    verts = list(np.asarray(m.vertices))
    new_faces = [list(f) for f in faces.tolist()]
    visited: set[int] = set()
    for start in list(nxt):
        if start in visited:
            continue
        loop = [start]
        visited.add(start)
        cur = nxt[start]
        while cur != start and cur in nxt and cur not in visited and len(loop) < 100000:
            loop.append(cur)
            visited.add(cur)
            cur = nxt[cur]
        if cur != start or len(loop) < 3:
            continue
        c = np.mean([verts[i] for i in loop], axis=0)
        ci = len(verts)
        verts.append(c)
        for i, a in enumerate(loop):
            b = loop[(i + 1) % len(loop)]
            new_faces.append([b, a, ci])
    out = trimesh.Trimesh(vertices=np.array(verts), faces=np.array(new_faces), process=False)
    out.merge_vertices()
    return out
