"""Deterministic stand-in engine for machines without a GPU.

It does not understand prompts. It picks a simple shape from keywords (or from a hash of the
prompt) so the same prompt and seed always give the same mesh. Use it for development and tests.
"""
from __future__ import annotations

import hashlib
import os
import time

import numpy as np
import trimesh
from PIL import Image

from . import Canceled, Progress, TaskCanceled

KEYWORDS = {
    "vase": "vase",
    "cup": "vase",
    "mug": "vase",
    "box": "box",
    "cube": "box",
    "ring": "ring",
    "donut": "ring",
    "ball": "ball",
    "sphere": "ball",
    "tower": "tower",
}
SHAPES = ("vase", "box", "ring", "ball", "tower")


class TestEngine:
    name = "test"

    def __init__(self) -> None:
        self.delay = float(os.environ.get("GEN_TEST_DELAY_S", "0.5"))

    def text(self, prompt: str, *, seed: int, quality: str, progress: Progress, canceled: Canceled) -> trimesh.Trimesh:
        words = prompt.lower()
        shape = next((s for k, s in KEYWORDS.items() if k in words), None)
        digest = hashlib.sha256(f"{prompt}|{seed}".encode()).digest()
        return self._run(shape or SHAPES[digest[0] % len(SHAPES)], digest, quality, progress, canceled)

    def image(self, image: Image.Image, *, seed: int, quality: str, remove_background: bool, progress: Progress, canceled: Canceled) -> trimesh.Trimesh:
        digest = hashlib.sha256(image.tobytes() + str(seed).encode()).digest()
        return self._run(SHAPES[digest[0] % len(SHAPES)], digest, quality, progress, canceled)

    def _run(self, shape: str, digest: bytes, quality: str, progress: Progress, canceled: Canceled) -> trimesh.Trimesh:
        steps = 4 if quality == "draft" else 8
        for i in range(steps):
            if canceled():
                raise TaskCanceled()
            time.sleep(self.delay / steps)
            progress(10 + int(80 * (i + 1) / steps))
        detail = 3 if quality == "draft" else 4
        return build(shape, digest, detail)


def build(shape: str, digest: bytes, detail: int) -> trimesh.Trimesh:
    a = 0.6 + digest[1] / 255 * 0.8  # proportion
    if shape == "box":
        return trimesh.creation.box((1.0, a, 0.5 + a / 2))
    if shape == "ring":
        return trimesh.creation.torus(major_radius=1.0, minor_radius=0.25 + a / 10, major_sections=16 * detail, minor_sections=8 * detail)
    if shape == "ball":
        return trimesh.creation.icosphere(subdivisions=detail, radius=1.0)
    if shape == "tower":
        base = trimesh.creation.box((1.0, 1.0, 0.3))
        mid = trimesh.creation.cylinder(radius=0.35, height=1.6 * a, sections=8 * detail)
        mid.apply_translation([0, 0, 0.15 + 0.8 * a])
        top = trimesh.creation.cone(radius=0.5, height=0.5, sections=8 * detail)
        top.apply_translation([0, 0, 0.15 + 1.6 * a])
        return trimesh.util.concatenate([base, mid, top])
    # vase: a revolved profile, closed at the bottom
    z = np.linspace(0, 1.4, 6 * detail)
    r = 0.35 + 0.25 * np.sin(z * np.pi * a) + 0.1
    profile = np.column_stack([np.concatenate([[0], r, [0]]), np.concatenate([[0], z, [z[-1]]])])
    return trimesh.creation.revolve(profile, sections=12 * detail)

