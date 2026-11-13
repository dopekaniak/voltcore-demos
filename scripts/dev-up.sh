#!/usr/bin/env bash
# Start the local stack in the background (logs in var/logs). For E2E runs the mock
# provider latency is shortened.
cd "$(dirname "$0")/.."
mkdir -p var/logs
export MOCK_PROVIDER_LATENCY_MS="${MOCK_PROVIDER_LATENCY_MS:-300-800}" ESTIMATE_ORDERS="${ESTIMATE_ORDERS:-allow-dev}"
# Our own generation server with the test engine (no GPU): Generate runs the real provider path.
export GEN_SERVER_URL="${GEN_SERVER_URL:-http://localhost:8100}" GEN_SERVER_TOKEN="${GEN_SERVER_TOKEN:-dev-gen-server-token}"
start() { (setsid bash -c "$1" > "var/logs/$2.log" 2>&1 &); }
start "cd apps/mesh && .venv/bin/uvicorn app.main:app --port 8000" mesh
[ -x apps/gen-server/.venv/bin/uvicorn ] || (python3 -m venv apps/gen-server/.venv && apps/gen-server/.venv/bin/pip install -q -r apps/gen-server/requirements.txt)
start "cd apps/gen-server && GEN_ENGINE=test GEN_ALLOWED_IMAGE_HOSTS=localhost GEN_DATA_DIR=../../var/gen .venv/bin/uvicorn app.main:app --port 8100" gen
start "pnpm --filter @sw/api dev" api
start "pnpm --filter @sw/worker dev" worker
start "pnpm --filter @sw/forge-runtime dev" runtime
start "pnpm --filter @sw/web dev" web
for i in $(seq 1 90); do
  ok=0
  for u in 8000/health 8100/health 4000/v1/health 4100/ 3002/ 3000/; do curl -s -o /dev/null --max-time 2 "localhost:$u" && ok=$((ok+1)); done
  [ $ok -eq 6 ] && echo "stack up" && exit 0
  sleep 2
done
echo "stack did not come up; see var/logs"; exit 1
