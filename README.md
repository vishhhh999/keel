# Keel

**The signal moves. The stream holds.**

Keel is a cloud reliability layer for IRL streamers. Your phones send video to a server. The server runs OBS, adds your scenes, and broadcasts to Twitch, Kick, YouTube or any RTMP/SRT destination at once. When something breaks, Keel handles it so viewers never watch a dead stream:

| What breaks | What Keel does |
|---|---|
| Phone loses signal | Be right back screen within 2 s, live again after 5 s of healthy signal. The broadcast never stops. |
| Signal weak, or packets breaking up | LOW SIGNAL scene. Keel reads SRT packet loss and late packets, not only bitrate. |
| Primary phone dies, backup is fine | Automatic failover to the backup encoder. Viewers stay live, no BRB. |
| OBS crashes or hangs | Crash shield: the relay sends BRB to every platform until OBS is back, then Keel resumes the broadcast. |
| One platform drops the connection | That destination reconnects on its own. The others are untouched. |
| OBS output stops by itself | Restarted automatically with backoff, crew alerted. |

Website (deploys to Vercel from `web/`) has an interactive demo of the real dashboard on a simulated server.

> Status: **v0.3.** The original core loop (SRT in, switching, broadcast through a drop) was verified end to end with real OBS in Docker. The v0.3 reliability features (backup failover, relay, crash shield, SRT-aware switching, auto-recover, live rules, roles, alerts) are covered by 76 controller tests and by `scripts/e2e.sh`, which runs in GitHub Actions on every push with real OBS. Nothing has run on a real phone over cellular, against live Twitch/Kick/YouTube, or with real streamers yet. Read "What is not proven" before betting anything on it.

