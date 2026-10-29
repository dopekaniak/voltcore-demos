"""Deterministic sample meshes for the mock generation provider (no external data)."""
from __future__ import annotations

import numpy as np
import trimesh

SAMPLES = ("vase", "mug", "gem", "blob", "tower")


def _vase() -> trimesh.Trimesh:
    z = np.linspace(0, 80, 24)
    r = 18 + 8 * np.sin(z / 80 * np.pi * 1.6) + z * 0.05
    profile = np.column_stack([r, z])
    outer = trimesh.creation.revolve(np.vstack([[0, 0], profile, [0, 80]]), sections=48)
    return outer


def _mug() -> trimesh.Trimesh:
    body = trimesh.creation.cylinder(radius=22, height=60, sections=48)
    body.apply_translation([0, 0, 30])
    handle = trimesh.creation.torus(major_radius=14, minor_radius=4, major_sections=32, minor_sections=12)
    handle.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    handle.apply_translation([24, 0, 32])
    return trimesh.boolean.union([body, handle], engine="manifold") if trimesh.boolean.engines_available else trimesh.util.concatenate([body, handle])


def _gem() -> trimesh.Trimesh:
    g = trimesh.creation.icosphere(subdivisions=1, radius=25)
    g.apply_scale([1, 1, 1.4])
    g.apply_translation([0, 0, 35])
    return g


def _blob() -> trimesh.Trimesh:
    s = trimesh.creation.icosphere(subdivisions=3, radius=30)
    v = s.vertices
    rng = np.random.default_rng(42)
    k = rng.normal(size=(6, 3))
    disp = sum(np.sin(v @ k[i] / 12.0 + i) for i in range(6)) / 6.0
    s.vertices = v * (1 + 0.18 * disp)[:, None]
    s.apply_translation([0, 0, -s.bounds[0][2]])
    return s


def _tower() -> trimesh.Trimesh:
    parts = []
    for i in range(4):
        w = 40 - i * 8
        b = trimesh.creation.box((w, w, 14))
        b.apply_translation([0, 0, 7 + i * 14])
        parts.append(b)
    if trimesh.boolean.engines_available:
        return trimesh.boolean.union(parts, engine="manifold")
    return trimesh.util.concatenate(parts)


BUILDERS = {"vase": _vase, "mug": _mug, "gem": _gem, "blob": _blob, "tower": _tower}


def sample(name: str, textured: bool = False) -> trimesh.Trimesh:
    if name not in BUILDERS:
        raise KeyError(name)
    m = BUILDERS[name]()
    if m.bounds[0][2] != 0:
        m.apply_translation([0, 0, -m.bounds[0][2]])
    if textured:
        # "Refined" mock output: vertex colours graded by height stand in for a texture.
        z = m.vertices[:, 2]
        t = (z - z.min()) / max(1e-9, z.max() - z.min())
        colors = np.column_stack([200 + 55 * t, 90 + 100 * t, 40 + 30 * (1 - t), np.full_like(t, 255)]).astype(np.uint8)
        m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=colors)
    return m
