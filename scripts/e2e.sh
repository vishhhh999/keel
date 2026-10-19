#!/usr/bin/env bash
# End-to-end test: real OBS, real mediamtx, the relay, two fake phones and a fake platform with two destinations.
# Needs docker compose and ffmpeg on the host. Takes about 5 minutes. Runs in CI on every push.
#
# Proves, in order: ingest, LIVE switching, multistream to two destinations, automatic failover to the
# backup encoder without a BRB, BRB when both encoders die with the broadcast still up, recovery,
# and the crash shield: OBS is killed mid-broadcast, platforms keep receiving the BRB screen, OBS comes
# back and Keel resumes the broadcast by itself.
set -uo pipefail
cd "$(dirname "$0")/../stack"
export COMPOSE_FILE=docker-compose.yml:docker-compose.test.yml
KEY=e2eTestKey0123456789
ENVF=$(mktemp)
cat > "$ENVF" <<ENV
KEEL_API_TOKEN=e2e-token-0123456789abcdef
KEEL_OBS_PASSWORD=e2e-obs-password-xyz
KEEL_INGEST_PATH=live/$KEY
KEEL_PUBLIC_HOST=localhost
KEEL_RECOVER_S=4
KEEL_SHIELD_DELAY_S=2
ENV
DC="docker compose --env-file $ENVF"
AUTH="Authorization: Bearer e2e-token-0123456789abcdef"
fail=0
# In GitHub Actions, failures also become annotations so they are readable from the run page and the API.
annot() { [ -n "${GITHUB_ACTIONS:-}" ] || return 0; local t="$1" m; m=$(printf '%s' "$2" | tail -c 3500 | sed 's/%/%25/g' | sed ':a;N;$!ba;s/\r/%0D/g;s/\n/%0A/g'); echo "::error title=$t::$m"; }
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (wanted $3, got $2)"; annot "e2e check failed" "$1: wanted $3, got $2"; fail=1; fi; }
field() { curl -s -H "$AUTH" localhost:8080/api/status | python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
wait_for() { for _ in $(seq 1 "${3:-60}"); do [ "$(field "$1" 2>/dev/null)" = "$2" ] && return 0; sleep 2; done; return 1; }
probe() { timeout 15 ffprobe -v error -show_entries stream=width -of csv=p=0 "rtmp://localhost:11935/app/$1" 2>/dev/null | head -1; }
# A destination that just (re)connected can take a few seconds to appear on the platform: retry before judging.
width() { local w=""; for _ in 1 2 3 4 5 6; do w=$(probe "$1"); [ -n "$w" ] && break; sleep 3; done; echo "$w"; }
phone() { (setsid bash ../scripts/fake-phone.sh srt localhost "$1" 4000 >/dev/null 2>&1 &); }
kill_phone() { pkill -f "[s]treamid=publish:$1&" ; }

cleanup() { pkill -x ffmpeg 2>/dev/null; $DC down -v >/dev/null 2>&1; rm -f "$ENVF"; }
trap cleanup EXIT
if ! $DC up -d --build > /tmp/keel-up.log 2>&1; then
  cat /tmp/keel-up.log; annot "docker compose up failed" "$(tail -40 /tmp/keel-up.log)"; exit 1
fi

wait_for 'd["obs"]["synced"]' True 120;               check "controller synced with real OBS" "$(field 'd["obs"]["synced"]')" True
check "idle scene is BRB" "$(field 'd["obs"]["scene"]')" BRB
check "two sources configured" "$(field 'len(d["sources"])')" 2

phone "live/$KEY"
wait_for 'd["obs"]["scene"]' LIVE 30;                 check "primary phone connects, scene goes LIVE" "$(field 'd["obs"]["scene"]')" LIVE
check "SRT link stats are read" "$(field 'd["ingest"]["link"] is not None')" True

curl -s -XPOST -H "$AUTH" localhost:8080/api/stream/start -d '{}' >/dev/null
wait_for 'd["broadcast"]["onAir"]' True 30;           check "broadcast goes on air" "$(field 'd["broadcast"]["onAir"]')" True
wait_for '[x["state"] for x in d["broadcast"]["destinations"]]' "['live', 'live']" 30
check "both destinations live" "$(field '[x["state"] for x in d["broadcast"]["destinations"]]')" "['live', 'live']"
check "platform A receives 1920 wide video" "$(width e2ea)" 1920
check "platform B receives 1920 wide video" "$(width e2eb)" 1920

phone "live/$KEY-backup"
sleep 8
kill_phone "live/$KEY"
wait_for 'd["ingest"]["active"]' backup 30;           check "primary dies, Keel fails over to the backup" "$(field 'd["ingest"]["active"]')" backup
check "viewers stay LIVE, no BRB" "$(field 'd["obs"]["scene"]')" LIVE
check "no drop counted during failover" "$(field 'd["summary"]["drops"]')" 0

kill_phone "live/$KEY-backup"
wait_for 'd["obs"]["scene"]' BRB 30;                  check "both phones gone, scene goes BRB" "$(field 'd["obs"]["scene"]')" BRB
check "broadcast stays up through the drop" "$(field 'd["broadcast"]["onAir"]')" True

phone "live/$KEY"
wait_for 'd["obs"]["scene"]' LIVE 40;                 check "primary returns, scene goes LIVE" "$(field 'd["obs"]["scene"]')" LIVE
wait_for 'd["ingest"]["active"]' primary 20;          check "back on primary" "$(field 'd["ingest"]["active"]')" primary

# Crash shield: kill the OBS process inside its container, as a crash would.
$DC exec -T obs bash -c 'for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = obs ] && kill -9 "${p#/proc/}"; done' >/dev/null 2>&1
wait_for 'd["broadcast"]["shield"]' True 30;          check "OBS killed, crash shield on" "$(field 'd["broadcast"]["shield"]')" True
check "platform A still receives video during the OBS outage" "$(width e2ea)" 1920
wait_for 'd["obs"]["synced"] and d["obs"]["streaming"]' True 120
check "OBS back, Keel resumed the broadcast by itself" "$(field 'd["obs"]["synced"] and d["obs"]["streaming"]')" True
wait_for 'd["broadcast"]["shield"]' False 30;         check "crash shield off" "$(field 'd["broadcast"]["shield"]')" False
check "platform A back on the program" "$(width e2ea)" 1920

curl -s -XPOST -H "$AUTH" localhost:8080/api/stream/stop -d '{}' >/dev/null
wait_for 'd["broadcast"]["onAir"]' False 20;          check "broadcast stops on request" "$(field 'd["broadcast"]["onAir"]')" False

echo; field 'd["summary"]'
if [ $fail != 0 ]; then
  echo; echo "---- container logs (last 60 lines each) ----"
  for s in controller obs mediamtx; do echo "== $s"; $DC logs --no-color --tail 60 "$s" 2>&1; annot "logs: $s" "$($DC logs --no-color --tail 25 "$s" 2>&1)"; done
fi
[ $fail = 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit $fail