**Open to acquisition, licensing or partnership.** Keel needs a funded owner to take it to market. Contact [@vishafterdark on X](https://x.com/vishafterdark) or [work@visheshmahendru.com](mailto:work@visheshmahendru.com).

---

## How it works

```
 Primary phone ─┐  SRT / SRTLA / RTMP
 Backup phone  ─┤
                v
 [ mediamtx ]  ingest, secret paths live/<key> and live/<key>-backup, bitrate + SRT link stats
                |
                v
 [ OBS Studio ]  headless, scenes LIVE / LOW SIGNAL / BRB, both feeds loaded, one visible
        ^                         |  program (RTMP, internal)
        |  obs-websocket          v
 [ Keel controller ] ──────► [ relay ]  one ffmpeg per destination, copy only
   reads both feeds every second     |   crash shield: BRB when the program is missing
   picks the healthier source        v
   degrade fast, recover slow    Twitch · Kick · YouTube · any RTMP/SRT
   dashboard, API, chat, alerts
```

**Switching rules** (defaults, all changeable live from the dashboard):

| Input | Condition | Holds for | Scene |
|---|---|---|---|
| Healthy | 800 kbps or more, clean packets | 5 s to recover | LIVE |
| Weak | 50 to 800 kbps, or > 2% late packets, or > 20% loss (SRT) | 3 s | LOW SIGNAL |
| Gone | below 50 kbps or disconnected | 2 s | BRB |

With a backup encoder the rule runs per source and viewers see whichever source is healthier (primary wins ties). `KEEL_OUTPUT_MODE=direct` sends OBS straight to one destination instead of through the relay (the original v0.1 path, no crash shield or multistream).

## What you need

- A Linux server with Docker and Docker Compose v2. 4 vCPU and 8 GB RAM runs a 1080p30 x264 broadcast; see [docs/COSTS.md](docs/COSTS.md). An NVIDIA GPU is optional ([docs/GPU.md](docs/GPU.md)).
- Open ports: `8890/udp` (SRT), `1935/tcp` (RTMP), `5000/udp` (SRTLA, optional), and `80/tcp` + `443/tcp` for the HTTPS dashboard (or `8080/tcp` plain HTTP for testing only).
- A stream key for at least one platform.
- A phone app that sends SRT (Moblin, IRL Pro, Larix) or SRTLA bonding (Moblin, IRL Pro, Belabox). A second phone or app for the backup is optional but recommended.

## Setup: one command (fresh Ubuntu server, HTTPS)

```bash
git clone https://github.com/OWNER/keel.git keel && cd keel
KEEL_DESTINATIONS='Twitch=rtmp://live.twitch.tv/app/live_xxx;Kick=rtmps://.../app/sk_xxx' ./deploy/install.sh
```

No domain needed: without `KEEL_PUBLIC_HOST` the script uses `<your-ip>.sslip.io`, which gets a real certificate. It generates every secret, opens the firewall, binds the plain HTTP port to localhost, starts the stack with Caddy, and prints the dashboard address, admin token, moderator token and both phone addresses. Optional: `KEEL_NOTIFY_WEBHOOK` (Discord/Slack alerts), `KEEL_SRTLA=1` (bonding receiver, untested), `KEEL_IMAGE_PREFIX=ghcr.io/<owner>/keel` (prebuilt images, much faster first boot).

## Setup: manual

```bash
cd keel/stack
cp .env.example .env      # fill in the REQUIRED secrets and your destinations
docker compose up -d --build
docker compose logs -f controller
```

Every setting is documented in [`stack/.env.example`](stack/.env.example). Open `http://<server>:8080` and sign in with `KEEL_API_TOKEN`. For anything public use HTTPS: set `KEEL_DASHBOARD_BIND=127.0.0.1` and `KEEL_PUBLIC_HOST` to a DNS name, then `docker compose --profile tls up -d`. Docker publishes ports past `ufw`, so the localhost binding is what actually closes 8080.

### First test

1. Copy or scan the primary SRT address from the dashboard into your phone app and start sending. The dashboard flips to **Live.** in a few seconds and shows round trip time, loss and dropped packets.
2. Optional: point a second phone at the backup address.
3. Press **Go live**. Each destination shows Connecting, then Live.
4. Airplane mode on the primary for 10 seconds. With a backup, viewers stay live on it. Without, the scene goes to BRB and every platform keeps receiving video. Turn the phone back on and Keel returns to it.

No phone and no streaming account: `./scripts/e2e.sh` (Docker and ffmpeg) runs the whole stack with two fake phones, two fake platforms, a failover and an OBS crash.

## Dashboard and controls

- Big state word with the tilting mark, bitrate, SRT round trip, packet loss, late packets, active source.
- Signal, round trip and "what viewers see" charts for the last 5 minutes.
- Go live and stop, scene buttons, auto switching, source pin (auto, primary, backup).
- Destinations with live state, bitrate, reconnect count and an on/off switch per platform.
- Ingest addresses for primary and backup with copy buttons and QR codes.
- Reliability record: drops held, failovers, time on BRB, longest drop, broadcast time, unexpected stops, platform reconnects, crash shield time.
- Switching rules, editable live and saved across restarts.
- Event log.

**Moderators:** set `KEEL_MOD_TOKEN`. Moderators can switch scenes and sources from the dashboard and app; they cannot start or stop the broadcast, toggle destinations or change rules.

**Twitch chat** (set `KEEL_TWITCH_*`): `!status`, `!live`, `!low`, `!brb`, `!auto`, `!source auto|primary|backup`, `!start`, `!stop`. Broadcaster and mods can run them; extra users go in `KEEL_TWITCH_ALLOWED`. `!stop` is limited to the broadcaster and `KEEL_TWITCH_ALLOWED`.

**Crew alerts:** `KEEL_NOTIFY_WEBHOOK` takes a Discord or Slack webhook. Drops, recoveries, failovers, platform reconnects, crash shield and auto restarts are posted, throttled per kind.

**API:** `GET /api/status`, `/api/history`, `/metrics` (Prometheus); `POST /api/scene`, `/api/mode`, `/api/source`, `/api/stream/start`, `/api/stream/stop`, `/api/destination`, `/api/settings`, `/api/ticket` (one-time ticket for `GET /api/events?ticket=`). Bearer token in the `Authorization` header. `GET /healthz` is open.

## Change the screens viewers see

`stack/assets/brb.png` and `low.png` (1920x1080 PNG). `low.png` is an overlay and can use transparency. The crash shield also uses `brb.png`. Replace them with your channel's art and restart.

## Develop without Docker

```bash
cd controller && npm install && npm run dev:mock
```

Open `http://localhost:8080` (token `dev`, moderator `mod`), press Go live. A simulated primary and backup phone cycle through healthy, weak, dropped and failover; three fake platforms (one flaky) show the relay at work.

## Repo layout

| Path | What |
|---|---|
| `controller/` | Keel controller: switching, failover, relay, crash shield, dashboard, API, chat, alerts. Node 22, TypeScript run natively, one dependency (`ws`). 76 tests. |
| `stack/` | Docker Compose: mediamtx, OBS, SRTLA (profile), controller, Caddy TLS (profile). |
| `platform/` | Multi-tenant control plane: accounts, per-streamer servers, sslip or Cloudflare DNS, readiness checks, idle shutdown, orphan sweeper, usage metering, Stripe webhooks, Hetzner adapter. No dependencies. 16 tests. |
| `mobile/` | Expo React Native companion app. Logic tested, not yet run on a device. |
| `web/` | The Keel website and live demo, static, deploys to Vercel (Root Directory `web`). |
| `deploy/` | `install.sh`, one-command server setup. |
| `scripts/` | `e2e.sh` (full Docker test), `fake-phone.sh`, `chaos.sh` (drop drill). |
| `.github/workflows/` | `ci.yml` (all tests, site build check, em dash check, Docker end to end), `images.yml` (prebuilt images to GHCR). |
| `brand/` | Logo set, tokens, generators. Brand guide PDF in `docs/`. |
| `docs/` | Architecture, launch week, operations, security, roadmap, testing record, costs, GPU, outreach. |

## What is not proven

Be honest with yourself and your investors about these.

- **Verified with real OBS in Docker (v0.1 run):** ingest over SRT, scene switching on drop and recovery, broadcast continuity through a drop, output reaching an RTMP receiver.
- **Covered by automated tests, Docker end to end in CI:** backup failover, relay and per-destination reconnects, crash shield with OBS killed mid-broadcast, auto-recover, SRT link stats, live rules, roles, tickets, alerts. The CI run is the proof; check the Actions tab after pushing.
- **Not tested:** a real phone on real cellular, SRTLA bonding (image never built), NVENC, real Twitch/Kick/YouTube ingest, glass to glass latency, anything over hours, many users at once.
- **Built but untested against live services:** Hetzner, Cloudflare and Stripe in the platform; the mobile app on a device.
- **Not built:** reporting usage into Stripe invoices, team accounts, overlay editor in the portal, WebRTC (browser) ingest. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Taking it to market

Start with [docs/LAUNCH-WEEK.md](docs/LAUNCH-WEEK.md). Architecture in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), running it in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## License

All rights reserved by the author until agreed otherwise. Third party components (OBS Studio, mediamtx, SRTLA, FFmpeg, Caddy, ws, qrcode-generator) keep their own licenses. Cabinet Grotesk is used under the Fontshare license and is not included in this repo.
