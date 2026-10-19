#!/usr/bin/env bash
# Chaos drill against a running stack. Starts and kills a simulated phone on a random schedule and checks the broadcast never stops.
#   KEEL_API_TOKEN=... KEEL_INGEST_PATH=live/... scripts/chaos.sh [cycles]
# Needs ffmpeg and a stack that is already broadcasting (press Start broadcast first, or use scripts/e2e.sh's compose files).
set -euo pipefail
cd "$(dirname "$0")/.."
CYCLES="${1:-10}"
API="${KEEL_API:-http://localhost:8080}"; HOST="${KEEL_HOST:-localhost}"
TOKEN="${KEEL_API_TOKEN:?set KEEL_API_TOKEN}"; PATH_NAME="${KEEL_INGEST_PATH:?set KEEL_INGEST_PATH}"
streaming() { curl -fsS -H "authorization: Bearer $TOKEN" "$API/api/status" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).obs.streaming))'; }
bad=0
for i in $(seq 1 "$CYCLES"); do
  ./scripts/fake-phone.sh srt "$HOST" "$PATH_NAME" >/dev/null 2>&1 & PID=$!
  sleep $((8 + RANDOM % 6)); kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true
  sleep $((3 + RANDOM % 4))
  S=$(streaming); echo "cycle $i: broadcast streaming=$S"; [ "$S" = "true" ] || bad=$((bad+1))
done
echo "broadcast was down after $bad of $CYCLES drops"; [ "$bad" -eq 0 ]
