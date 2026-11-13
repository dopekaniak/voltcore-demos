"""TRELLIS engine (https://github.com/microsoft/TRELLIS, MIT). Needs an NVIDIA GPU with 16 GB+.

Licensing (checked 2026-11-13, see docs/decisions.md ADR-044): only the shape path is used. We
decode `formats=['mesh']` and export geometry with trimesh. That path needs TRELLIS (MIT), its
FlexiCubes fork (Apache-2.0), kaolin (Apache-2.0), spconv (Apache-2.0) and utils3d (MIT). The
renderers and texture baking need nvdiffrast, diffoctreerast and diff-gaussian-rasterization,
which are research or non-commercial only. They are not installed in our image and nothing here
imports them; TRELLIS loads its renderers lazily.

Models load once, on first use, and stay on the GPU. Calls run one at a time on the task worker.
"""
from __future__ import annotations

import os
import threading

import numpy as np
import trimesh
from PIL import Image

from . import Canceled, Progress, TaskCanceled

# Sampler steps per quality. Draft is the fast preview; high is the refine pass.
STEPS = {"draft": 12, "high": 25}


class TrellisEngine:
    name = "trellis"

    def __init__(self) -> None:
        os.environ.setdefault("SPCONV_ALGO", "native")
        os.environ.setdefault("ATTN_BACKEND", "xformers")
        self.text_model = os.environ.get("GEN_TRELLIS_TEXT_MODEL", "microsoft/TRELLIS-text-large")
        self.image_model = os.environ.get("GEN_TRELLIS_IMAGE_MODEL", "microsoft/TRELLIS-image-large")
        self._text = None
        self._image = None
        self._lock = threading.Lock()

    def _pipeline(self, kind: str):
        with self._lock:
            if kind == "text" and self._text is None:
                from trellis.pipelines import TrellisTextTo3DPipeline

                self._text = TrellisTextTo3DPipeline.from_pretrained(self.text_model)
                self._text.cuda()
            if kind == "image" and self._image is None:
                from trellis.pipelines import TrellisImageTo3DPipeline

                self._image = TrellisImageTo3DPipeline.from_pretrained(self.image_model)
                self._image.cuda()
            return self._text if kind == "text" else self._image

    def warm(self) -> None:
        self._pipeline("text")
        self._pipeline("image")

    def text(self, prompt: str, *, seed: int, quality: str, progress: Progress, canceled: Canceled) -> trimesh.Trimesh:
        pipe = self._pipeline("text")
        progress(10)
        if canceled():
            raise TaskCanceled()
        steps = STEPS[quality]
        out = pipe.run(prompt, seed=seed, formats=["mesh"], sparse_structure_sampler_params={"steps": steps}, slat_sampler_params={"steps": steps})
        progress(85)
        return _to_trimesh(out["mesh"][0])

    def image(self, image: Image.Image, *, seed: int, quality: str, remove_background: bool, progress: Progress, canceled: Canceled) -> trimesh.Trimesh:
        pipe = self._pipeline("image")
        progress(10)
        if canceled():
            raise TaskCanceled()
        steps = STEPS[quality]
        out = pipe.run(image, seed=seed, formats=["mesh"], preprocess_image=remove_background, sparse_structure_sampler_params={"steps": steps}, slat_sampler_params={"steps": steps})
        progress(85)
        return _to_trimesh(out["mesh"][0])


def _to_trimesh(result) -> trimesh.Trimesh:
    v = result.vertices.detach().float().cpu().numpy()
    f = result.faces.detach().long().cpu().numpy()
    return trimesh.Trimesh(vertices=np.asarray(v, dtype=np.float64), faces=f, process=False)
