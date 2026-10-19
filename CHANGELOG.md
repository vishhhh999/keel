# Changelog

## v0.3

Reliability
- Backup encoder on every server with automatic failover (`live/<key>-backup`), manual pin, failover count in the reliability record.
- SRT-aware switching: late (dropped) packets and packet loss count as a weak signal; RTT, loss, drops and SRT buffer on the dashboard and in metrics.
- Multistream relay: one supervised ffmpeg per destination, copy only, independent reconnects with backoff, destinations toggled live. `KEEL_DESTINATIONS`.
- Crash shield: when the OBS program is missing while live, every destination receives an encoded BRB screen until OBS returns.
- Broadcast intent and auto-recover: unexpected output stops are restarted with backoff; after an OBS restart the broadcast resumes by itself.
- Lower latency default for the OBS network buffer (1 MB) and media sources that stay decoded for instant switching. `KEEL_RESOLUTION`, `KEEL_X264_PRESET`, `KEEL_INPUT_BUFFER_MB`.

Control
- Switching rules editable live from the dashboard and API, saved across restarts.
- Moderator token with limited rights.
- Discord or Slack crew alerts, throttled.
- One-time tickets for the live event stream; tokens no longer accepted in URLs.
- Dashboard rebuilt: link quality, round trip chart, sources with QR setup, destinations, rules, crash shield banner.
- `!source` chat command.

Platform
- Customers now receive their dashboard URL, token and phone addresses (`/v1/me`).
- Hostnames with HTTPS: sslip.io (zero setup) or Cloudflare DNS.
- `booting` until the server answers over HTTPS; boot timeout destroys stuck servers.
- Hourly orphan sweeper for labelled servers.
- Multistream destinations at start; suspension stops running servers; additive DB migration.
- Portal rebuilt.

Delivery
- GitHub Actions: all tests, site build check, em dash check, Docker end to end.
- Prebuilt images to GHCR; installer and cloud-init pull before building.
- `install.sh`: multistream, sslip default, moderator token, alerts.
- Website: features, honest comparison, live demo of the real dashboard, phone setup guides, investors, take it forward, status.
- Mobile app: link quality, sources, destinations, moderator awareness.

## v0.2

Platform layer, mobile app, website, deploy script, brand system and guide.

## v0.1

Controller, Docker stack, real OBS end to end verification.
