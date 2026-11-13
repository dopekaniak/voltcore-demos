"""Generation engines. An engine turns a prompt or an image into a raw Z-up mesh.

`test` runs anywhere without a GPU and makes simple deterministic shapes, so the platform can
be exercised end to end. `trellis` runs the open TRELLIS models on an NVIDIA GPU.
"""
from __future__ import annotations

from typing import Callable, Protocol

import trimesh
from PIL import Image

Progress = Callable[[int], None]
Canceled = Callable[[], bool]


class TaskCanceled(Exception):
    pass


class Engine(Protocol):
    name: str

    def text(self, prompt: str, *, seed: int, quality: str, progress: Progress, canceled: Canceled) -> trimesh.Trimesh: ...

    def image(self, image: Image.Image, *, seed: int, quality: str, remove_background: bool, progress: Progress, canceled: Canceled) -> trimesh.Trimesh: ...


def load_engine(name: str) -> Engine:
    if name == "test":
        from .test_engine import TestEngine

        return TestEngine()
    if name == "trellis":
        from .trellis_engine import TrellisEngine

        return TrellisEngine()
    raise ValueError(f"unknown GEN_ENGINE {name!r}; use 'test' or 'trellis'")
