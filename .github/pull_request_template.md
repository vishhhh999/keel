## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## How it was tested

- [ ] `controller`: `npm test` and `npx tsc --noEmit`
- [ ] `platform`: `npm test` (if touched)
- [ ] `mobile`: `npm test` and `npx tsc --noEmit` (if touched)
- [ ] `web`: ran `python3 build_site.py` and committed the generated HTML (if the site or dashboard changed)
- [ ] `bash scripts/e2e.sh` locally, or relying on the CI end to end run
- [ ] Field tested on a real phone (describe below), if this changes switching, failover, the relay or the crash shield

<!-- Field test notes, screenshots of the dashboard, or numbers. -->

## Checklist

- [ ] New behaviour has a test
- [ ] No stream keys, tokens or personal data in code, logs, screenshots or the description
- [ ] No em dashes, plain sentence case copy
- [ ] Docs updated if behaviour or settings changed (`README.md`, `stack/.env.example`, `docs/`)
