"""Turn a plain-English request into a part template and its parameters.

This is deliberately rule-based: it only knows the templates in models.py.
It never guesses a shape it cannot build.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

SUPPORTED = {
    "hook": "wall/desk hook for hanging things (e.g. headphones)",
    "stand": "upright stand or holder (e.g. for a controller or phone)",
    "clip": "snap-in cable clip",
    "gear": "spur gear with a set number of teeth",
}


class UnsupportedRequest(ValueError):
    """Raised when the text does not match any template this tool can build."""


@dataclass
class PartSpec:
    kind: str
    params: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


_MM = re.compile(r"(\d+(?:\.\d+)?)\s*mm\b")
_TEETH = re.compile(r"(\d+)\s*teeth\b")


def _first_mm(text):
    m = _MM.search(text)
    return float(m.group(1)) if m else None


def parse(text: str) -> PartSpec:
    if not text or not text.strip():
        raise UnsupportedRequest("empty request")
    s = text.lower()

    if "gear" in s:
        spec = PartSpec("gear")
        m = _TEETH.search(s)
        if m:
            spec.params["teeth"] = int(m.group(1))
        else:
            spec.params["teeth"] = 16
            spec.notes.append("no tooth count given; using 16")
        return spec

    if "clip" in s:
        spec = PartSpec("clip")
        diameter = _first_mm(s)
        if diameter is not None:
            spec.params["cable_diameter"] = diameter
        else:
            spec.notes.append("no cable diameter given; using 8 mm")
        return spec

    if "stand" in s or "holder" in s:
        spec = PartSpec("stand")
        width = _first_mm(s)
        if width is not None:
            spec.params["width"] = width
        return spec

    if "hook" in s or "mount" in s or "headphone" in s:
        spec = PartSpec("hook")
        width = _first_mm(s)
        if width is not None:
            spec.params["width"] = width
        if "headphone" in s:
            spec.params.setdefault("reach", 60.0)
            spec.notes.append("sized for headphones (60 mm reach)")
        return spec

    raise UnsupportedRequest(
        "I can only build: " + "; ".join(f"{k} ({v})" for k, v in SUPPORTED.items())
        + ". Your request did not match any of them."
    )
