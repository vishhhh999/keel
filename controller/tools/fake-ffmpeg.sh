#!/usr/bin/env bash
# Stand-in for ffmpeg in `npm run dev:mock`: prints progress like the real thing so the relay
# reports destinations as live. Destinations whose URL contains "flaky" drop every ~25 seconds.
url="${!#}"
size=0
for i in $(seq 1 100000); do
  size=$((size + 750000))
  printf 'total_size=%s\nprogress=continue\n' "$size"
  if [[ "$url" == *flaky* ]] && (( i % 25 == 0 )); then echo "Connection reset by peer" >&2; exit 1; fi
  sleep 1
done
