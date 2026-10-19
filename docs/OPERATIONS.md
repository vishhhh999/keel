# Operations

## Run the platform

```bash
cd platform
KEEL_PROVIDER=hetzner HCLOUD_TOKEN=... KEEL_ADMIN_TOKEN=$(openssl rand -hex 24) \
KEEL_PLATFORM_URL=https://api.example.com KEEL_REPO=https://github.com/vishhhh999/keel.git \
KEEL_IMAGE_PREFIX=ghcr.io/vishhhh999/keel STRIPE_WEBHOOK_SECRET=whsec_... \
npm start
# Branded hostnames instead of <ip>.sslip.io:
#   KEEL_DNS=cloudflare CF_API_TOKEN=... CF_ZONE_ID=... KEEL_DOMAIN=streams.example.com
```

Put it behind Caddy or nginx with TLS. Back up `platform.db` nightly (`sqlite3 platform.db ".backup backup.db"`).

## Add a customer

```bash
curl -X POST https://api.example.com/v1/admin/tenants \
  -H "authorization: Bearer $KEEL_ADMIN_TOKEN" -d '{"name":"Channel name","email":"them@example.com","stripeCustomer":"cus_..."}'
```

`stripeCustomer` is optional but required for Stripe webhooks to suspend or reactivate the account. The response holds their account token once. Give it to them securely. Only its hash is stored.

## What a customer gets

`GET /v1/me` (or the portal at `/`) returns the server state (`provisioning`, `booting`, `running`), the dashboard URL and token, and the primary and backup phone addresses. Start takes `{"destinations":[{"name":"Twitch","url":"rtmp://live.twitch.tv/app/live_..."}]}`.

## Daily checks

- `GET /healthz` on the platform and on each server.
- Servers in state `error`: `sqlite3 platform.db "select * from servers where state='error'"`.
- Orphans: the sweeper runs hourly and logs `sweeper.destroy` in the audit table.
- Audit trail: `select * from audit order by id desc limit 50`.

## Incident playbook

| Symptom | First move |
|---|---|
| Streamer says broadcast is down | Dashboard: destinations card shows which platform is retrying and why. `docker compose logs controller obs`. |
| Crash shield stuck on | OBS is not coming back. `docker compose logs obs`, then `docker compose restart obs`. Viewers see BRB meanwhile. |
| False BRBs | Raise `BRB after` or lower `Gone below` in the dashboard's switching rules, live. Check the Dropped chip: if it is high, raise SRT latency in the phone app. |
| Server will not start | Provider quota or token. Check `servers.error`. |
| Server stuck in `error` | `POST /v1/server/stop` with the tenant token. It destroys the provider server if one was created, so it stops billing. |
| Bills too high | Servers not stopping. Check idle webhook reachability from the server to the platform URL. |
| Wrong state shown on dashboard | Compare to mediamtx bitrate. Check thresholds in `.env`. |

## Metrics

Each controller exposes `/metrics` (Prometheus). Scrape them from a central Prometheus using the server IPs the platform stores.
