# Contributing to Keel

Thanks for helping. The most valuable contribution right now is not code: it is a **real stream on a real phone network**, with notes on what happened. Keel has passed every test on servers with simulated phones; it has not yet carried a real IRL stream.

Read the [license](LICENSE) first: Keel is source-available, not open source. Contributions are licensed to the maintainer under the same terms.

## Report a field test

Use the **Field test report** issue template. The most useful details:

- Phone, app (Moblin, IRL Pro, Larix, Belabox) and settings, especially SRT latency and bitrate.
- Network: carrier(s), bonding or not, moving or still, city type.
- What viewers saw at each drop, and the dashboard's round trip, loss and dropped numbers at the time.
- The reliability record at the end of the stream (drops held, failovers, time on BRB, unexpected stops).

## Report a bug

Use the **Bug report** template. Include `docker compose logs --tail 200 controller obs mediamtx` with stream keys and tokens removed. Keel redacts keys from its own logs, but check anyway.

**Security issues:** do not open a public issue. See [docs/SECURITY.md](docs/SECURITY.md).

## Change the code

```bash
cd controller && npm install && npm test && npx tsc --noEmit   # 81 tests
cd platform && npm test                                         # 16 tests
cd mobile && npm install --legacy-peer-deps && npm test && npx tsc --noEmit
cd web && python3 build_site.py                                 # regenerates the site
bash scripts/e2e.sh                                             # full Docker test with real OBS (needs Docker and ffmpeg)
```

Explore the dashboard without Docker: `cd controller && npm run dev:mock`, open `http://localhost:8080`, token `dev`.

Rules that keep the project healthy:

- **Tests with every behaviour change.** If it touches switching, failover, the relay or the crash shield, add or update a test in `controller/test/`.
- **Never edit generated HTML.** Change `web/build_site.py` and run it. CI fails if they disagree. The live demo is generated from `controller/public/index.html`.
- **No em dashes** anywhere, in code, docs or copy. CI checks.
- **Voice:** plain words, short sentences, sentence case ending with a period. Never claim what has not been measured.
- **Brand:** one typeface (Cabinet Grotesk), one orange used sparingly. See `docs/Keel-brand-guidelines.pdf`.
- **Small pull requests** with a clear "what and why". The template asks for how you tested.

CI must be green (unit tests, site check, Docker end to end) before merging.
