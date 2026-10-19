#!/usr/bin/env bash
# One server, one command. Run as root on a fresh Ubuntu 22.04 or 24.04 box.
#   KEEL_PUBLIC_HOST=keel.example.com KEEL_STREAM_KEY=live_xxx ./deploy/install.sh
# Optional: KEEL_RTMP_URL (default Twitch), KEEL_REPO_DIR (default: the repo this script is in).
set -euo pipefail
: "${KEEL_PUBLIC_HOST:?set KEEL_PUBLIC_HOST to a DNS name that points at this server}"
: "${KEEL_STREAM_KEY:?set KEEL_STREAM_KEY}"
DIR="${KEEL_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
rnd() { head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-"${1:-24}"; }

command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh; }
cd "$DIR/stack"
if [ ! -f .env ]; then
  cat > .env <<ENV
KEEL_API_TOKEN=$(rnd 28)
KEEL_OBS_PASSWORD=$(rnd 24)
KEEL_INGEST_PATH=live/$(rnd 24)
KEEL_PUBLIC_HOST=$KEEL_PUBLIC_HOST
KEEL_RTMP_URL=${KEEL_RTMP_URL:-rtmp://live.twitch.tv/app}
KEEL_STREAM_KEY=$KEEL_STREAM_KEY
KEEL_IDLE_MINUTES=${KEEL_IDLE_MINUTES:-15}
KEEL_IDLE_ACTION=log
ENV
  chmod 600 .env
fi
if command -v ufw >/dev/null; then
  ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 8890/udp; ufw allow 1935/tcp; ufw allow 5000/udp; ufw --force enable
fi
docker compose --profile tls --profile srtla up -d --build
echo
echo "Dashboard:  https://$KEEL_PUBLIC_HOST"
echo "Token:      $(grep ^KEEL_API_TOKEN .env | cut -d= -f2)"
echo "Phone SRT:  srt://$KEEL_PUBLIC_HOST:8890?streamid=publish:$(grep ^KEEL_INGEST_PATH .env | cut -d= -f2)"
