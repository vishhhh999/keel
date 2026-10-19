# Keel website

Static site, no build step needed to deploy. Source of truth is `build_site.py`; the generated `.html` files are committed so Vercel can serve them directly.

Deploy: import the repo in Vercel, set **Root Directory** to `web`, Framework Preset "Other", leave build command empty. `vercel.json` handles clean URLs and headers.

Edit: change `build_site.py`, run `python3 build_site.py`. Cost model assumptions live in `js/calc.js`.
