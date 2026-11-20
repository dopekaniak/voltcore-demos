"""Command line entry point.

Usage:
    python -m text_to_cad "make me a hook that mounts under my desk and holds my headphones"
    python -m text_to_cad "gear with 24 teeth" --out output/gear.stl
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import models
from .spec import UnsupportedRequest, parse

BUILDERS = {
    "hook": models.wall_hook,
    "stand": models.stand,
    "clip": models.cable_clip,
    "gear": models.spur_gear,
}

DEFAULT_OUT_DIR = Path(__file__).resolve().parent / "output"


def build(text: str, out_path: Path | None = None):
    """Parse text, build the part, export STL, and return (path, mesh, spec)."""
    spec = parse(text)
    mesh = BUILDERS[spec.kind](**spec.params)
    if out_path is None:
        DEFAULT_OUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = DEFAULT_OUT_DIR / f"{spec.kind}.stl"
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(out_path)
    return out_path, mesh, spec


def check_report(mesh) -> list[str]:
    """Geometry-only checks. These do not cover overhangs or wall analysis."""
    lines = []
    size = mesh.bounding_box.extents
    lines.append(f"size mm      : {size[0]:.1f} x {size[1]:.1f} x {size[2]:.1f}")
    lines.append(f"triangles    : {len(mesh.faces)}")
    lines.append(f"watertight   : {'yes' if mesh.is_watertight else 'NO'}")
    lines.append(f"volume cm^3  : {mesh.volume / 1000:.2f}")
    return lines


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="text_to_cad", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("request", help="plain-English description of the part")
    ap.add_argument("--out", type=Path, default=None, help="output STL path")
    args = ap.parse_args(argv)

    try:
        path, mesh, spec = build(args.request, args.out)
    except UnsupportedRequest as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    print(f"part         : {spec.kind} {spec.params}")
    for note in spec.notes:
        print(f"note         : {note}")
    for line in check_report(mesh):
        print(line)
    print(f"written      : {path}")
    if not mesh.is_watertight:
        print("error: mesh is not watertight; do not print without fixing", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
