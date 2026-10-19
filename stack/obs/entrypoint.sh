#!/usr/bin/env bash
# Writes a minimal OBS profile from environment variables, then starts OBS on a virtual display.
set -euo pipefail

: "${KEEL_OBS_PASSWORD:?KEEL_OBS_PASSWORD must be set}"
ENCODER="${KEEL_ENCODER:-x264}"          # x264 | nvenc
BITRATE="${KEEL_BITRATE_KBPS:-6000}"
FPS="${KEEL_FPS:-30}"

CFG="$HOME/.config/obs-studio"
PROFILE="$CFG/basic/profiles/Keel"
mkdir -p "$PROFILE" "$CFG/basic/scenes"

cat > "$CFG/global.ini" <<EOF
[General]
FirstRun=true
Pre19Defaults=false
Pre21Defaults=false
Pre23Defaults=false
Pre24.1Defaults=false
MaxLogs=5
InfoIncrement=-1
ProcessPriority=Normal
EnableAutoUpdates=false
ConfirmOnExit=false

[Basic]
Profile=Keel
ProfileDir=Keel
SceneCollection=Keel
SceneCollectionFile=Keel

[OBSWebSocket]
FirstLoad=false
ServerEnabled=true
ServerPort=4455
AlertsEnabled=false
AuthRequired=true
ServerPassword=${KEEL_OBS_PASSWORD}
EOF

if [ "$ENCODER" = "nvenc" ]; then
  ENC_ID="jim_nvenc"
  cat > "$PROFILE/streamEncoder.json" <<EOF
{"bitrate": ${BITRATE}, "rate_control": "CBR", "preset2": "p5", "profile": "high", "keyint_sec": 2, "bf": 2, "multipass": "qres"}
EOF
else
  ENC_ID="obs_x264"
  cat > "$PROFILE/streamEncoder.json" <<EOF
{"bitrate": ${BITRATE}, "rate_control": "CBR", "preset": "veryfast", "profile": "high", "keyint_sec": 2}
EOF
fi

cat > "$PROFILE/basic.ini" <<EOF
[General]
Name=Keel

[Video]
BaseCX=1920
BaseCY=1080
OutputCX=1920
OutputCY=1080
FPSType=0
FPSCommon=${FPS}
ScaleType=bicubic
ColorFormat=NV12
ColorSpace=709
ColorRange=Partial

[Output]
Mode=Advanced

[AdvOut]
Encoder=${ENC_ID}
ApplyServiceSettings=false
UseRescale=false
TrackIndex=1
RecType=Standard
Track1Bitrate=160
Track1Name=Audio

[Audio]
SampleRate=48000
ChannelSetup=Stereo
EOF

# Empty scene collection; the Keel controller builds the scenes over obs-websocket.
cat > "$CFG/basic/scenes/Keel.json" <<'JSON'
{"name":"Keel","current_scene":"BRB","current_program_scene":"BRB","scene_order":[{"name":"BRB"}],"sources":[{"id":"scene","name":"BRB","uuid":"6f1d1f3e-0c1a-4b52-9a6e-3b7d2f0a1c01","versioned_id":"scene","settings":{"id_counter":0,"items":[]},"mixers":0,"enabled":true,"muted":false,"volume":1.0,"flags":0,"prev_ver":536870912}],"groups":[],"quick_transitions":[],"transitions":[],"saved_projectors":[],"modules":{}}
JSON

echo "starting OBS (encoder=${ENC_ID}, ${BITRATE} kbps, ${FPS} fps)"
xvfb-run -a -s "-screen 0 1920x1080x24" \
  obs --disable-shutdown-check --disable-updater --minimize-to-tray \
      --profile Keel --collection Keel 2>&1 | grep --line-buffered -vE '^debug|Failed to open media'
code=${PIPESTATUS[0]}
echo "OBS exited with code $code"
exit "$code"
