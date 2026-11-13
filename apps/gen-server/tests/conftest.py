import os
import tempfile

os.environ["GEN_ENGINE"] = "test"
os.environ["GEN_TEST_DELAY_S"] = "0"
os.environ["GEN_DATA_DIR"] = tempfile.mkdtemp(prefix="gen-test-")
os.environ["GEN_ALLOWED_IMAGE_HOSTS"] = "files.example.test"

import time  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

AUTH = {"Authorization": "Bearer dev-gen-server-token"}


@pytest.fixture()
def client():
    return TestClient(app)


def wait(client, task_id, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        t = client.get(f"/v1/tasks/{task_id}", headers=AUTH).json()
        if t["status"] in ("SUCCEEDED", "FAILED", "CANCELED"):
            return t
        time.sleep(0.05)
    raise AssertionError(f"task {task_id} did not finish")
