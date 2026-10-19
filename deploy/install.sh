#!/usr/bin/env bash
# One server, one command. Run as root on a fresh Ubuntu 22.04 or 24.04 box.
#
#   KEEL_PUBLIC_HOST=keel.example.com KEEL_STREAM_KEY=live_xxx ./deploy/install.sh
#   KEEL_PUBLIC_HOST=keel.example.com KEEL_DESTINATIONS='Twitch=rtmp://live.twitch.tv/app/live_xxx;Kick=rtmps://.../app/sk_xxx' ./deploy/install.sh
#
# KEEL_PUBLIC_HOST can be left out: the script then uses <your-ip>.sslip.io, which gets a real HTTPS
# certificate with no DNS setup.
#
# Optional: KEEL_RTMP_URL (default Twitch, used with KEEL_STREAM_KEY), KEEL_REPO_DIR (default: this repo),
#           KEEL_SRTLA=1 to also start the bonding receiver (untested, builds from GitHub),
#           KEEL_IMAGE_PREFIX=ghcr.io/<owner>/keel to pull prebuilt images instead of building (much faster),
#           KEEL_NOTIFY_WEBHOOK=<discord or slack webhook> for crew alerts.
set -euo pipefail
if [ -z "${KEEL_STREAM_KEY:-}" ] && [ -z "${KEEL_DESTINATIONS:-}" ]; then
  echo "Set KEEL_STREAM_KEY (Twitch) or KEEL_DESTINATIONS (any platforms) first." >&2; exit 1
fi
DIR="${KEEL_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
rnd() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-"${1:-24}"; }

command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh; }
if [ -z "${KEEL_PUBLIC_HOST:-}" ]; then
  IP=$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')
  KEEL_PUBLIC_HOST="$(echo "$IP" | tr . -).sslip.io"
  echo "Using $KEEL_PUBLIC_HOST (no DNS needed)."
fi
cd "$DIR/stack"
if [ ! -f .env ]; then
  cat > .env <<ENV
KEEL_API_TOKEN=$(rnd 28)
KEEL_MOD_TOKEN=$(rnd 28)
KEEL_OBS_PASSWORD=$(rnd 24)
KEEL_INGEST_PATH=live/$(rnd 24)
KEEL_PUBLIC_HOST=$KEEL_PUBLIC_HOST
KEEL_DASHBOARD_BIND=127.0.0.1
KEEL_OUTPUT_MODE=relay
KEEL_DESTINATIONS=${KEEL_DESTINATIONS:-}
KEEL_RTMP_URL=${KEEL_RTMP_URL:-rtmp://live.twitch.tv/app}
KEEL_STREAM_KEY=${KEEL_STREAM_KEY:-}
KEEL_NOTIFY_WEBHOOK=${KEEL_NOTIFY_WEBHOOK:-}
KEEL_IDLE_MINUTES=${KEEL_IDLE_MINUTES:-15}
KEEL_IDLE_ACTION=log
KEEL_IMAGE_PREFIX=${KEEL_IMAGE_PREFIX:-keel}
KEEL_IMAGE_TAG=${KEEL_IMAGE_TAG:-$([ -n "${KEEL_IMAGE_PREFIX:-}" ] && echo latest || echo local)}
ENV
  chmod 600 .env
fi
if command -v ufw >/dev/null; then
  ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 8890/udp; ufw allow 1935/tcp
  if [ "${KEEL_SRTLA:-0}" = 1 ]; then ufw allow 5000/udp; fi
  ufw --force enable
fi
PROFILES=(--profile tls)
if [ "${KEEL_SRTLA:-0}" = 1 ]; then PROFILES+=(--profile srtla); fi
docker compose "${PROFILES[@]}" pull --ignore-pull-failures --quiet || true
docker compose "${PROFILES[@]}" up -d --build
val() { grep "^$1=" .env | cut -d= -f2-; }
echo
echo "Dashboard:       https://$(val KEEL_PUBLIC_HOST)"
echo "Admin token:     $(val KEEL_API_TOKEN)"
echo "Moderator token: $(val KEEL_MOD_TOKEN)"
echo "Phone SRT:       srt://$(val KEEL_PUBLIC_HOST):8890?streamid=publish:$(val KEEL_INGEST_PATH)"
echo "Backup encoder:  srt://$(val KEEL_PUBLIC_HOST):8890?streamid=publish:$(val KEEL_INGEST_PATH)-backup"
