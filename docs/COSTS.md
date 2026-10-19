# Cost notes

These are planning estimates, not quotes. Check current cloud pricing before relying on any number.

## What costs money

1. **Compute while live.** The OBS server runs only during a stream. CPU encoding at 1080p30 needs roughly 4 vCPU and 8 GB. A GPU instance is more expensive per hour but can be more consistent for 1080p60.
2. **Egress.** The broadcast leaves the server at about 6 Mbps, which is roughly 2.7 GB per hour. Many clouds charge for this. Some hosts include generous bandwidth.
3. **Idle time.** Keel can stop the server when unused (`KEEL_IDLE_ACTION=webhook`), so cost follows usage.

## Rough per stream-hour

| Setup | Order of magnitude |
|---|---|
| Small VPS provider, CPU x264, bandwidth included | well under $1 per hour |
| Big cloud CPU instance, 4 vCPU, plus egress | about $0.30 to $0.60 per hour |
| Big cloud GPU instance (NVENC) | about $0.60 to $1.50 per hour |

A streamer live 100 hours a month lands somewhere around $30 to $150 in raw infrastructure depending on the choices above. That sets the floor for pricing. The incumbent's pricing and margins are not verified here.

## Business layer not included

Per-customer provisioning, billing, support and monitoring are not in this repo and are the real cost of running this as a service. A solo founder can run a small number of hand-managed servers. Dozens of customers needs an orchestration layer and someone on call during peak streaming hours.
