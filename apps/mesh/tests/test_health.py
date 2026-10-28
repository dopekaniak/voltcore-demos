from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["slicer"] == "none"


def test_token_required():
    assert client.get("/whoami").status_code == 401
    r = client.get("/whoami", headers={"Authorization": "Bearer dev-mesh-service-token"})
    assert r.status_code == 200
