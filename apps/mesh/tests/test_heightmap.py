import io

from PIL import Image

from tests.conftest import AUTH


def png(color_fn, size=(64, 64)) -> bytes:
    img = Image.new("L", size)
    img.putdata([color_fn(x, y) for y in range(size[1]) for x in range(size[0])])
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_heightmap_grid_and_range(client):
    r = client.post("/heightmap?grid=16", content=png(lambda x, y: x * 4), headers=AUTH)
    assert r.status_code == 200
    h = r.json()
    assert h["width"] == 16 and h["height"] == 16 and len(h["data"]) == 256
    assert min(h["data"]) == 0 and max(h["data"]) == 65535
    # left is dark (low), right is light (high)
    assert h["data"][0] < h["data"][15]


def test_heightmap_rejects_non_images(client):
    assert client.post("/heightmap", content=b"not an image", headers=AUTH).json()["error"]["code"] == "BAD_IMAGE"
    assert client.post("/heightmap?grid=4", content=png(lambda x, y: 0), headers=AUTH).json()["error"]["code"] == "BAD_GRID"
