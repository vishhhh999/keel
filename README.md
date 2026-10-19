# Keel

**The signal moves. The stream holds.**

Keel is a cloud streaming stack for IRL streamers. Your phone sends video to a server. The server runs OBS, adds your scenes, and broadcasts to Twitch, Kick or YouTube. When your phone's signal gets weak or drops, Keel switches the broadcast to a branded "weak signal" or "be right back" screen by itself. Viewers never see a dead stream, and when your signal comes back, Keel returns to your camera.

Concept, brand and product design: Vish, www.visheshmahendru.com

> Status: **v0.1 reference prototype.** The core loop is tested end to end against real OBS (see [docs/TESTING.md](docs/TESTING.md)). Several pieces are not yet tested, and it has not been run with real streamers or at scale. Read "What is not proven" before betting anything on it.

---

## How it works

```
 Phone (Moblin, IRL Pro, Larix, Belabox)
        | SRT / SRTLA / RTMP
        v
 [ mediamtx ]  ingest server, only accepts your secret path
        | RTMP (internal network)
        v
 [ OBS Studio ]  headless, 3 scenes: LIVE / LOW SIGNAL / BRB
        ^  obs-websocket (internal)          |
        |                                     | RTMP
 [ Keel controller ]                          v
   watches bitrate every second         Twitch / Kick / YouTube
   switches scenes (degrade fast, recover slow)
   dashboard, Twitch chat commands, reliability stats
```

**Switching rules** (all adjustable):

| Phone signal | Scene | Reaction time |
|---|---|---|
| Healthy (above 800 kbps) | LIVE | back to LIVE after 5 s of healthy signal |
| Weak (50 to 800 kbps) | LOW SIGNAL | after 3 s |
| Gone (below 50 kbps or disconnected) | BRB | after 2 s |

The broadcast to your platform is never stopped by a signal drop. That is the main point of the product.

## What you need

- A Linux server with Docker and Docker Compose v2. 4 vCPU and 8 GB RAM runs a 1080p30 x264 broadcast; see [docs/COSTS.md](docs/COSTS.md). An NVIDIA GPU is optional ([docs/GPU.md](docs/GPU.md)).
- Open ports on the server: `1935/tcp` (RTMP), `8890/udp` (SRT), `5000/udp` (SRTLA, optional), `8080/tcp` (dashboard).
- A streaming account and its stream key.
- A phone app that can send SRT (Moblin, IRL Pro, Larix) or SRTLA bonding (Moblin, Belabox).

## Setup (about 10 minutes)

```bash
git clone <this repo> keel && cd keel/stack
cp .env.example .env
```

Edit `.env`. Fill in the three secrets and your destination:

```bash
# generate a secret
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24
```

- `KEEL_API_TOKEN`: your dashboard password.
- `KEEL_OBS_PASSWORD`: internal, any long random value.
- `KEEL_INGEST_PATH`: your phone's stream key, in the form `live/` followed by 16 or more letters and numbers.
- `KEEL_RTMP_URL` and `KEEL_STREAM_KEY`: where the broadcast goes (Twitch default is set).
- `KEEL_PUBLIC_HOST`: the server's public IP or domain, so the dashboard prints the right phone URLs.

Start it:

```bash
docker compose up -d --build
docker compose logs -f controller
```

Open `http://<server>:8080`, sign in with `KEEL_API_TOKEN`. The dashboard shows the exact URLs to paste into your phone app, with copy buttons.

Optional bonded cellular (SRTLA): `docker compose --profile srtla up -d`. Not yet tested, see below.

### First test

1. Put the SRT URL from the dashboard into your phone app and start sending. The dashboard should flip to **LIVE** in a few seconds.
2. Press **Start broadcast**. Check your platform's dashboard, then stop the broadcast while testing if you do not want to go public.
3. Switch the phone to airplane mode for 10 seconds. The scene should go to **BRB**, the platform keeps receiving video, and it returns to LIVE a few seconds after the phone reconnects.

To test with no phone and no streaming account, run `./scripts/e2e.sh` (needs Docker and ffmpeg). It runs the whole stack with a fake phone and a fake platform.

## Dashboard and controls

- Big state word, bitrate, 5 minute signal chart, and what viewers see.
- Start or stop the broadcast, force a scene, toggle auto switching.
- Reliability record: drops held, time on BRB, longest drop, unexpected stops, skipped frames.
- Phone setup URLs and an event log.

**Twitch chat commands** (set `KEEL_TWITCH_*` in `.env`): `!status`, `!live`, `!low`, `!brb`, `!auto`, `!start`, `!stop`. Broadcaster and mods can run them. `!stop` is broadcaster only. Extra users go in `KEEL_TWITCH_ALLOWED`.

**Metrics:** `GET /metrics` (Prometheus format, needs the bearer token). **Health:** `GET /healthz`.

## Change the screens viewers see

The BRB and weak signal screens are plain 1920x1080 PNG files in `stack/assets/` (`brb.png`, `low.png`). Replace them with your own and restart the controller. `low.png` is an overlay and can use transparency. Your channel branding goes there, not Keel's.

## Security

- Put TLS in front of port 8080 (Caddy or nginx with a certificate). The token is sent as a bearer header, and in the URL for the live event stream, so do not expose it over plain HTTP on the open internet.
- Only your secret `live/<key>` path can publish or read. Treat it like a password.
- The OBS websocket and the mediamtx API are not published to the host. Keep it that way.
- Firewall to the ports listed above. Restrict 8080 to your IP if you can.

## Auto shutdown

Cloud GPU and CPU time is the main cost, so servers should stop when unused. After `KEEL_IDLE_MINUTES` with no feed, no broadcast and nobody on the dashboard, Keel runs `KEEL_IDLE_ACTION`: `log`, `exit`, or `webhook` (POSTs to `KEEL_IDLE_WEBHOOK`, so an orchestrator can stop the machine).

## Repo layout

| Path | What |
|---|---|
| `controller/` | The Keel controller (Node 22, TypeScript run natively, one dependency: `ws`). 52 tests. |
| `stack/` | Docker Compose for mediamtx, OBS, SRTLA and the controller. |
| `scripts/` | `fake-phone.sh` (simulated phone), `e2e.sh` (full test). |
| `brand/` | Logo, wordmark, icon. |
| `docs/` | Testing record, costs, GPU notes, evidence frames. |

Develop without Docker: `cd controller && npm install && npm run dev:mock`, then open `http://localhost:8080` (token `dev`). It simulates a phone that connects, weakens, drops and recovers.

## What is not proven

Be honest with yourself and your investors about these.

- **Tested for real:** controller logic, real OBS control, ingest over SRT, scene switching on drop and recovery, broadcast continuity through a drop, output reaching an RTMP receiver. Details in [docs/TESTING.md](docs/TESTING.md).
- **Not tested:** SRTLA bonding image (written, never built or run), NVIDIA encoding, real Twitch/Kick/YouTube ingest, Twitch chat control against live Twitch, a real phone on real cellular, many users at once, anything over hours.
- **Not built:** accounts, billing, multi-tenant orchestration (spinning servers up and down per customer), a hosted control plane, mobile app. This repo is one streamer's server. A business needs the layer above it.
- **Latency and glitches** are the pain with the incumbent. Keel's design avoids some causes, but real numbers need real tests on real networks. Measure before claiming anything.

## License

All rights reserved by the author until agreed otherwise. Third party components (OBS Studio, mediamtx, SRTLA, ws) keep their own licenses. The Panchang and Switzer typefaces are used under the Fontshare license and are not included in this repo.
