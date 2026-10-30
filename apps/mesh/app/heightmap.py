"""Image → relief height map for customizers (addendum Module 4, slice B).

Grayscale conversion, square crop, resize to a documented grid, then 0..65535 samples
(light is high unless the customizer inverts it). EXIF is never read or returned.
"""
from __future__ import annotations

import io

from PIL import Image, ImageOps

from .formats import MeshRejected

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 40_000_000


def heightmap(data: bytes, grid: int = 48) -> dict:
    if len(data) > MAX_IMAGE_BYTES:
        raise MeshRejected("TOO_LARGE", "images must be 20 MB or smaller")
    if not (8 <= grid <= 256):
        raise MeshRejected("BAD_GRID", "grid must be between 8 and 256")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in ("PNG", "JPEG", "WEBP"):
            raise MeshRejected("UNSUPPORTED_FORMAT", "use a PNG, JPEG, or WebP image")
        img = ImageOps.exif_transpose(img)
    except MeshRejected:
        raise
    except Exception as e:  # decompression bombs and broken files
        raise MeshRejected("BAD_IMAGE", f"could not read the image: {e}") from e
    gray = ImageOps.fit(img.convert("L"), (grid, grid), method=Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    lo, hi = min(pixels), max(pixels)
    span = max(1, hi - lo)
    data_u16 = [round((p - lo) * 65535 / span) for p in pixels]
    return {"width": grid, "height": grid, "data": data_u16}
