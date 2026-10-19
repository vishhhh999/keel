# Launch in a week

Assumes one funded owner, one engineer who can read Node and Docker, and one anchor streamer willing to test. Each day has a definition of done. Do not move on until it is true.

| Day | Do | Done when |
|---|---|---|
| 1 | Push the repo to GitHub (CI runs every test and the Docker end to end, `images.yml` publishes images). Create a cloud account (Hetzner is wired in). Run `bash deploy/install.sh` on a test server, no domain needed. | CI green. Dashboard loads over HTTPS with a valid certificate. |
| 2 | Two real phones on two carriers, a moving car. Primary on SRT, backup on the backup address. Then SRTLA bonding. Run `bash scripts/chaos.sh 20`. | Ten minute drive, broadcast down count 0, at least one failover seen. |
| 3 | Real Twitch, Kick and YouTube at once through the relay. Measure glass to glass latency with a visible clock. Kill OBS mid-stream and watch the crash shield on all three. Try NVENC or stay on CPU. | Latency written down, crash shield seen live, encoder decision made. |
| 4 | Deploy `platform/` with `KEEL_PROVIDER=hetzner`, `KEEL_IMAGE_PREFIX` set, sslip or Cloudflare DNS. Create two test tenants. Start and stop from the portal. | Two tenants each get a working HTTPS server (state `running`), and it deletes itself when idle. |
| 5 | Stripe: products, webhook to `/v1/stripe`, suspend on failed payment. Report metered hours. Build the mobile app with EAS and put it in TestFlight and Play internal testing. | One test payment clears. App connects to a real server. |
| 6 | Eight hour soak on a real broadcast. Security pass (see SECURITY.md). Backups of `platform.db`. | Soak passes with 0 unexpected stops. Checklist complete. |
| 7 | Onboard three pilot streamers. Sit in their chat. | Three real streams ran through Keel. A list of what broke. |

## Day 0 checklist (do before day 1)

- Read platform policies on restreaming for Twitch, Kick and YouTube.
- Decide name and trademark check for the brand in your markets.
- Pick a price. The cost model on the website is a starting point only.
- Agree who answers support messages during the first month.

## What will probably go wrong

1. First boot is slow if images build on the server. Set `KEEL_IMAGE_PREFIX` so servers pull the CI-built images.
2. Some phone apps want specific SRT latency settings. Capture a per-app setup guide on day 2.
3. NVENC needs host drivers and the NVIDIA container runtime. If it fights you, ship CPU first.
