"""Shapewright mesh service (internal only). Analyze, repair, convert, remesh, samples.

No slicer is linked or called here (rule 6, ADR-002b). Every route except /health needs the
service token. Request bodies are raw file bytes; `format` names the input format.
"""
from __future__ import annotations

import base64
import hmac
import json
import os

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from .analysis import analyze, remesh, repair
from .formats import FORMATS, Limits, MeshRejected, export_mesh, load_mesh
from .samples import SAMPLES, sample

SERVICE_TOKEN = os.environ.get("MESH_SERVICE_TOKEN", "dev-mesh-service-token")

app = FastAPI(title="shapewright-mesh", docs_url=None, redoc_url=None, openapi_url=None)


def require_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {SERVICE_TOKEN}"
    if not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid service token")


@app.exception_handler(MeshRejected)
async def rejected(_req: Request, exc: MeshRejected) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": {"code": exc.code, "message": exc.message}})


def _volume(v: str) -> tuple[float, float, float]:
    parts = [float(x) for x in v.split("x")]
    if len(parts) != 3:
        raise HTTPException(400, "build_volume must be WxDxH")
    return parts[0], parts[1], parts[2]


def _report_header(report: dict) -> str:
    return base64.b64encode(json.dumps(report).encode()).decode()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "slicer": "none"}


@app.get("/whoami", dependencies=[Depends(require_token)])
def whoami() -> dict:
    return {"service": "mesh"}


@app.post("/analyze", dependencies=[Depends(require_token)])
async def analyze_route(request: Request, format: str = Query(...), build_volume: str = "256x256x256", scale_pct: float = 100.0, max_bytes: int | None = None) -> dict:
    data = await request.body()
    limits = Limits(max_bytes=max_bytes) if max_bytes else Limits()
    mesh = load_mesh(data, format, limits)
    return analyze(mesh, _volume(build_volume), scale_pct)


@app.post("/repair", dependencies=[Depends(require_token)])
async def repair_route(request: Request, format: str = Query(...), to: str = "stl", build_volume: str = "256x256x256") -> Response:
    mesh = load_mesh(await request.body(), format)
    before = analyze(mesh, _volume(build_volume))
    fixed, actions = repair(mesh)
    after = analyze(fixed, _volume(build_volume))
    report = {"before": before, "after": after, "actions": actions}
    return Response(export_mesh(fixed, to), media_type="application/octet-stream", headers={"X-Mesh-Report": _report_header(report)})


@app.post("/convert", dependencies=[Depends(require_token)])
async def convert_route(request: Request, format: str = Query(...), to: str = Query(...)) -> Response:
    if to not in FORMATS:
        raise HTTPException(400, "unsupported target format")
    mesh = load_mesh(await request.body(), format)
    return Response(export_mesh(mesh, to), media_type="application/octet-stream")


@app.post("/remesh", dependencies=[Depends(require_token)])
async def remesh_route(request: Request, format: str = Query(...), target_faces: int = Query(..., ge=100, le=2_000_000), to: str = "glb") -> Response:
    mesh = load_mesh(await request.body(), format)
    out, actions = remesh(mesh, target_faces)
    report = {"actions": actions, "after": analyze(out)}
    return Response(export_mesh(out, to), media_type="application/octet-stream", headers={"X-Mesh-Report": _report_header(report)})


@app.get("/samples/{name}", dependencies=[Depends(require_token)])
def sample_route(name: str, format: str = "glb", textured: bool = False) -> Response:
    if name not in SAMPLES or format not in FORMATS:
        raise HTTPException(404, "no such sample")
    return Response(export_mesh(sample(name, textured), format), media_type="application/octet-stream")
