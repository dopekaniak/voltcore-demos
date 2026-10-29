"""Golden meshes (build prompt 13): cube, sphere with a hole, flipped normals, non-manifold edge, zip bomb."""
import base64
import json

import trimesh

from app.formats import MAX_UNCOMPRESSED, MAX_ZIP_ENTRIES, Limits, MeshRejected, load_mesh
from tests.conftest import AUTH, stl, zip_3mf


def test_cube_is_printable(client, cube):
    r = client.post("/analyze?format=stl", content=stl(cube), headers=AUTH)
    assert r.status_code == 200
    a = r.json()
    assert a["watertight"] and a["manifold"] and a["winding_consistent"]
    assert not a["flipped_normals"]
    assert a["bbox_mm"] == [20.0, 20.0, 20.0]
    assert abs(a["volume_mm3"] - 8000) < 1e-3
    assert a["triangles"] == 12
    assert a["printable"] is True
    assert a["units_guess"] == "mm"


def test_sphere_with_hole_is_not_watertight_and_repairs(client, sphere_with_hole):
    data = stl(sphere_with_hole)
    a = client.post("/analyze?format=stl", content=data, headers=AUTH).json()
    assert a["watertight"] is False and a["boundary_edges"] > 0 and a["printable"] is False
    r = client.post("/repair?format=stl", content=data, headers=AUTH)
    report = json.loads(base64.b64decode(r.headers["x-mesh-report"]))
    assert report["after"]["watertight"] is True
    assert any("filled holes" in x for x in report["actions"])
    fixed = trimesh.load(trimesh.util.wrap_as_stream(r.content), file_type="stl", force="mesh")
    assert fixed.is_watertight


def test_flipped_normals_detected_and_fixed(client, flipped_cube):
    data = stl(flipped_cube)
    a = client.post("/analyze?format=stl", content=data, headers=AUTH).json()
    assert a["flipped_normals"] is True and a["printable"] is False
    report = json.loads(base64.b64decode(client.post("/repair?format=stl", content=data, headers=AUTH).headers["x-mesh-report"]))
    assert report["after"]["flipped_normals"] is False and report["after"]["printable"] is True


def test_non_manifold_edge_detected_and_removed(client, nonmanifold):
    data = stl(nonmanifold)
    a = client.post("/analyze?format=stl", content=data, headers=AUTH).json()
    assert a["nonmanifold_edges"] >= 1 and a["manifold"] is False
    report = json.loads(base64.b64decode(client.post("/repair?format=stl", content=data, headers=AUTH).headers["x-mesh-report"]))
    assert report["after"]["manifold"] is True


def test_zip_bomb_rejected():
    # Defaults are the spec's limits.
    assert MAX_UNCOMPRESSED == 500 * 1024 * 1024 and MAX_ZIP_ENTRIES == 5000
    bomb = zip_3mf({"3D/3dmodel.model": b"\0" * (4 * 1024 * 1024)})
    try:
        load_mesh(bomb, "3mf", Limits(max_uncompressed=1024 * 1024))
        raise AssertionError("expected rejection")
    except MeshRejected as e:
        assert e.code in ("ZIP_TOO_LARGE", "ZIP_RATIO")
    many = zip_3mf({f"f{i}.txt": b"x" for i in range(30)})
    try:
        load_mesh(many, "3mf", Limits(max_entries=20))
        raise AssertionError("expected rejection")
    except MeshRejected as e:
        assert e.code == "ZIP_TOO_MANY_ENTRIES"


def test_zip_bomb_rejected_over_http(client):
    bomb = zip_3mf({"3D/3dmodel.model": b"\0" * (6 * 1024 * 1024)})
    r = client.post("/analyze?format=3mf", content=bomb, headers=AUTH)
    assert r.status_code == 422 and r.json()["error"]["code"] == "ZIP_RATIO"


