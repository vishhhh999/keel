# Architecture

Two layers. The **stack** is one streamer's server. The **platform** creates and destroys those servers per customer.

```
 Primary phone ─┐                         per-streamer server
 Backup phone  ─┼─SRT/SRTLA/RTMP─► mediamtx ─► OBS ─program─► relay ─► Twitch / Kick / YouTube / any RTMP or SRT
                │                     ▲         ▲               ▲
                │                     └──── controller ─────────┘   (stats, scenes, sources, relay supervision)
 Keel app ──────┴──────HTTPS (Caddy)──────────┘    │ idle webhook, alerts
 Portal ───────HTTPS──► platform API ◄─────────────┘
                          │ SQLite: tenants, servers, usage, audit
                          ├─► provider (Hetzner, mock)    ├─► DNS (sslip, Cloudflare)
                          └─◄ Stripe webhooks
```

## Per-streamer server (`stack/`, `controller/`)

| Part | Job |
|---|---|
| mediamtx | Accepts SRT, RTMP and SRTLA (through the receiver) on secret paths `live/<key>` and `live/<key>-backup`. Exposes bitrate and per-connection SRT statistics. Also carries the OBS program on the internal path `out/<key>`. |
| OBS (headless) | Scenes LIVE, LOW SIGNAL, BRB. Both ingest feeds are loaded and kept decoding; only the active one is visible, so a failover is instant. Encodes one program and sends it to `out/<key>` (relay mode) or straight to one platform (direct mode). |
| controller | Polls both feeds every second, runs a switcher per feed, picks the healthier source, drives OBS scenes and visibility, supervises the relay, restarts stopped broadcasts, serves dashboard and API, chat bot, alerts, metrics, reliability log. |
| relay (in the controller container) | One ffmpeg per destination copying `out/<key>` without re-encoding. Supervised with backoff. When the program is missing for `KEEL_SHIELD_DELAY_S` while live, switches every destination to an encoded BRB still (crash shield) and back when the program returns. |
| Caddy (profile `tls`) | HTTPS for dashboard and API. |
| SRTLA receiver (profile `srtla`) | Bonded cellular ingest. Untested. |

### Decisions

- **Degrade fast, recover slow.** BRB within 2 s of a dead feed, back to LIVE only after 5 s healthy. Prevents flapping.
- **Bitrate is not enough on SRT.** A link can deliver full bitrate while packets arrive too late to display. The switcher also treats late (dropped) packets above 2% and loss above 20% as weak. RTT is shown, not switched on, because a high but stable RTT inside the SRT latency budget is fine.
- **Primary wins ties.** The backup is shown only when it is strictly healthier, so the stream returns to the main camera as soon as it is stable again.
- **OBS never talks to the internet in relay mode.** Platform hiccups are absorbed by the relay, one destination at a time. OBS crashes are absorbed by the crash shield. The cost is one local RTMP hop (negligible) and an ffmpeg per destination (copy, light).
- **Broadcast intent.** "Go live" sets intent. While intent is on, Keel restarts an OBS output that stops unexpectedly and resumes after an OBS restart. Only "Stop" clears it.

## Platform (`platform/`)

Node 22, no dependencies, built-in `node:sqlite`. One process, one file database.

- **Tenants:** created by an admin call, optionally linked to a Stripe customer. Account token stored hashed.
- **Start:** renders cloud-init with fresh per-server secrets and the tenant's destinations, creates a labelled server at the provider, records `booting`.
- **Hostnames:** `sslip` (default) derives `<ip>.sslip.io` on the server at boot, zero setup, real certificates. `cloudflare` creates `<tenant>.<domain>` A records via API and removes them on stop.
- **Readiness:** a tick every 15 s checks `https://<host>/healthz` and flips `booting` to `running`. Servers that do not come up within `KEEL_BOOT_TIMEOUT_MIN` are destroyed and marked failed.
- **Access:** `/v1/me` returns the dashboard URL, dashboard token and primary/backup phone addresses once the server exists.
- **Idle shutdown:** the controller POSTs to `/v1/hooks/idle/<tenant>/<secret>`; the platform destroys the server and meters the session.
- **Billing:** Stripe webhooks (signature verified) suspend a tenant and stop its server on failed payment or cancellation, and reactivate on payment.
- **Orphan sweeper:** hourly, destroys provider servers labelled `keel=1` that no tenant owns, after a 30 minute grace period.
- **Prebuilt images:** cloud-init pulls `KEEL_IMAGE_PREFIX` images published by `.github/workflows/images.yml` before falling back to building.

## Known limits

- One region per deployment, one server per tenant.
- Single platform process. Fine for tens to low hundreds of tenants.
- SRT link stats for SRTLA publishers describe the receiver to mediamtx hop, not the cellular links. Per-link bonding stats need the receiver to expose them (roadmap).
