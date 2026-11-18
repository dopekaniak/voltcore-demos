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

You need a machine with an NVIDIA GPU and 16 GB or more of GPU memory. A 24 GB card (RTX 4090,
RTX A5000, L4, A10G) is a good fit. The steps below use RunPod; any host that gives you a GPU,
a terminal, and a public HTTPS port works the same way. No Docker build is needed.

### 1. Create the machine (RunPod)

1. Sign up at runpod.io and add a payment method (pods bill by the second while running).
2. **Pods → Deploy.** Pick a GPU with 24 GB (for example RTX 4090 or RTX A5000).
3. Template: **RunPod PyTorch 2.4** (`runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`).
4. **Edit template:** container disk 30 GB, volume disk 50 GB mounted at `/workspace`, and add
   `8100` to **Expose HTTP Ports**.
5. Deploy and wait until it shows Running.

### 2. Install and start the server (one command)

Open the pod's **Web Terminal** (Connect → Start Web Terminal) and paste, with your own values:

```sh
export GEN_SERVER_TOKEN=$(openssl rand -hex 32); echo "Save this token: $GEN_SERVER_TOKEN"
export GEN_ALLOWED_IMAGE_HOSTS=printforge.example.com   # your website's host, for photo-to-3D
curl -fsSL https://raw.githubusercontent.com/dopekaniak/voltcore-demos/ccr-5785bc1b-xegcjt/apps/gen-server/setup-gpu.sh | bash
```

The first run takes 10-15 minutes. It ends with `running: {"status":"ok","engine":"trellis",...}`
and the public address, `https://<pod-id>-8100.proxy.runpod.net`. Save the token it printed.

After the pod restarts, run the same command with the same token; it skips the install and only
starts the server. Everything lives in `/workspace/printforge`; the log is `server.log` there.

### 3. Test it

From any computer with the token:

```sh
GEN_SERVER_TOKEN=<token> apps/gen-server/smoke.sh https://<pod-id>-8100.proxy.runpod.net "a small round vase"
```

The first generation downloads the model weights (about 4 GB for text, 3 GB more for photos)
and takes about a minute. Measured on an NVIDIA L40S (2026-11-18), once loaded:

| Task | Time | Result |
| --- | --- | --- |
| Text preview | 5 s | 150,000 triangles, watertight |
| Refine (high detail) | 10-12 s | 400,000 triangles, watertight |
| Photo to 3D | about 25 s | 150,000 triangles, watertight |

All results passed the mesh service's printability check (watertight, manifold, no
non-manifold edges). A 24 GB card should be somewhat slower; not yet measured.

### 4. Connect the website

In the API and worker environment:

```sh
GEN_SERVER_URL=https://<pod-id>-8100.proxy.runpod.net
GEN_SERVER_TOKEN=<the same token>
```

Restart the API and worker. Generate now lists "Studio shape (our own engine)".

### Notes

- RunPod's proxy closes a request after 100 seconds. The server answers every request at once
  and does the work in the background, so this limit does not affect it.
- Stop the pod when you are not using it; a stopped pod keeps `/workspace` and costs only storage.
- A Docker image is also available (`Dockerfile.gpu`) for hosts that run images directly.

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
