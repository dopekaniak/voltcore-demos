"""Parametric part templates. All dimensions are millimetres.

Each builder returns a watertight trimesh.Trimesh ready for STL export.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from trimesh.creation import box, cylinder


def _box(size, center):
    m = box(extents=size)
    m.apply_translation(center)
    return m


def _cyl_z(radius, height, center):
    m = cylinder(radius=radius, height=height, sections=64)
    m.apply_translation(center)
    return m


def _cyl_y(radius, length, center):
    m = cylinder(radius=radius, height=length, sections=64)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
    m.apply_translation(center)
    return m


def _cyl_x(radius, length, center):
    m = cylinder(radius=radius, height=length, sections=64)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [0, 1, 0]))
    m.apply_translation(center)
    return m


def _union(meshes):
    return trimesh.boolean.union(meshes, engine="manifold")


def _difference(base, cutters):
    return trimesh.boolean.difference([base, *cutters], engine="manifold")


def wall_hook(width=40.0, thickness=5.0, mount_height=50.0, reach=60.0,
              tip_drop=20.0, screw_diameter=4.2):
    """Wall/desk-mounted hook: vertical plate on the wall (y=0 face),
    horizontal arm reaching out along +y, and a downturned tip to hang from.

    Coordinates: wall face at y=0, arm extends toward +y, z is up.
    """
    if min(width, thickness, mount_height, reach, tip_drop) <= 0:
        raise ValueError("all hook dimensions must be positive")
    if tip_drop >= mount_height:
        raise ValueError("tip_drop must be shorter than mount_height")

    t = thickness
    plate = _box((width, t, mount_height), (0, t / 2, mount_height / 2))
    arm = _box((width, reach, t), (0, t + reach / 2, mount_height - t / 2))
    tip = _box((width, t, tip_drop), (0, t + reach - t / 2, mount_height - tip_drop / 2))
    body = _union([plate, arm, tip])

    holes = []
    for x in (-width / 4, width / 4):
        for z in (mount_height * 0.3, mount_height * 0.6):
            holes.append(_cyl_y(screw_diameter / 2, t + 2, (x, t / 2, z)))
    return _difference(body, holes)


def stand(width=80.0, depth=60.0, height=70.0, thickness=5.0, lip=8.0):
    """Upright stand: flat base, back wall, and a front lip to stop a
    controller or phone from sliding off."""
    if min(width, depth, height, thickness, lip) <= 0:
        raise ValueError("all stand dimensions must be positive")
    t = thickness
    base = _box((width, depth, t), (0, depth / 2, t / 2))
    back = _box((width, t, height), (0, t / 2, height / 2))
    front_lip = _box((width, t, lip), (0, depth - t / 2, t + lip / 2))
    return _union([base, back, front_lip])


def cable_clip(cable_diameter=8.0, wall=2.0, base_width=12.0, base_thickness=3.0,
               slot_ratio=0.7):
    """Snap-in cable clip: a ring with a slot on top, on a flat base."""
    if min(cable_diameter, wall, base_width, base_thickness) <= 0:
        raise ValueError("all clip dimensions must be positive")
    if not 0 < slot_ratio < 1:
        raise ValueError("slot_ratio must be between 0 and 1")

    r_in = cable_diameter / 2
    r_out = r_in + wall
    zc = base_thickness + r_out  # ring centre height
    length = base_width

    ring = _cyl_x(r_out, length, (0, 0, zc))
    base = _box((length, 2 * r_out, base_thickness), (0, 0, base_thickness / 2))
    bore = _cyl_x(r_in, length + 2, (0, 0, zc))
    slot_w = cable_diameter * slot_ratio
    slot = _box((length + 2, slot_w, r_out + 1), (0, 0, zc + (r_out + 1) / 2))
    return _difference(_union([ring, base]), [bore, slot])


def spur_gear(teeth=16, module=2.0, face_width=10.0, bore_diameter=5.0):
    """Simple spur gear: a body with rectangular teeth (not true involute).

    module is the tooth size in mm; pitch diameter = teeth * module.
    """
    if teeth < 6:
        raise ValueError("gear needs at least 6 teeth")
    if min(module, face_width, bore_diameter) <= 0:
        raise ValueError("module, face_width and bore_diameter must be positive")

    pitch_r = teeth * module / 2
    root_r = pitch_r - 1.25 * module
    tip_r = pitch_r + module
    body = _cyl_z(root_r, face_width, (0, 0, face_width / 2))

    tooth_w = module * 0.9
    start = root_r - 0.2 * module  # overlap into the body for a clean union
    length = tip_r - start
    mid = (start + tip_r) / 2
    parts = [body]
    for k in range(teeth):
        angle = 2 * math.pi * k / teeth
        t = _box((tooth_w, length, face_width), (0, mid, face_width / 2))
        t.apply_transform(trimesh.transformations.rotation_matrix(
            angle - math.pi / 2, [0, 0, 1]))
        # Tooth centre sits at radius `mid` on +y before this rotation. Turning
        # it by (angle - pi/2) about z places it at direction `angle` from +x.
        parts.append(t)
    gear = _union(parts)
    bore = _cyl_z(bore_diameter / 2, face_width + 2, (0, 0, face_width / 2))
    return _difference(gear, [bore])