def test_bad_signatures(client, cube):
    assert client.post("/analyze?format=3mf", content=stl(cube), headers=AUTH).json()["error"]["code"] == "BAD_SIGNATURE"
    assert client.post("/analyze?format=stl", content=b"\x00" * 200, headers=AUTH).json()["error"]["code"] == "BAD_SIGNATURE"
    assert client.post("/analyze?format=obj", content=b"\x00\x01binary", headers=AUTH).json()["error"]["code"] == "BAD_SIGNATURE"
    assert client.post("/analyze?format=exe", content=b"MZ", headers=AUTH).json()["error"]["code"] == "UNSUPPORTED_FORMAT"


def test_triangle_cap(cube):
    try:
        load_mesh(stl(cube), "stl", Limits(max_triangles=5))
        raise AssertionError("expected rejection")
    except MeshRejected as e:
        assert e.code == "TOO_MANY_TRIANGLES"


def test_formats_round_trip(client, cube):
    for to in ("glb", "obj", "3mf"):
        out = client.post(f"/convert?format=stl&to={to}", content=stl(cube), headers=AUTH)
        assert out.status_code == 200
        back = client.post(f"/analyze?format={to}", content=out.content, headers=AUTH).json()
        assert back["watertight"] and back["bbox_mm"] == [20.0, 20.0, 20.0]


def test_too_big_for_build_volume_and_units(client):
    big = trimesh.creation.box((300, 20, 20))
    a = client.post("/analyze?format=stl", content=stl(big), headers=AUTH).json()
    assert a["fits_build_volume"] is False and a["printable"] is False
    tiny = trimesh.creation.box((0.05, 0.05, 0.05))
    assert client.post("/analyze?format=stl", content=stl(tiny), headers=AUTH).json()["units_guess"] == "m"
    scaled = client.post("/analyze?format=stl&scale_pct=50", content=stl(big), headers=AUTH).json()
    assert scaled["bbox_mm"][0] == 150.0 and scaled["fits_build_volume"] is True


def test_overhang_area(client):
    # A T shape: the cap's underside overhangs.
    stem = trimesh.creation.box((10, 10, 20))
    stem.apply_translation([0, 0, 10])
    cap = trimesh.creation.box((40, 10, 5))
    cap.apply_translation([0, 0, 22.5])
    t = trimesh.boolean.union([stem, cap], engine="manifold")
    a = client.post("/analyze?format=stl", content=stl(t), headers=AUTH).json()
    assert abs(a["overhang_area_mm2"] - 300) < 1


def test_remesh_reduces_faces(client):
    s = trimesh.creation.icosphere(subdivisions=4, radius=20)
    r = client.post("/remesh?format=stl&target_faces=500&to=stl", content=stl(s), headers=AUTH)
    report = json.loads(base64.b64decode(r.headers["x-mesh-report"]))
    assert report["after"]["triangles"] <= 600


def test_samples_are_deterministic_and_watertight(client):
    for name in ("vase", "mug", "gem", "blob", "tower"):
        a = client.get(f"/samples/{name}?format=stl", headers=AUTH)
        b = client.get(f"/samples/{name}?format=stl", headers=AUTH)
        assert a.status_code == 200 and a.content == b.content, name
        info = client.post("/analyze?format=stl", content=a.content, headers=AUTH).json()
        assert info["watertight"], name
    glb = client.get("/samples/vase?format=glb&textured=true", headers=AUTH)
    assert glb.content[:4] == b"glTF"


def test_requires_token(client, cube):
    assert client.post("/analyze?format=stl", content=stl(cube)).status_code == 401


def test_glb_is_y_up_and_round_trips_to_z_up(client):
    tall = trimesh.creation.box((10, 20, 40))
    glb = client.post("/convert?format=stl&to=glb", content=stl(tall), headers=AUTH).content
    raw = trimesh.load(trimesh.util.wrap_as_stream(glb), file_type="glb", force="mesh")
    ext = raw.bounds[1] - raw.bounds[0]
    assert round(float(ext[1])) == 40  # Y is up inside the GLB
    back = client.post("/analyze?format=glb", content=glb, headers=AUTH).json()
    assert back["bbox_mm"] == [10.0, 20.0, 40.0]
