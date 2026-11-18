#!/usr/bin/env bash
# Install and start the PrintForge generation server on a fresh NVIDIA GPU machine, without
# Docker. Written for RunPod's "PyTorch 2.4" template
# (runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04); any Ubuntu 22.04 machine with an
# NVIDIA driver, Python 3.10 or 3.11, and 16 GB+ of GPU memory should work.
#
# Usage (in the machine's terminal):
#   export GEN_SERVER_TOKEN=<long random value>        # the same value goes in the website's settings
#   export GEN_ALLOWED_IMAGE_HOSTS=<your site's host>  # for photo-to-3D, e.g. printforge.example.com
#   curl -fsSL https://raw.githubusercontent.com/dopekaniak/voltcore-demos/ccr-5785bc1b-xegcjt/apps/gen-server/setup-gpu.sh | bash
#
# Everything goes under /workspace/printforge (RunPod keeps /workspace across restarts), so a
# second run skips what is already installed and just starts the server. The model weights
# (about 10 GB) download on the first generation.
#
# Licensing (ADR-044): installs the TRELLIS shape path only. nvdiffrast, diffoctreerast and
# diff-gaussian-rasterization (research or non-commercial licenses) are deliberately not installed.
set -euo pipefail

: "${GEN_SERVER_TOKEN:?Set GEN_SERVER_TOKEN first (24+ random characters, e.g. openssl rand -hex 32)}"
REPO="${REPO:-https://github.com/dopekaniak/voltcore-demos.git}"
BRANCH="${BRANCH:-ccr-5785bc1b-xegcjt}"
TRELLIS_COMMIT=193e0502b5cb3eb5997ec457d5340e95d09b158e
ROOT="${ROOT:-/workspace/printforge}"
PORT="${PORT:-8100}"
mkdir -p "$ROOT" && cd "$ROOT"
log() { echo "[printforge] $*"; }

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || { echo "No NVIDIA GPU found"; exit 1; }
PY=$(command -v python3.11 || command -v python3.10 || command -v python3)

if [ ! -d src ]; then
  log "downloading PrintForge ($BRANCH)"
  git clone --depth 1 -b "$BRANCH" "$REPO" src
else
  log "updating PrintForge"
  git -C src pull --ff-only || true
fi

if [ ! -d trellis ]; then
  log "downloading TRELLIS (pinned ${TRELLIS_COMMIT:0:12})"
  git clone https://github.com/microsoft/TRELLIS.git trellis
  git -C trellis checkout "$TRELLIS_COMMIT"
  git -C trellis submodule update --init trellis/representations/mesh/flexicubes
fi

if [ ! -x venv/bin/python ]; then
  log "installing GPU packages (10-15 minutes the first time)"
  "$PY" -m venv venv
  venv/bin/pip install -q --upgrade pip wheel
  # PyTorch 2.4.0 built for CUDA 12.1 runs on CUDA 12.x drivers and has matching wheels for
  # xformers, kaolin and spconv (the versions TRELLIS's own setup script pins).
  venv/bin/pip install -q torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu121
  venv/bin/pip install -q xformers==0.0.27.post2 --index-url https://download.pytorch.org/whl/cu121
  venv/bin/pip install -q spconv-cu120
  venv/bin/pip install -q kaolin -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.4.0_cu121.html
  venv/bin/pip install -q pillow imageio easydict opencv-python-headless scipy ninja rembg onnxruntime trimesh open3d transformers safetensors huggingface_hub
  venv/bin/pip install -q git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8
  venv/bin/pip install -q -r src/apps/gen-server/requirements-gpu.txt
fi

log "checking the install"
PYTHONPATH="$ROOT/trellis" SPCONV_ALGO=native ATTN_BACKEND=xformers venv/bin/python -c "
import torch; assert torch.cuda.is_available(), 'CUDA is not available'
from trellis.pipelines import TrellisTextTo3DPipeline, TrellisImageTo3DPipeline
print('torch', torch.__version__, 'on', torch.cuda.get_device_name(0))
"

pkill -f "uvicorn app.main:app" 2>/dev/null || true
mkdir -p "$ROOT/data"
log "starting the server on port $PORT (log: $ROOT/server.log)"
cd src/apps/gen-server
nohup env PYTHONPATH="$ROOT/trellis" GEN_ENGINE=trellis GEN_DATA_DIR="$ROOT/data" HF_HOME="$ROOT/data/hf" \
  GEN_SERVER_TOKEN="$GEN_SERVER_TOKEN" GEN_ALLOWED_IMAGE_HOSTS="${GEN_ALLOWED_IMAGE_HOSTS:-}" \
  "$ROOT/venv/bin/uvicorn" app.main:app --host 0.0.0.0 --port "$PORT" > "$ROOT/server.log" 2>&1 &
for _ in $(seq 1 30); do
  if curl -fsS "localhost:$PORT/health" >/dev/null 2>&1; then
    log "running: $(curl -fsS "localhost:$PORT/health")"
    [ -n "${RUNPOD_POD_ID:-}" ] && log "public address: https://${RUNPOD_POD_ID}-${PORT}.proxy.runpod.net"
    exit 0
  fi
  sleep 2
done
log "the server did not start; last lines of the log:"; tail -30 "$ROOT/server.log"; exit 1
