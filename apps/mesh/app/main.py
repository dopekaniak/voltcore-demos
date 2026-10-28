"""Shapewright mesh service (internal only). Analyze, repair, convert, remesh.

No slicer is linked or called here (rule 6, ADR-002b).
"""
import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

SERVICE_TOKEN = os.environ.get("MESH_SERVICE_TOKEN", "dev-mesh-service-token")

app = FastAPI(title="shapewright-mesh", docs_url=None, redoc_url=None)


def require_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {SERVICE_TOKEN}"
    if not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid service token")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "slicer": "none"}


@app.get("/whoami", dependencies=[Depends(require_token)])
def whoami() -> dict:
    return {"service": "mesh"}
