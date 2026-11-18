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


def test_rebuild_turns_a_tangled_mesh_into_a_closed_solid():
    from app.postprocess import make_watertight

    # Two blocks that touch along one edge: that edge has four faces (non-manifold), the kind
    # of tangle generated meshes carry. The rebuild returns one closed solid of the same size.
    a = trimesh.creation.box((10, 10, 10))
    b = trimesh.creation.box((10, 10, 10))
    b.apply_translation([10, 10, 0])
    m = trimesh.util.concatenate([a, b])
    m.merge_vertices()
    assert not m.is_watertight
    r = make_watertight(m)
    assert r is not None and r.is_watertight and r.is_volume
    assert abs(r.extents[0] - 20) < 1.0 and abs(r.extents[2] - 10) < 1.0


def test_face_reduction_never_opens_a_closed_mesh():
    from app.postprocess import reduce_faces

    dense = trimesh.creation.icosphere(subdivisions=6, radius=20)
    out = reduce_faces(dense, 5_000)
    assert out.is_watertight
