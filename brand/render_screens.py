"""Renders the two viewer screens OBS shows (stack/assets/brb.png and low.png).
Needs Playwright + Chromium. Fonts load from Fontshare (Cabinet Grotesk), so run it online.
Edit the copy or colours here, re-run, and the PNGs are rebuilt. Streamers can swap the PNGs for their own."""
import math, sys, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
HULL, BONE, BUOY = "#0E2A2F", "#F3EEE4", "#FF5B1F"
FONT = '<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700,800&display=swap" rel="stylesheet">'

def big_mark(cx, cy, r, dome, keel, tilt=-18, gap=0.26):
    g = r * gap; a = math.radians(tilt); lift = r * abs(math.sin(a)) - g + r * 0.09
    return (f'<g transform="translate({cx} {cy - lift:.1f}) rotate({tilt})"><path d="M{-r} 0A{r} {r} 0 0 1 {r} 0Z" fill="{dome}"/></g>'
            f'<path d="M{cx - r} {cy + g:.1f}H{cx + r}A{r} {r} 0 0 1 {cx - r} {cy + g:.1f}Z" fill="{keel}"/>')

BRB = f'''<!doctype html><html><head>{FONT}<style>
*{{margin:0;box-sizing:border-box}}body{{width:1920px;height:1080px;background:{HULL};color:{BONE};font-family:'Cabinet Grotesk',sans-serif;position:relative;overflow:hidden}}
.eyebrow{{position:absolute;left:120px;top:150px;font-weight:700;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:{BUOY}}}
h1{{position:absolute;left:112px;top:210px;font-weight:800;font-size:196px;line-height:.92;letter-spacing:-.045em}}
.sub{{position:absolute;left:120px;top:690px;font-weight:500;font-size:42px;line-height:1.3;color:#B9C7C4;width:760px}}
.sub b{{color:{BONE};font-weight:700}}
.chip{{position:absolute;left:120px;bottom:96px;display:flex;align-items:center;gap:16px;font-weight:700;font-size:30px}}
.rule{{position:absolute;left:0;right:0;top:691px;height:3px;background:#27505A;opacity:.0}}
svg.m{{position:absolute;right:0;top:0}}
</style></head><body>
<div class="eyebrow">Signal lost</div>
<h1>Be right<br>back.</h1>
<div class="sub">The signal moves. <b>The stream holds.</b></div>
<div class="chip"><svg width="62" height="74" viewBox="0 0 92 110">{big_mark(46, 52, 46, BUOY, BONE, gap=0.26)}</svg>keel</div>
<svg class="m" width="900" height="1080" viewBox="0 0 900 1080">{big_mark(560, 520, 330, BUOY, "#1B444B", gap=0.07)}</svg>
</body></html>'''

LOW = f'''<!doctype html><html><head>{FONT}<style>
*{{margin:0;box-sizing:border-box}}html,body{{background:transparent}}body{{width:1920px;height:1080px;font-family:'Cabinet Grotesk',sans-serif;position:relative}}
.pill{{position:absolute;left:50%;top:64px;transform:translateX(-50%);display:flex;align-items:center;gap:20px;background:{BONE};color:{HULL};border-radius:999px;padding:20px 40px 20px 28px;font-weight:800;font-size:38px;letter-spacing:-.02em;box-shadow:0 10px 40px rgba(14,42,47,.35)}}
.pill span{{font-weight:500;color:#4a5d5f}}
.dot{{width:30px;height:30px;border-radius:50%;background:{BUOY}}}
</style></head><body><div class="pill"><div class="dot"></div>Weak signal <span>holding on</span></div></body></html>'''

def main():
    out = ROOT / "stack" / "assets"; out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1920, "height": 1080})
        pg.set_content(BRB); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(2500); print(pg.evaluate("[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.weight).join()")); pg.screenshot(path=str(out / "brb.png"))
        pg.set_content(LOW); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(2500); pg.screenshot(path=str(out / "low.png"), omit_background=True)
        b.close()
    print("wrote", out)
main()
