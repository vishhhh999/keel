#!/usr/bin/env bash
# Simulate a phone publishing to Keel. Needs ffmpeg with libx264 (and SRT support for srt mode).
#   ./fake-phone.sh srt  localhost live/<your-key> [kbps]
#   ./fake-phone.sh rtmp localhost live/<your-key> [kbps]
set -euo pipefail
MODE=${1:?mode: srt|rtmp}; HOST=${2:?host}; PATH_NAME=${3:?path like live/<key>}; KBPS=${4:-4000}
SRC="testsrc2=size=1280x720:rate=30"
AUDIO="sine=frequency=440:sample_rate=48000"
ENC=(-c:v libx264 -preset veryfast -tune zerolatency -b:v "${KBPS}k" -maxrate "${KBPS}k" -bufsize "$((KBPS*2))k" -g 60 -pix_fmt yuv420p -c:a aac -b:a 128k)
if [ "$MODE" = srt ]; then
  exec ffmpeg -loglevel warning -re -f lavfi -i "$SRC" -f lavfi -i "$AUDIO" "${ENC[@]}" -f mpegts "srt://${HOST}:8890?streamid=publish:${PATH_NAME}&pkt_size=1316"
else
  exec ffmpeg -loglevel warning -re -f lavfi -i "$SRC" -f lavfi -i "$AUDIO" "${ENC[@]}" -f flv "rtmp://${HOST}:1935/${PATH_NAME}"
fi
