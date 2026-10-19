# Testing record

## Automated, every push (GitHub Actions, `.github/workflows/ci.yml`)

| Suite | What it covers | Count |
|---|---|---|
| Controller (`cd controller && npm test`) | Switcher incl. SRT drop/loss rules, ingest bitrate and SRT link stats, OBS websocket client, scene bootstrap incl. backup source, failover and pinning, auto-restart, OBS crash resume, relay (copy, per-destination retries, key redaction, crash shield, shield delay, start before OBS), alerts and throttling, settings validation and persistence, API auth, roles, tickets, metrics, Twitch chat | 76 tests + strict typecheck |
| Platform (`cd platform && npm test`) | Tenants, start/stop, idle hook, rate limit, suspension stops servers, readiness and boot timeout, access info, orphan sweeper, sslip and Cloudflare DNS, cloud-init quoting and injection, input validation, Stripe signatures, DB migration, Hetzner request shape | 16 tests |
| Mobile (`cd mobile && npm test`) | State words, link chips, on-air logic, URL and share link parsing, backoff, API client incl. 403 for moderators | 9 tests + typecheck |
| Website | `build_site.py` output matches committed HTML | 1 check |
| End to end (`scripts/e2e.sh`) | Real OBS, real mediamtx, the relay, two fake phones, a fake platform with two destinations. Ingest, LIVE, SRT stats read, multistream to both destinations at 1920 wide, failover to backup with no BRB and no drop, BRB with both phones dead and broadcast still up, recovery to primary, OBS killed: crash shield on, platform still receiving, OBS back, broadcast resumed by itself, shield off, stop | 22 checks |

The end-to-end script was rewritten for v0.3 and has not yet been run: the sandbox that wrote it could start Docker but its network policy blocked Docker Hub and GitHub. It runs in CI on the first push. If a check fails there, the failure message names it.

## Verified by hand (v0.1, 19 Oct 2026, Linux sandbox with Docker, OBS 30.0.2, mediamtx 1.21.2)

| What | Result |
|---|---|
| Scene bootstrap on real OBS | Pass |
| SRT ingest, bitrate read from mediamtx | Pass, 4100 to 4400 kbps measured for a 4000 kbps fake phone |
| OBS pulling the feed, switching to LIVE | Pass |
| Broadcast reaching an RTMP receiver | Pass, 1920x1080 H.264 + AAC |
| Phone drop: BRB, broadcast continues; return: LIVE | Pass, 0 unexpected stops |

Evidence frames from that run are in `docs/evidence/` (they show the placeholder screens from before the current brand; the behaviour is the evidence, not the look).

## Verified locally in v0.3 (no Docker)

`npm run dev:mock` runs the real controller against a mock OBS, a fake mediamtx API (with SRT stats and a backup phone) and fake ffmpeg processes. Observed: failover from a weak primary to the backup with no BRB, return to primary, a flaky destination reconnecting alone while the others stayed live, RTT and loss on the dashboard. Dashboard checked visually on desktop and phone width.

## Bugs caught by tests while building v0.3

- Going live before OBS was ready showed BRB immediately instead of waiting for the program (relay test).
- `KEEL_FPS` never reached the controller, so 60 fps was reset to 30 on every start.
- The platform never told a customer their dashboard address or token, and nothing created DNS for the HTTPS hostname.
- A server stuck in `error` could never be stopped, so it billed forever.

## Not verified

| What | Why it matters |
|---|---|
| Real phones on real cellular | Real feeds have jitter and bursts; thresholds and SRT latency will need tuning. |
| SRTLA bonding | Receiver image builds from GitHub; never built or run. |
| Real Twitch, Kick, YouTube | Key handling, bitrate limits, reconnect behaviour, simultaneous streaming rules. |
| Glass to glass latency | The metric streamers care about most. Not measured. |
| Soak and load | Longest run was minutes. |
| NVENC | No GPU available. |
| Platform against Hetzner, Cloudflare, Stripe | Mocked only. |
| Mobile app on a device | Logic and types only. |

## Suggested next tests, in order

1. Push and read the CI end-to-end result.
2. Two real phones on two carriers, 30 minute walk, private Twitch test channel plus a second platform.
3. SRTLA with the receiver image fixed if needed.
4. Glass to glass latency against the current provider on the same route.
5. 8 hour soak with `scripts/chaos.sh` running.
6. NVENC on a GPU instance.
