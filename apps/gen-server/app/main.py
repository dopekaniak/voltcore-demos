"""Generation server: our own text-to-3D and image-to-3D service, run on a GPU machine we rent.

The platform's `selfhost` provider calls it. Every route except /health needs the bearer token.
Images are fetched only from hosts in GEN_ALLOWED_IMAGE_HOSTS (our storage), never from a host a
caller names freely, and are size-checked before decoding.
"""
from __future__ import annotations

import hmac
import io
import os
import random
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

from .engines import load_engine
from .tasks import Task, TaskStore

DEV_TOKEN = "dev-gen-server-token"
ENGINE = os.environ.get("GEN_ENGINE", "test")
TOKEN = os.environ.get("GEN_SERVER_TOKEN", DEV_TOKEN)
if ENGINE != "test" and (TOKEN == DEV_TOKEN or len(TOKEN) < 24):
    raise SystemExit("GEN_SERVER_TOKEN must be set to a random value of 24+ characters when GEN_ENGINE is not 'test'")
ALLOWED_IMAGE_HOSTS = {h.strip().lower() for h in os.environ.get("GEN_ALLOWED_IMAGE_HOSTS", "").split(",") if h.strip()}
MAX_IMAGE_BYTES = int(os.environ.get("GEN_MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))
MAX_QUEUE = int(os.environ.get("GEN_MAX_QUEUE", "50"))
FILE_TYPES = {"glb": "model/gltf-binary", "stl": "model/stl", "obj": "text/plain"}

app = FastAPI(title="gen-server", docs_url=None, redoc_url=None, openapi_url=None)
store = TaskStore(Path(os.environ.get("GEN_DATA_DIR", "./var/gen")), load_engine(ENGINE), keep_days=float(os.environ.get("GEN_KEEP_DAYS", "7")))


def require_token(authorization: str = Header(default="")) -> None:
    if not hmac.compare_digest(authorization.encode(), f"Bearer {TOKEN}".encode()):
        raise HTTPException(status_code=401, detail="invalid token")


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


class CreateTask(BaseModel):
    kind: Literal["text", "image", "refine"]
    prompt: str | None = Field(default=None, max_length=1000)
    image_url: str | None = Field(default=None, max_length=4000)
    parent_id: str | None = Field(default=None, max_length=64)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    quality: Literal["draft", "high"] = "draft"
    size_mm: float = Field(default=80, ge=5, le=400)
    remove_background: bool = True
    idempotency_key: str | None = Field(default=None, max_length=200)


def serialize(t: Task) -> dict:
    out = {"id": t.id, "status": t.status, "progress": t.progress, "error": t.error, "stats": t.stats, "outputs": {}}
    if t.status == "QUEUED":
        out["queue_position"] = store.queue_position(t.id)
    if t.status == "SUCCEEDED":
        out["outputs"] = {fmt: f"/v1/tasks/{t.id}/files/{fmt}" for fmt in FILE_TYPES}
    return out


def fetch_image(url: str) -> bytes:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in ALLOWED_IMAGE_HOSTS:
        raise HTTPException(422, "image_url host is not allowed")
    with httpx.Client(timeout=30, follow_redirects=False) as c, c.stream("GET", url) as r:
        if r.status_code != 200:
            raise HTTPException(422, f"could not fetch the image ({r.status_code})")
        buf = bytearray()
        for chunk in r.iter_bytes():
            buf += chunk
            if len(buf) > MAX_IMAGE_BYTES:
                raise HTTPException(422, "image is too large")
    return bytes(buf)


def normalize_image(data: bytes) -> bytes:
    try:
        Image.MAX_IMAGE_PIXELS = 40_000_000
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, "the file is not a readable image") from e
    img.thumbnail((1024, 1024))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "engine": ENGINE, "queued": sum(1 for t in store.tasks.values() if t.status == "QUEUED")}


@app.post("/v1/tasks", dependencies=[Depends(require_token)], status_code=201)
def create_task(body: CreateTask, response: Response):
    if body.idempotency_key and body.idempotency_key in store.by_key:
        response.status_code = 200
        return serialize(store.tasks[store.by_key[body.idempotency_key]])
    if sum(1 for t in store.tasks.values() if t.status == "QUEUED") >= MAX_QUEUE:
        return error(503, "QUEUE_FULL", "The generation queue is full; try again shortly.")
    seed = body.seed if body.seed is not None else random.randrange(2**31)
    image: bytes | None = None
    if body.kind == "text":
        if not body.prompt or not body.prompt.strip():
            return error(422, "VALIDATION_FAILED", "prompt is required")
        t = Task(id="", kind="text", quality=body.quality, seed=seed, size_mm=body.size_mm, prompt=body.prompt.strip())
    elif body.kind == "image":
        if not body.image_url:
            return error(422, "VALIDATION_FAILED", "image_url is required")
        image = normalize_image(fetch_image(body.image_url))
        t = Task(id="", kind="image", quality=body.quality, seed=seed, size_mm=body.size_mm, remove_background=body.remove_background)
    else:
        parent = store.get(body.parent_id or "")
        if not parent:
            return error(404, "NOT_FOUND", "parent task not found")
        if parent.status != "SUCCEEDED":
            return error(409, "PARENT_NOT_READY", "the parent task has not succeeded")
        # A refine re-runs the parent's input and seed at high quality, so the shape stays close.
        if parent.kind == "image":
            image = (store.dir(parent.id) / "input.png").read_bytes()
        t = Task(id="", kind=parent.kind, quality="high", seed=parent.seed, size_mm=body.size_mm if "size_mm" in body.model_fields_set else parent.size_mm, prompt=parent.prompt, remove_background=parent.remove_background, parent_id=parent.id)
    t.idempotency_key = body.idempotency_key
    task, created = store.create(t, image)
    if not created:
        response.status_code = 200
    return serialize(task)


@app.get("/v1/tasks/{task_id}", dependencies=[Depends(require_token)])
def get_task(task_id: str):
    t = store.get(task_id)
    return serialize(t) if t else error(404, "NOT_FOUND", "task not found")


@app.post("/v1/tasks/{task_id}/cancel", dependencies=[Depends(require_token)])
def cancel_task(task_id: str):
    t = store.request_cancel(task_id)
    return serialize(t) if t else error(404, "NOT_FOUND", "task not found")


@app.get("/v1/tasks/{task_id}/files/{fmt}", dependencies=[Depends(require_token)])
def task_file(task_id: str, fmt: str):
    t = store.get(task_id)
    if not t or t.status != "SUCCEEDED" or fmt not in FILE_TYPES:
        return error(404, "NOT_FOUND", "file not found")
    return FileResponse(store.dir(t.id) / f"model.{fmt}", media_type=FILE_TYPES[fmt], filename=f"model.{fmt}")


@app.post("/v1/admin/prune", dependencies=[Depends(require_token)])
def prune():
    return {"removed": store.prune()}
