import trimesh

from app.postprocess import export_all, prepare


def test_floaters_are_removed_and_model_sits_on_bed():
    main = trimesh.creation.icosphere(subdivisions=4, radius=1)
    speck = trimesh.creation.icosphere(subdivisions=0, radius=0.01)
    speck.apply_translation([3, 0, 0])
    p = prepare(trimesh.util.concatenate([main, speck]), size_mm=50, max_faces=100_000)
    assert p.stats["floaters_removed"] == 1
    assert abs(max(p.mesh.extents) - 50) < 1e-6
    assert abs(p.mesh.bounds[0][2]) < 1e-9
    assert p.stats["watertight"]


def test_dense_meshes_are_simplified():
    dense = trimesh.creation.icosphere(subdivisions=6, radius=1)  # ~82k faces
    p = prepare(dense, size_mm=40, max_faces=10_000)
    assert p.stats["triangles"] <= 11_000


def test_exports():
    files = export_all(trimesh.creation.box((10, 20, 30)))
    assert files["glb"][:4] == b"glTF"
    assert files["obj"].startswith(b"v ") or b"\nv " in files["obj"]
