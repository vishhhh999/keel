#!/usr/bin/env bash
# End-to-end test: real OBS, real mediamtx, a fake phone, and a fake "platform" to receive the broadcast.
# Needs docker compose and ffmpeg on the host. Takes about 2 minutes.
set -uo pipefail
cd "$(dirname "$0")/../stack"
export COMPOSE_FILE=docker-compose.yml:docker-compose.test.yml
ENVF=$(mktemp)
cat > "$ENVF" <<ENV
KEEL_API_TOKEN=e2e-token-0123456789abcdef
KEEL_OBS_PASSWORD=e2e-obs-password-xyz
KEEL_INGEST_PATH=live/e2eTestKey0123456789
KEEL_PUBLIC_HOST=localhost
KEEL_RECOVER_S=4
ENV
[ -n "${KEEL_CA_FILE:-}" ] && echo "KEEL_CA_FILE=$KEEL_CA_FILE" >> "$ENVF"
DC="docker compose --env-file $ENVF"
AUTH="Authorization: Bearer e2e-token-0123456789abcdef"
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (wanted $3, got $2)"; fail=1; fi; }
field() { curl -s -H "$AUTH" localhost:8080/api/status | python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
wait_for() { for _ in $(seq 1 "${3:-60}"); do [ "$(field "$1" 2>/dev/null)" = "$2" ] && return 0; sleep 2; done; return 1; }

cleanup() { pkill -x ffmpeg 2>/dev/null; $DC down -v >/dev/null 2>&1; rm -f "$ENVF"; }
trap cleanup EXIT
$DC up -d --build || exit 1

wait_for 'd["obs"]["synced"]' True 90;           check "controller synced with real OBS" "$(field 'd["obs"]["synced"]')" True
check "idle scene is BRB" "$(field 'd["obs"]["scene"]')" BRB

(setsid ../scripts/fake-phone.sh srt localhost live/e2eTestKey0123456789 4000 >/dev/null 2>&1 &)
wait_for 'd["obs"]["scene"]' LIVE 30;            check "phone connects, scene goes LIVE" "$(field 'd["obs"]["scene"]')" LIVE

curl -s -XPOST -H "$AUTH" localhost:8080/api/stream/start -d '{}' >/dev/null
wait_for 'd["obs"]["streaming"]' True 15;        check "broadcast starts" "$(field 'd["obs"]["streaming"]')" True
sleep 3
W=$(timeout 20 ffprobe -v error -show_entries stream=width -of csv=p=0 rtmp://localhost:11935/app/e2e 2>/dev/null | head -1)
check "platform receives 1920 wide video" "$W" 1920

pkill -x ffmpeg
wait_for 'd["obs"]["scene"]' BRB 30;             check "phone drops, scene goes BRB" "$(field 'd["obs"]["scene"]')" BRB
check "broadcast stays up through the drop" "$(field 'd["obs"]["streaming"]')" True

(setsid ../scripts/fake-phone.sh srt localhost live/e2eTestKey0123456789 4000 >/dev/null 2>&1 &)
wait_for 'd["obs"]["scene"]' LIVE 40;            check "phone returns, scene goes LIVE" "$(field 'd["obs"]["scene"]')" LIVE
check "broadcast never stopped" "$(field 'd["summary"]["streamUnexpectedStops"]')" 0
check "one drop recorded" "$(field 'd["summary"]["drops"]')" 1
[ $fail = 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit $fail
