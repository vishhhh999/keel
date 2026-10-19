# Testing record

Last run: 19 Oct 2026, in a Linux sandbox with Docker, OBS 30.0.2 (Ubuntu 24.04 package), mediamtx 1.21.2, ffmpeg as the fake phone.

## Verified

| What | How | Result |
|---|---|---|
| Switching logic (degrade fast, recover slow, thresholds, manual mode) | 52 unit and integration tests (`cd controller && npm test`), strict TypeScript typecheck | Pass |
| obs-websocket v5 auth and requests | Tested against a mock and against real OBS | Pass |
| Scene bootstrap on a real OBS (3 scenes, ingest source, screens, stream settings) | `scripts/e2e.sh` | Pass |
| SRT ingest into mediamtx, bitrate read from its API | Fake phone at 4000 kbps via SRT | Pass, about 4100 to 4400 kbps measured |
| OBS pulling the feed and switching to LIVE | e2e | Pass |
| Broadcast reaching an RTMP receiver | A second mediamtx acting as the platform | Pass, 1920x1080 H.264 + AAC |
| Phone drop: scene to BRB, broadcast continues | Killed the phone mid-broadcast | Pass, 0 unexpected stops, 1 drop recorded |
| Phone return: scene back to LIVE | Restarted the phone | Pass |
| Dashboard auth, SSE, history, metrics, path traversal guard | API tests | Pass |

Evidence frames pulled from the broadcast output are in `docs/evidence/`: `2-brb.png` is what viewers received during the drop, `3-recovered.png` after the phone returned. `1-live.png` was taken while the feed was live.

Run it yourself: `./scripts/e2e.sh`.

## Bugs the real-OBS test caught (all fixed)

- mediamtx config used two setting names this version rejects.
- An empty scene collection crashed OBS on start. It now starts with one scene.
- The controller could not write its data volume as a non-root user.
- OBS output was not visible in the container logs. It is now.
- A stale lockfile broke `npm ci`.

## Not verified

| What | Why it matters |
|---|---|
| SRTLA bonding image | The Dockerfile builds BELABOX srtla from GitHub. It was written without being built or run, because GitHub was not reachable in the test environment. Treat as unproven. |
| NVIDIA encoding (`KEEL_ENCODER=nvenc`) | No GPU in the test environment. |
| Real Twitch, Kick, YouTube ingest | Only a local RTMP receiver was used. Platform quirks (key handling, bitrate limits, reconnect behavior) are untested. |
| Twitch chat commands on real Twitch | Tested against a protocol-level fake only. |
| A real phone on real cellular | The fake phone is a clean, steady stream. Real feeds have jitter and bursts, so thresholds will need tuning. |
| Latency | Not measured. This is the metric streamers care about most and it must be measured on real networks. |
| Duration and load | Longest continuous run was a few minutes. No soak test, no concurrent users. |
| Software x264 at 1080p60 | Only 1080p30 was exercised, and only briefly. |

## Suggested next tests, in order

1. Real phone over SRT on 4G or 5G, 30 minute walk, with the broadcast going to a private Twitch test channel.
2. Same with SRTLA bonding (fix the image first).
3. Glass-to-glass latency measurement against the current provider on the same route.
4. 4 hour soak.
5. NVENC on a GPU instance.
