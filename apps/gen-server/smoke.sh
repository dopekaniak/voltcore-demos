#!/usr/bin/env bash
# End-to-end check of a running generation server: health, one text-to-3D task, STL download.
# Usage: GEN_SERVER_TOKEN=... apps/gen-server/smoke.sh https://<pod-id>-8100.proxy.runpod.net ["a small vase"]
set -euo pipefail
URL="${1:?server URL}"; PROMPT="${2:-a small round vase}"
: "${GEN_SERVER_TOKEN:?set GEN_SERVER_TOKEN}"
AUTH=(-H "Authorization: Bearer $GEN_SERVER_TOKEN")
echo "health: $(curl -fsS "$URL/health")"
ID=$(curl -fsS "${AUTH[@]}" -H 'content-type: application/json' -d "{\"kind\":\"text\",\"prompt\":\"$PROMPT\",\"seed\":1}" "$URL/v1/tasks" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "task $ID"
START=$(date +%s)
while :; do
  T=$(curl -fsS "${AUTH[@]}" "$URL/v1/tasks/$ID")
  S=$(echo "$T" | python3 -c 'import sys,json; t=json.load(sys.stdin); print(t["status"], t["progress"])')
  echo "  $(( $(date +%s) - START ))s: $S"
  case "$S" in SUCCEEDED*) break ;; FAILED*|CANCELED*) echo "$T"; exit 1 ;; esac
  sleep 5
done
echo "$T" | python3 -c 'import sys,json; print("stats:", json.load(sys.stdin)["stats"])'
curl -fsS "${AUTH[@]}" -o /tmp/printforge-smoke.stl "$URL/v1/tasks/$ID/files/stl"
echo "STL: $(wc -c < /tmp/printforge-smoke.stl) bytes in $(( $(date +%s) - START ))s"
