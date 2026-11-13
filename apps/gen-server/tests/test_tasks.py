import io

import trimesh
from PIL import Image

import app.main as main
from tests.conftest import AUTH, wait


def test_health_needs_no_token(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["engine"] == "test"


def test_routes_need_the_token(client):
    assert client.post("/v1/tasks", json={"kind": "text", "prompt": "vase"}).status_code == 401
    assert client.get("/v1/tasks/gt_x", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_text_task_makes_print_ready_files(client):
    r = client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "a tall vase", "seed": 7, "size_mm": 90})
    assert r.status_code == 201
    t = wait(client, r.json()["id"])
    assert t["status"] == "SUCCEEDED", t
    assert set(t["outputs"]) == {"glb", "stl", "obj"}
    assert max(t["stats"]["bbox_mm"]) == 90
    stl = client.get(t["outputs"]["stl"], headers=AUTH)
    assert stl.status_code == 200
    mesh = trimesh.load(io.BytesIO(stl.content), file_type="stl")
    assert abs(mesh.bounds[0][2]) < 1e-6  # sits on the bed
    assert abs(max(mesh.extents) - 90) < 1e-3
    glb = client.get(t["outputs"]["glb"], headers=AUTH)
    assert glb.content[:4] == b"glTF"


def test_same_prompt_and_seed_give_the_same_mesh(client):
    a = wait(client, client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "chess rook", "seed": 3}).json()["id"])
    b = wait(client, client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "chess rook", "seed": 3}).json()["id"])
    assert client.get(a["outputs"]["stl"], headers=AUTH).content == client.get(b["outputs"]["stl"], headers=AUTH).content


def test_idempotency_key_returns_the_first_task(client):
    body = {"kind": "text", "prompt": "ring", "idempotency_key": "job_123"}
    first = client.post("/v1/tasks", headers=AUTH, json=body)
    again = client.post("/v1/tasks", headers=AUTH, json=body)
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"]


def test_refine_reuses_seed_at_high_quality(client):
    p = wait(client, client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "ball", "seed": 11}).json()["id"])
    r = client.post("/v1/tasks", headers=AUTH, json={"kind": "refine", "parent_id": p["id"]})
    assert r.status_code == 201
    t = wait(client, r.json()["id"])
    assert t["status"] == "SUCCEEDED"
    task = main.store.get(t["id"])
    assert task.quality == "high" and task.seed == 11 and task.prompt == "ball"
    assert t["stats"]["triangles"] > p["stats"]["triangles"]


def test_refine_of_unknown_or_unfinished_parent(client):
    assert client.post("/v1/tasks", headers=AUTH, json={"kind": "refine", "parent_id": "gt_nope"}).status_code == 404


def test_text_needs_a_prompt(client):
    r = client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "  "})
    assert r.status_code == 422


def test_image_host_must_be_allowed(client):
    r = client.post("/v1/tasks", headers=AUTH, json={"kind": "image", "image_url": "http://169.254.169.254/latest/meta-data"})
    assert r.status_code == 422
    r = client.post("/v1/tasks", headers=AUTH, json={"kind": "image", "image_url": "file:///etc/passwd"})
    assert r.status_code == 422


def test_image_task(client, monkeypatch):
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 40, 40)).save(buf, format="PNG")
    seen = {}

    def fake_fetch(url):
        seen["url"] = url
        return buf.getvalue()

    monkeypatch.setattr(main, "fetch_image", fake_fetch)
    r = client.post("/v1/tasks", headers=AUTH, json={"kind": "image", "image_url": "https://files.example.test/u/1.png"})
    assert r.status_code == 201
    t = wait(client, r.json()["id"])
    assert t["status"] == "SUCCEEDED"
    assert seen["url"].startswith("https://files.example.test/")


def test_not_an_image_is_rejected(client, monkeypatch):
    monkeypatch.setattr(main, "fetch_image", lambda url: b"not an image")
    r = client.post("/v1/tasks", headers=AUTH, json={"kind": "image", "image_url": "https://files.example.test/x"})
    assert r.status_code == 422


def test_cancel_a_queued_task(client, monkeypatch):
    # Hold the worker so the next task stays queued.
    import threading

    gate = threading.Event()
    real = main.store.engine.text

    def slow(*a, **kw):
        gate.wait(5)
        return real(*a, **kw)

    monkeypatch.setattr(main.store.engine, "text", slow)
    first = client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "box"}).json()
    second = client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "box"}).json()
    assert client.get(f"/v1/tasks/{second['id']}", headers=AUTH).json()["status"] == "QUEUED"
    c = client.post(f"/v1/tasks/{second['id']}/cancel", headers=AUTH).json()
    assert c["status"] == "CANCELED"
    gate.set()
    assert wait(client, first["id"])["status"] == "SUCCEEDED"
    assert client.get(f"/v1/tasks/{second['id']}/files/stl", headers=AUTH).status_code == 404


def test_engine_failure_fails_the_task_not_the_server(client, monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError("CUDA out of memory")

    monkeypatch.setattr(main.store.engine, "text", boom)
    t = wait(client, client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "x"}).json()["id"])
    assert t["status"] == "FAILED" and "out of memory" in t["error"]["message"]
    monkeypatch.undo()
    t = wait(client, client.post("/v1/tasks", headers=AUTH, json={"kind": "text", "prompt": "x"}).json()["id"])
    assert t["status"] == "SUCCEEDED"
