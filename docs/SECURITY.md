# Security

Written for the first security pass on day 6. This is a checklist, not a certification.

## What is in place

- Tenant and server tokens are random 24 byte values. Tenant tokens are stored hashed (SHA-256).
- Admin and bearer token comparisons are constant time.
- Idle hook URL carries a per-tenant secret and returns 403 on mismatch.
- Stripe webhook signatures are verified with a 5 minute tolerance.
- cloud-init values are shell quoted; a test covers an injection attempt in the repo URL.
- Per-server secrets are generated fresh on every start. OBS websocket and the mediamtx API are never published.
- Ingest path is secret. Only that path can publish or read.
- Request bodies are size limited.

## Known gaps

- Token in the URL for the live event stream (SSE) on the controller. Move to short lived tickets.
- No rate limiting on the platform API beyond the hourly provisioning cap.
- Stream keys pass through the platform to cloud-init user data. Provider user data is readable by anyone with provider access. Consider fetching keys from the platform at boot with a one time token.
- No account recovery or token rotation endpoint yet.
- Single admin token for operator actions.
- Hetzner adapter and Stripe flows have not been exercised against the live services.

## Before taking money

Run a dependency audit, add rate limiting at the proxy, rotate the admin token, and have someone other than the author try to break it.
