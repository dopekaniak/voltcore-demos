import tempfile
import unittest
from pathlib import Path

import trimesh

from text_to_cad import models
from text_to_cad.cli import build, main
from text_to_cad.spec import UnsupportedRequest, parse


class ParseTests(unittest.TestCase):
    def test_hook_request(self):
        s = parse("make me a hook that mounts under my desk and holds my headphones")
        self.assertEqual(s.kind, "hook")
        self.assertEqual(s.params["reach"], 60.0)

    def test_hook_width_from_mm(self):
        self.assertEqual(parse("hook 30mm wide").params["width"], 30.0)

    def test_gear_teeth(self):
        self.assertEqual(parse("gear with 24 teeth").params["teeth"], 24)

    def test_gear_default_teeth_noted(self):
        s = parse("spur gear")
        self.assertEqual(s.params["teeth"], 16)
        self.assertTrue(s.notes)

    def test_clip_diameter(self):
        self.assertEqual(parse("cable clip for 6mm cable").params["cable_diameter"], 6.0)

    def test_stand(self):
        self.assertEqual(parse("controller stand 90mm wide").kind, "stand")

    def test_unsupported_rejected(self):
        with self.assertRaises(UnsupportedRequest):
            parse("make me a spaceship")

    def test_empty_rejected(self):
        with self.assertRaises(UnsupportedRequest):
            parse("   ")


class ModelTests(unittest.TestCase):
    def assertSolid(self, mesh):
        self.assertIsInstance(mesh, trimesh.Trimesh)
        self.assertTrue(mesh.is_watertight)
        self.assertGreater(mesh.volume, 0)

    def test_hook_reach_and_size(self):
        m = models.wall_hook(width=40, thickness=5, mount_height=50, reach=60, tip_drop=20)
        self.assertSolid(m)
        x, y, z = m.bounding_box.extents
        self.assertAlmostEqual(x, 40, places=3)
        self.assertAlmostEqual(y, 65, places=3)  # reach + thickness
        self.assertAlmostEqual(z, 50, places=3)

    def test_hook_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            models.wall_hook(width=0)
        with self.assertRaises(ValueError):
            models.wall_hook(mount_height=20, tip_drop=20)

    def test_stand_size(self):
        m = models.stand(width=80, depth=60, height=70)
        self.assertSolid(m)
        self.assertAlmostEqual(m.bounding_box.extents[0], 80, places=3)
        self.assertAlmostEqual(m.bounding_box.extents[2], 70, places=3)

    def test_cable_clip_is_solid(self):
        self.assertSolid(models.cable_clip(cable_diameter=8))

    def test_clip_rejects_bad_slot(self):
        with self.assertRaises(ValueError):
            models.cable_clip(slot_ratio=1.5)

    def test_gear_outer_diameter(self):
        m = models.spur_gear(teeth=24, module=2)
        self.assertSolid(m)
        # tip diameter = (teeth + 2) * module
        self.assertAlmostEqual(m.bounding_box.extents[0], 52, places=1)

    def test_gear_needs_teeth(self):
        with self.assertRaises(ValueError):
            models.spur_gear(teeth=4)


class CliTests(unittest.TestCase):
    def test_build_writes_stl(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "hook.stl"
            path, mesh, spec = build("hook for headphones", out)
            self.assertTrue(path.exists())
            reloaded = trimesh.load(path)
            self.assertTrue(reloaded.is_watertight)

    def test_main_ok_and_error_codes(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(main(["gear with 20 teeth", "--out", str(Path(d) / "g.stl")]), 0)
        self.assertEqual(main(["make me a spaceship"]), 2)


if __name__ == "__main__":
    unittest.main()
