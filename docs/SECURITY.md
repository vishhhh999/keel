# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Email **work@visheshmahendru.com** with the subject "Keel security" and include what you found, how to reproduce it, and the impact you expect. You will get a reply within 72 hours. Please give a reasonable time to fix the issue before disclosing it publicly. There is no bug bounty yet; credit in the changelog is offered for valid reports.

In scope: the controller, relay, dashboard and API, the platform service, the install script and the Docker stack. Out of scope: vulnerabilities in third party components (report those upstream), and attacks that need a leaked admin token.

## Hardening status

Written for the first security pass on day 6. This is a checklist, not a certification.

## What is in place

- Tenant and server tokens are random 24 byte values. Tenant tokens are stored hashed (SHA-256).
- Admin and bearer token comparisons are constant time.
- Idle hook URL carries a per-tenant secret and returns 403 on mismatch.
- Stripe webhook signatures are verified with a 5 minute tolerance.
- cloud-init values are shell quoted; a test covers an injection attempt in the repo URL.
- Per-server secrets are generated fresh on every start. OBS websocket and the mediamtx API are never published.
- Ingest path is secret. Only that path can publish or read.
- Request bodies are size limited. Malformed JSON gets a 400, not a 500.
- Stream keys and RTMP URLs sent to `/v1/server/start` cannot contain whitespace, quotes, `$` or backslashes, so they cannot inject lines into the server's env file.
- Idle hook secrets are compared in constant time.
- With HTTPS on (`deploy/install.sh`, platform servers), the plain HTTP dashboard port is bound to localhost. Docker-published ports bypass `ufw`, so this binding is what keeps 8080 off the internet.

- Controller live event stream uses one-time tickets valid for 30 seconds. Tokens are never accepted in URLs.
- A separate moderator token with no access to start/stop, destinations or settings.
- Stream keys are redacted from the dashboard, API status, logs and relay error messages.
- Dashboard pages are served with `X-Frame-Options: DENY`, `nosniff` and `no-referrer`.

## Known gaps

- No rate limiting on the platform API beyond the hourly provisioning cap.
- Stream keys and destinations pass through the platform to cloud-init user data. Provider user data is readable by anyone with provider access. Consider fetching keys from the platform at boot with a one time token.
- No account recovery or token rotation endpoint yet.
- Single admin token for operator actions.
- Hetzner adapter and Stripe flows have not been exercised against the live services.

## Before taking money

Run a dependency audit, add rate limiting at the proxy, rotate the admin token, and have someone other than the author try to break it.
