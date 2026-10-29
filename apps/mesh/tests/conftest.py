import io
import zipfile

import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient

from app.main import app

AUTH = {"Authorization": "Bearer dev-mesh-service-token"}


@pytest.fixture()
def client():
    return TestClient(app)


def stl(mesh: trimesh.Trimesh) -> bytes:
    return mesh.export(file_type="stl")


@pytest.fixture()
def cube():
    return trimesh.creation.box((20, 20, 20))


@pytest.fixture()
def sphere_with_hole():
    s = trimesh.creation.icosphere(subdivisions=2, radius=15)
    s.update_faces(np.arange(len(s.faces)) > 3)  # drop four faces
    s.remove_unreferenced_vertices()
    return s


@pytest.fixture()
def flipped_cube():
    b = trimesh.creation.box((20, 20, 20))
    b.invert()
    return b


@pytest.fixture()
def nonmanifold():
    b = trimesh.creation.box((20, 20, 20))
    # A fin: one extra triangle sharing an existing edge makes that edge non-manifold.
    e = b.edges_unique[0]
    v = np.vstack([b.vertices, [[30, 30, 30]]])
    f = np.vstack([b.faces, [[e[0], e[1], len(v) - 1]]])
    return trimesh.Trimesh(vertices=v, faces=f, process=False)


def zip_3mf(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()
