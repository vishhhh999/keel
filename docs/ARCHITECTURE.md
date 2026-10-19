# Architecture

Two layers. The **stack** is one streamer's server. The **platform** is the layer that creates and destroys those servers per customer.

```
 Streamer phone ──SRT/SRTLA──► [ per-streamer server ]  ──RTMP──► Twitch / Kick / YouTube
        ▲                         mediamtx → OBS ← controller
        │                                              │ idle webhook
  Keel mobile app ─────HTTPS─────────────────────────┐ │
  Browser portal ────HTTPS──► [ platform API ] ◄─────┴─┘
                                  │  SQLite (tenants, servers, usage, audit)
                                  ├─► provider adapter (Hetzner, mock)
                                  └─◄ Stripe webhooks
```

## Per-streamer server (`stack/`, `controller/`)

| Part | Job |
|---|---|
| mediamtx | Accepts SRT, RTMP and SRTLA, only on the secret `live/<key>` path. Exposes bitrate. |
| OBS (headless) | Three scenes. Renders and encodes. Controlled over obs-websocket, never exposed. |
| controller | Reads bitrate each second, decides state, drives OBS, serves dashboard and API, logs reliability. |
| Caddy (profile `tls`) | HTTPS for the dashboard and API. |
| SRTLA receiver (profile `srtla`) | Bonded cellular ingest. |

State rule: degrade fast (2 s dead, 3 s weak), recover slow (5 s healthy). Thresholds are env vars.

## Platform (`platform/`)

Node 22, no dependencies, built-in `node:sqlite`. One process, one file database.

- **Tenants:** created by an admin call. Each gets an account token (stored hashed) and an idle-hook secret.
- **Server lifecycle:** `start` renders a cloud-init script with fresh per-server secrets, calls the provider, records the server. `stop` destroys it and writes a usage row.
- **Idle shutdown:** the controller POSTs to `/v1/hooks/idle/<tenant>/<secret>` after N idle minutes. The platform stops the server and meters the session.
- **Billing:** Stripe webhooks (signature verified in code) suspend or reactivate a tenant. Metered hours are read from the `usage` table; wiring them into Stripe usage records is a day 5 task.
- **Safety rails:** hourly provisioning cap, suspended tenants cannot start, provider errors are stored on the server row.

## Why servers are per streamer, not shared

One OBS per streamer keeps scenes, encoder load and failure isolated. A crash hits one customer. The cost is idle compute, which the idle shutdown hook removes.

## Known limits

- One region per deployment, one server per tenant.
- Server boot takes a few minutes (Docker build). Pre-baked images are the first optimisation: see ROADMAP.
- Platform is a single process. Fine for tens of tenants, not thousands.
