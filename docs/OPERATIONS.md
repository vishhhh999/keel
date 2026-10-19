# Operations

## Run the platform

```bash
cd platform
KEEL_PROVIDER=hetzner HCLOUD_TOKEN=... KEEL_ADMIN_TOKEN=$(openssl rand -hex 24) \
KEEL_PLATFORM_URL=https://api.example.com KEEL_DOMAIN=streams.example.com \
KEEL_REPO=https://github.com/OWNER/keel.git STRIPE_WEBHOOK_SECRET=whsec_... \
npm start
```

Put it behind Caddy or nginx with TLS. Back up `platform.db` nightly (`sqlite3 platform.db ".backup backup.db"`).

## Add a customer

```bash
curl -X POST https://api.example.com/v1/admin/tenants \
  -H "authorization: Bearer $KEEL_ADMIN_TOKEN" -d '{"name":"Channel name","email":"them@example.com","stripeCustomer":"cus_..."}'
```

`stripeCustomer` is optional but required for Stripe webhooks to suspend or reactivate the account. The response holds their account token once. Give it to them securely. Only its hash is stored.

## Daily checks

- `GET /healthz` on the platform and on each server.
- Servers in state `error`: `sqlite3 platform.db "select * from servers where state='error'"`.
- Orphans: servers at the provider with no `running` row. Compare provider list to the table weekly. (Automating this is ROADMAP item 3.)
- Audit trail: `select * from audit order by id desc limit 50`.

## Incident playbook

| Symptom | First move |
|---|---|
| Streamer says broadcast is down | Dashboard `/api/status`: is OBS connected, is it streaming? `docker compose logs obs controller`. |
| Server will not start | Provider quota or token. Check `servers.error`. |
| Server stuck in `error` | `POST /v1/server/stop` with the tenant token. It destroys the provider server if one was created, so it stops billing. |
| Bills too high | Servers not stopping. Check idle webhook reachability from the server to the platform URL. |
| Wrong state shown on dashboard | Compare to mediamtx bitrate. Check thresholds in `.env`. |

## Metrics

Each controller exposes `/metrics` (Prometheus). Scrape them from a central Prometheus using the server IPs the platform stores.
