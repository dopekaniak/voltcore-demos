# Generation server

Our own text-to-3D and photo-to-3D service. The platform's `selfhost` provider calls it. It
returns print-ready shapes (STL, OBJ, GLB) in millimetres, sitting on the bed, with floaters
removed. It makes shapes only, no textures (ADR-044).

Two engines:

| `GEN_ENGINE` | Needs | What it does |
| --- | --- | --- |
| `test` | nothing | Simple deterministic shapes picked from keywords. For development, CI and E2E. It does not understand prompts. |
| `trellis` | NVIDIA GPU, 16 GB+ memory | The open TRELLIS models (MIT). Real text-to-3D and photo-to-3D. |

## Run it locally (no GPU)

`scripts/dev-up.sh` starts it on port 8100 with the test engine and points the API and worker at
it. On its own:

```sh
cd apps/gen-server
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
GEN_ENGINE=test .venv/bin/uvicorn app.main:app --port 8100
.venv/bin/pytest -q
```

## Run it for real on a rented GPU

Any provider that runs a Docker image on an NVIDIA GPU with 16 GB or more works (for example
RunPod, Vast.ai, Lambda, or a cloud VM). A 24 GB card (RTX 4090, A10G, L4, A5000) is a good fit.
The image has not been built or run on a GPU from this repository yet, so treat the first run
as a test.

1. Build and push the image from the repository root:

   ```sh
   docker build -f apps/gen-server/Dockerfile.gpu -t <registry>/gen-server:1 apps/gen-server
   docker push <registry>/gen-server:1
   ```

2. Start a GPU machine with that image. Settings:

   | Setting | Value |
   | --- | --- |
   | Port | 8100 (HTTP). Put it behind HTTPS (most GPU hosts give you an HTTPS proxy URL). |
   | Volume | mounted at `/data` (model weights about 10 GB, plus outputs) |
   | `GEN_SERVER_TOKEN` | a long random value: `openssl rand -hex 32` |
   | `GEN_ALLOWED_IMAGE_HOSTS` | the host of your file URLs, e.g. `printforge.example.com` (the host in `PUBLIC_FILES_BASE`) |
   | `GEN_ENGINE` | `trellis` (already the image default) |

   Optional: `GEN_TRELLIS_TEXT_MODEL` (default `microsoft/TRELLIS-text-large`; `-xlarge` is
   better and slower), `GEN_TRELLIS_IMAGE_MODEL` (default `microsoft/TRELLIS-image-large`),
   `GEN_KEEP_DAYS` (default 7), `GEN_MAX_QUEUE` (default 50).

3. Check it: `curl https://<gen-host>/health` should return `{"status":"ok","engine":"trellis",...}`.
   The first generation downloads the weights and takes several minutes; later ones take
   roughly tens of seconds on a 24 GB card (not measured yet).

4. Point the platform at it (API and worker environment):

   ```sh
   GEN_SERVER_URL=https://<gen-host>
   GEN_SERVER_TOKEN=<the same token>
   ```

   Restart the API and worker. The Generate page now lists "Studio shape (our own engine)".

## API

All routes except `/health` need `Authorization: Bearer $GEN_SERVER_TOKEN`.

| Route | Purpose |
| --- | --- |
| `POST /v1/tasks` | `{kind: text, prompt}`, `{kind: image, image_url}`, or `{kind: refine, parent_id}`; optional `seed`, `quality` (`draft`/`high`), `size_mm` (longest side, default 80), `idempotency_key`. Returns the task. A repeated `idempotency_key` returns the first task. |
| `GET /v1/tasks/:id` | `status` (QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELED), `progress`, `error`, `stats`, `outputs` |
| `POST /v1/tasks/:id/cancel` | Cancels a queued task now, a running one at its next check |
| `GET /v1/tasks/:id/files/{glb,stl,obj}` | Output files |
| `GET /health` | Engine name and queue length |

Refine re-runs the parent's prompt or photo with the same seed at high quality, so the shape
stays close to the preview with more detail. Tasks run one at a time. Finished tasks are kept
for `GEN_KEEP_DAYS`; tasks interrupted by a restart come back as FAILED so the platform can
release the credits.

## Licensing

See ADR-044. The image installs only the shape path. It does not install nvdiffrast,
diffoctreerast or diff-gaussian-rasterization, which are research or non-commercial only.
Do not add them without a new decision.
