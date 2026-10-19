#!/usr/bin/env bash
# Proof reel: runs the real Keel stack (mediamtx, OBS, controller, relay) with two simulated phones and a
# simulated platform, walks it through the failures that end IRL streams, and records:
#   - what the platform receives (proof/platform_*.mp4 segments with their start times)
#   - the real dashboard in a browser (proof/dashboard.webm)
#   - a timeline of Keel's status every second (proof/timeline.jsonl)
# Needs docker compose, ffmpeg, python3 with playwright (for the dashboard). Run by .github/workflows/proof.yml.
set -uo pipefail
cd "$(dirname "$0")/../stack"
OUT="$(cd .. && pwd)/proof"; rm -rf "$OUT"; mkdir -p "$OUT"
export COMPOSE_FILE=docker-compose.yml:docker-compose.test.yml
KEY=e2eTestKey0123456789
TOKEN=proof-token-0123456789abcdef
ENVF=$(mktemp)
cat > "$ENVF" <<ENV
KEEL_API_TOKEN=$TOKEN
KEEL_OBS_PASSWORD=proof-obs-password-xyz
KEEL_INGEST_PATH=live/$KEY
KEEL_PUBLIC_HOST=localhost
KEEL_RECOVER_S=4
ENV
DC="docker compose --env-file $ENVF"
AUTH="Authorization: Bearer $TOKEN"
field() { curl -s -H "$AUTH" localhost:8080/api/status | python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
wait_for() { for _ in $(seq 1 "${3:-60}"); do [ "$(field "$1" 2>/dev/null)" = "$2" ] && return 0; sleep 1; done; echo "timeout waiting for $1 == $2"; return 1; }
phone() { (LABEL="$2" COLOR="$3" setsid bash ../scripts/fake-phone.sh srt localhost "$1" 4500 >/dev/null 2>&1 &); }
kill_phone() { pkill -f "[s]treamid=publish:$1&"; }
mark() { echo "{\"t\":$(date +%s%3N),\"mark\":\"$1\"}" >> "$OUT/timeline.jsonl"; echo "== $1"; }

cleanup() { pkill -f "[r]ecord_dashboard.py"; pkill -x ffmpeg 2>/dev/null; kill "${LOGGER:-0}" "${REC:-0}" 2>/dev/null; $DC down -v >/dev/null 2>&1; rm -f "$ENVF"; }
trap cleanup EXIT
$DC up -d --build >/dev/null 2>&1 || { echo "compose up failed"; exit 1; }
wait_for 'd["obs"]["synced"]' True 180 || exit 1

# Status timeline, one line per second.
( while true; do s=$(curl -s -H "$AUTH" localhost:8080/api/status) && echo "$s" | python3 -c "
import sys,json,time
d=json.load(sys.stdin)
print(json.dumps({'t':int(time.time()*1000),'state':d['ingest']['state'],'active':d['ingest']['active'],'scene':d['obs']['scene'],'kbps':d['ingest']['kbps'],'onAir':d['broadcast']['onAir'],'shield':d['broadcast']['shield'],'obs':d['obs']['connected'],'dests':[x['state'] for x in d['broadcast']['destinations']]}))" >> "$OUT/timeline.jsonl"; sleep 1; done ) & LOGGER=$!

phone "live/$KEY" "PRIMARY PHONE" 0x2A6F73
wait_for 'd["obs"]["scene"]' LIVE 40 || exit 1
curl -s -XPOST -H "$AUTH" localhost:8080/api/stream/start -d '{}' >/dev/null
wait_for '[x["state"] for x in d["broadcast"]["destinations"]] == ["live", "live"]' True 40 || exit 1
sleep 3

# Record what platform A receives. Each (re)connection of the relay starts a new segment.
( n=0; while true; do f=$(printf "%s/platform_%02d" "$OUT" $n); date +%s%3N > "$f.start"; ffmpeg -loglevel error -y -rw_timeout 4000000 -i rtmp://localhost:11935/app/e2ea -c copy -f mpegts "$f.ts" 2>/dev/null; n=$((n+1)); sleep 0.3; done ) & REC=$!
# Record the real dashboard.
python3 ../scripts/record_dashboard.py "$OUT" "$TOKEN" 300 > "$OUT/dashboard.log" 2>&1 & DPID=$!
sleep 6

mark "live on the primary phone";               sleep 10
mark "backup phone connects";                   phone "live/$KEY-backup" "BACKUP PHONE" 0x3C7E96; sleep 9
mark "primary phone dies";                      kill_phone "live/$KEY"
wait_for 'd["ingest"]["active"]' backup 20;     sleep 11
mark "backup phone dies too";                   kill_phone "live/$KEY-backup"
wait_for 'd["obs"]["scene"]' BRB 20;            sleep 9
mark "primary phone is back";                   phone "live/$KEY" "PRIMARY PHONE" 0x2A6F73
wait_for 'd["obs"]["scene"]' LIVE 30;           sleep 8
mark "OBS crashes";                             $DC exec -T obs bash -c 'for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = obs ] && kill -9 "${p#/proc/}"; done' >/dev/null 2>&1
wait_for 'd["broadcast"]["shield"]' True 30
wait_for 'd["obs"]["synced"] and d["obs"]["streaming"]' True 120
wait_for 'd["broadcast"]["shield"]' False 40;   sleep 10
mark "end"

kill "$REC" 2>/dev/null; pkill -x ffmpeg; touch "$OUT/stop"
wait "$DPID"; rm -f "$OUT/stop"; kill "$LOGGER" 2>/dev/null
# Small, shareable versions of each platform segment.
for f in "$OUT"/platform_*.ts; do [ -s "$f" ] || { rm -f "$f" "${f%.ts}.start"; continue; }
  ffmpeg -loglevel error -y -i "$f" -vf scale=1280:720 -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 96k "${f%.ts}.mp4" && rm -f "$f"; done
ls -la "$OUT"
field 'd["summary"]' > "$OUT/summary.json"
