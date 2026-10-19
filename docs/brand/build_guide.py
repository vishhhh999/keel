"""Builds docs/Keel-brand-guidelines.pdf from this file. Needs Playwright + Chromium and an internet connection for the font."""
import math, pathlib
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).resolve().parent
H, B, O, F, K, L, T, S, R, M = "#0E2A2F", "#F3EEE4", "#FF5B1F", "#BFE3D6", "#1F7A55", "#F5B83D", "#3C7E96", "#E6D6B8", "#8A2F12", "#7BDDB0"

def mark(r, dome, keel, tilt=-18, gap=0.26, w=None):
    g = r * gap; a = math.radians(tilt); lift = r * abs(math.sin(a)) - g + r * 0.09
    pts = []
    for t in range(0, 181, 5):
        th = math.radians(t); x, y = r * math.cos(th), -r * math.sin(th)
        pts.append((x*math.cos(a) - y*math.sin(a), x*math.sin(a) + y*math.cos(a) - lift))
    for x in (-r, r): pts.append((x*math.cos(a), x*math.sin(a) - lift))
    x0 = min(min(p[0] for p in pts), -r); x1 = max(max(p[0] for p in pts), r); y0 = min(p[1] for p in pts); y1 = g + r
    pad = 2
    vb = f"{x0-pad:.1f} {y0-pad:.1f} {x1-x0+2*pad:.1f} {y1-y0+2*pad:.1f}"
    s = (f'<svg viewBox="{vb}" {"width=%d" % w if w else ""} xmlns="http://www.w3.org/2000/svg">'
         f'<g transform="translate(0 {-lift:.1f}) rotate({tilt})"><path d="M{-r} 0A{r} {r} 0 0 1 {r} 0Z" fill="{dome}"/></g>'
         f'<path d="M{-r} {g:.1f}H{r}A{r} {r} 0 0 1 {-r} {g:.1f}Z" fill="{keel}"/></svg>')
    return s

def lum(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    f = lambda v: v/12.92 if v <= .03928 else ((v+.055)/1.055)**2.4
    return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2])
def cr(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True); return f"{(x+.05)/(y+.05):.1f}"

def foot(n, dark=False):
    c = B if dark else H
    return f'<div class="foot" style="color:{c}"><img src="../../brand/keel-lockup{"-on-dark" if dark else ""}.svg" height="34"><span class="cap">Brand guidelines</span><span>{n:02d} / 10</span></div>'

pages = []
# 1 cover
pages.append(f'''<section class="p" style="background:{H};color:{B}">
<div class="eyebrow" style="color:{O};top:84px;left:120px;position:absolute">Brand guidelines · version 1.0</div>
<h1 style="position:absolute;left:112px;top:210px;font-size:214px;line-height:.9">keel<br>brand<br>guide.</h1>
<div class="lead" style="position:absolute;left:120px;bottom:90px;width:720px;color:#B9C7C4">A calm, level line under a moving stream. Everything in this guide follows from that one idea.</div>
<div style="position:absolute;right:-180px;top:70px;width:1000px">{mark(430, O, "#1B444B", gap=.07)}</div>
</section>''')
# 2 idea
pages.append(f'''<section class="p" style="background:{O};color:{H}">
<div class="eyebrow" style="position:absolute;top:84px;left:120px">01 · The idea</div>
<h2 style="position:absolute;left:112px;top:170px;font-size:132px;line-height:.92;width:1000px">The signal moves.<br>The stream holds.</h2>
<div class="lead" style="position:absolute;left:120px;bottom:170px;width:760px">A streamer walks through a city. Networks wobble, phones overheat, trains go underground. Keel is the part that does not move: the fixed line under the boat.</div>
<div class="card" style="position:absolute;right:120px;top:150px;width:640px;height:780px;background:{B};border-radius:44px;padding:56px;display:flex;flex-direction:column;justify-content:space-between">
 <div><span class="pill" style="background:{H};color:{B}">Above the line</span><h3>The signal moves.</h3><p>Cellular, Wi-Fi, bonding links, a phone in a pocket. Out of anyone's control.</p></div>
 <div style="height:3px;background:{H};margin:0 -56px"></div>
 <div><span class="pill" style="background:{O};color:{H}">Below the line</span><h3>The stream holds.</h3><p>Ingest, encoder and platform connection stay up. Viewers see a designed screen, not a dead stream.</p></div>
</div>{foot(2)}</section>''')
# 3 logo
def tile(bg, inner, w, h, r=44, extra=""):
    return f'<div style="background:{bg};border-radius:{r}px;width:{w}px;height:{h}px;display:flex;align-items:center;justify-content:center;{extra}">{inner}</div>'
pages.append(f'''<section class="p" style="background:{B};color:{H}">
<div class="eyebrow" style="color:{T};position:absolute;top:84px;left:120px">02 · Logo</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">One mark, level.</h2>
<div style="position:absolute;left:120px;top:290px;display:flex;gap:28px">
 {tile(H, '<img src="../../brand/keel-lockup-on-dark.svg" height="110">', 540, 300)}
 {tile(O, '<img src="../../brand/keel-lockup-on-orange.svg" height="110">', 400, 300)}
 {tile(F, '<div style="width:150px">'+mark(60, O, H)+'</div>', 300, 300, 999)}
 {tile(B, '<img src="../../brand/keel-lockup.svg" height="90">', 400, 300, 44, f"border:3px solid {H}")}
</div>
<div class="cap" style="position:absolute;left:120px;top:610px;width:900px">Primary lockup. Default on hull, buoy and bone. Mark only when the name sits nearby. Clear space is the height of the circle's bottom half on every side. Minimum width 96 px, mark only 24 px.</div>
<div class="eyebrow" style="color:{R};position:absolute;left:120px;top:715px">Never</div>
<div style="position:absolute;left:120px;top:758px;display:flex;gap:24px">
 {tile(B, '<div style="width:80px;transform:rotate(-30deg)">'+mark(40,O,H)+'</div>',200,130,28,f"border:3px solid {H}")}
 {tile(B, '<div style="width:80px">'+mark(40,O,H,tilt=0)+'</div>',200,130,28,f"border:3px solid {H}")}
 {tile(B, '<div style="width:80px">'+mark(40,"#FF3DA5","#7a2cff")+'</div>',200,130,28,f"border:3px solid {H}")}
 {tile(H, '<div style="width:80px">'+mark(40,"#2a4a4f","#1d3a40")+'</div>',200,130,28)}
</div>
<div class="cap" style="position:absolute;left:120px;top:890px;width:1000px;display:flex;gap:24px"><span style="width:200px">Do not rotate the whole mark</span><span style="width:200px">Do not level the top half</span><span style="width:200px">Do not recolor</span><span style="width:200px">Do not use low contrast</span></div>
{foot(3)}</section>''')
# 4 colour
core = [("Hull", H, "Dark canvas, text", B), ("Bone", B, "Default canvas", H), ("Buoy", O, "Signal, primary action", H), ("Foam", F, "Soft highlight", H)]
acc = [("Mint", M, "Live on dark", H), ("Kelp", K, "Live on bone", B), ("Lamp", L, "Weak signal", H), ("Tide", T, "Charts, links", B), ("Sand", S, "Warm ground", H), ("Rust", R, "Errors on bone", B)]
def ctile(n, c, role, fg, big=True):
    bd = f"border:3px solid {H};" if c == B else ""
    h = 330 if big else 250; w = 405 if big else 266
    return f'''<div style="background:{c};color:{fg};{bd}border-radius:44px;width:{w}px;height:{h}px;padding:32px 36px;display:flex;flex-direction:column;justify-content:space-between"><div style="display:flex;justify-content:space-between;align-items:flex-start"><span class="aa" style="font-size:{86 if big else 60}px">Aa</span><span class="cap" style="color:{fg}">{cr(fg, c)}:1</span></div><div><div class="t" style="font-size:{34 if big else 28}px">{n}</div><div class="cap" style="color:{fg}">{c.upper()}</div><div class="cap" style="color:{fg};opacity:.85">{role}</div></div></div>'''
pages.append(f'''<section class="p" style="background:{B};color:{H}">
<div class="eyebrow" style="color:{T};position:absolute;top:84px;left:120px">03 · Colour</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">Four core, six accent.</h2>
<div style="position:absolute;left:120px;top:290px;display:flex;gap:24px">{"".join(ctile(*c) for c in core)}</div>
<div style="position:absolute;left:120px;top:640px;display:flex;gap:16px">{"".join(ctile(*c, big=False) for c in acc)}</div>
<div class="cap" style="position:absolute;left:120px;top:910px;width:1680px;color:{H}"><b>Buoy is a signal, not a fill.</b> It never carries small text on bone (2.7:1). Put hull on buoy (4.9:1). Balance on a page: about 60% bone or hull, 25% one accent block, 15% buoy.</div>
{foot(4)}</section>''')
# 5 type
rows = [("Display", "ExtraBold 250 · 86% · -5%", "Cover headlines"), ("H1", "ExtraBold 168 · 90% · -4.5%", "Slide titles"), ("H2", "ExtraBold 112 · 95% · -4%", "Page titles"), ("H3", "ExtraBold 44 · 105% · -2%", "Card titles"), ("Lead", "Medium 34 · 130% · 0", "Subtitles"), ("Body", "Medium 28 · 135% · 0", "Paragraph copy"), ("Label", "Bold 22 · 100% · 0", "Pills, tags"), ("Eyebrow", "Bold 24 · 100% · +12% · caps", "Section labels"), ("Numeral", "ExtraBold 160 · 90% · -5%", "Big stats")]
pages.append(f'''<section class="p" style="background:{H};color:{B}">
<div class="eyebrow" style="color:{O};position:absolute;top:84px;left:120px">04 · Type</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">One family. Tight, warm.</h2>
<div class="card" style="position:absolute;left:120px;top:300px;width:760px;height:290px;background:#14363C;border-radius:44px;padding:40px 48px;border:3px solid #27505A">
 <div class="t" style="font-size:44px">Cabinet Grotesk</div><p style="font-size:26px;color:#B9C7C4;margin-top:14px">Medium for reading, Bold for labels, ExtraBold for headlines. Sentence case, ending with a period. Caps only for eyebrows. Free from Fontshare, no second family, no mono.</p></div>
<div style="position:absolute;left:120px;top:640px;font-weight:800;font-size:170px;line-height:.9;letter-spacing:-.05em">Held.<br><span style="color:{O}">Level.</span></div>
<div style="position:absolute;left:1010px;top:300px;width:790px">{"".join(f'<div style="display:flex;border-top:2px solid #27505A;padding:13px 0;font-size:24px"><span style="width:170px;color:{O};font-weight:700">{a}</span><span style="width:340px;font-weight:700">{b}</span><span style="color:#9FB3B0">{c}</span></div>' for a,b,c in rows)}<div style="border-top:2px solid #27505A"></div></div>
{foot(5, True)}</section>''')
# 6 shape
pages.append(f'''<section class="p" style="background:{B};color:{H}">
<div class="eyebrow" style="color:{T};position:absolute;top:84px;left:120px">05 · Shape and layout</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">Sit on the line.</h2>
<div style="position:absolute;left:120px;top:300px;width:900px;height:560px;background:{H};border-radius:44px;overflow:hidden">
 <div style="position:absolute;left:0;right:0;top:340px;height:4px;background:{O}"></div>
 <div class="cap" style="position:absolute;left:36px;top:500px;color:{O}">Waterline at 64% of the height</div>
 <div style="position:absolute;left:60px;top:150px;width:220px;height:190px;background:{F};border-radius:220px 220px 0 0"></div>
 <div style="position:absolute;left:310px;top:230px;width:140px;height:110px;background:{O};border-radius:140px 140px 0 0"></div>
 <div style="position:absolute;left:480px;top:50px;width:90px;height:290px;background:{M};border-radius:60px"></div>
 <div style="position:absolute;left:620px;top:352px;width:230px;height:170px;background:{B};border-radius:0 0 230px 230px"></div>
 <div style="position:absolute;left:310px;top:352px;width:230px;height:60px;background:{L};border-radius:999px"></div>
 <div class="cap" style="position:absolute;left:36px;top:36px;color:#9FB3B0">Domes stand on the line. Bowls hang from it.</div>
</div>
<div style="position:absolute;left:1080px;top:300px;width:720px;display:grid;grid-template-columns:1fr 1fr;gap:30px 34px">
 <div><div style="width:170px;height:100px;background:{O};border-radius:170px 170px 0 0"></div><div class="t" style="font-size:36px;margin-top:14px">Dome</div><div class="cap">Good news, live state, stats</div></div>
 <div><div style="width:170px;height:100px;background:{H};border-radius:0 0 170px 170px"></div><div class="t" style="font-size:36px;margin-top:14px">Bowl</div><div class="cap">Weight, proof, records</div></div>
 <div><div style="width:80px;height:100px;background:{M};border-radius:60px"></div><div class="t" style="font-size:36px;margin-top:14px">Capsule</div><div class="cap">Bars, portraits, handles</div></div>
 <div><div style="width:100px;height:100px;background:{L};border-radius:50%"></div><div class="t" style="font-size:36px;margin-top:14px">Disc</div><div class="cap">Numbers, dots, status</div></div>
</div>
<div class="cap" style="position:absolute;left:120px;top:890px;width:1680px">Canvas 1920 by 1080. Margins 120, eyebrow at 84, title at 124, footer at 1004. Cards radius 36 to 44, outline 3 px or solid. Rounded, never sharp. No gradients, no shadows, no glow.</div>
{foot(6)}</section>''')
# 7 states
def scard(word, sub, col, tilt, tx, dome, note):
    return f'''<div style="width:540px;height:600px;border-radius:44px;background:{col};color:{tx};padding:44px;display:flex;flex-direction:column;justify-content:space-between"><div style="width:210px">{mark(60, dome, tx, tilt=tilt)}</div><div><div class="t" style="font-size:84px;line-height:.95;letter-spacing:-.045em">{word}</div><p style="font-size:26px;margin-top:12px">{sub}</p><div class="cap" style="margin-top:16px;color:{tx}">{note}</div></div></div>'''
pages.append(f'''<section class="p" style="background:{H};color:{B}">
<div class="eyebrow" style="color:{O};position:absolute;top:84px;left:120px">06 · State</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">The tilt tells you.</h2>
<div style="position:absolute;left:120px;top:300px;display:flex;gap:30px">
 {scard("Live.", "Healthy bitrate. The top half sits almost level.", M, -6, H, H, "Mint on dark · Kelp on bone · 6° tilt")}
 {scard("Weak signal.", "Bitrate below the floor. A slow tilt, not an alarm.", L, -12, H, H, "Lamp · 12° tilt")}
 {scard("Holding on.", "Feed gone. Viewers see the BRB screen, broadcast stays up.", O, -18, H, B, "Buoy · 18° tilt")}
</div>
<div class="cap" style="position:absolute;left:120px;top:930px;width:1680px;color:#B9C7C4">State is never color alone: a word, a color and a tilt angle always travel together, so it reads in sunlight and for color-blind users.</div>
{foot(7, True)}</section>''')
# 8 product
pages.append(f'''<section class="p" style="background:{S};color:{H}">
<div class="eyebrow" style="color:{R};position:absolute;top:84px;left:120px">07 · Product</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">Calm under pressure.</h2>
<img src="dashboard.png" style="position:absolute;left:120px;top:290px;height:660px;border-radius:36px;border:3px solid {H}">
<img src="dashboard-mobile.png" style="position:absolute;left:960px;top:290px;height:660px;border-radius:44px;border:3px solid {H}">
<div class="cap" style="position:absolute;left:1240px;top:330px;width:560px;color:{H}">Big state word. One primary action. Bone cards on a bone page, hull where the live data is. Built to read on a phone in sunlight.</div>
{foot(8)}</section>''')
# 9 voice
good = ["Signal lost. Stream held.", "Drops held: 7. Unexpected stops: 0.", "Weak signal. Holding on.", "Your server stops itself when you do."]
bad = ["REVOLUTIONARY ULTRA-RELIABLE STREAMING!!!", "Never drops, guaranteed 100% uptime.", "Leverage our synergistic cloud solution.", "Go beast mode and dominate the stream."]
def vrow(t, ok):
    return f'<div style="height:96px;border-radius:999px;display:flex;align-items:center;padding:0 40px;font-weight:700;font-size:32px;{"background:%s" % F if ok else "border:3px solid %s;color:%s" % (R, R)}">{t}</div>'
pages.append(f'''<section class="p" style="background:{B};color:{H}">
<div class="eyebrow" style="color:{T};position:absolute;top:84px;left:120px">08 · Voice</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">Plain words, short lines.</h2>
<div style="position:absolute;left:120px;top:300px;width:810px;display:grid;gap:18px"><div class="t" style="font-size:44px;display:flex;align-items:center;gap:16px"><span class="disc" style="background:{K}"></span>Write like this</div>{"".join(vrow(t, True) for t in good)}</div>
<div style="position:absolute;left:990px;top:300px;width:810px;display:grid;gap:18px"><div class="t" style="font-size:44px;display:flex;align-items:center;gap:16px"><span class="disc" style="background:{R}"></span>Not like this</div>{"".join(vrow(t, False) for t in bad)}</div>
<div class="cap" style="position:absolute;left:120px;top:900px;width:1680px;display:flex;gap:30px"><span>1 One idea per screen</span><span>2 Sentence case, end with a period</span><span>3 Numbers over adjectives</span><span>4 Never promise what is not measured</span></div>
{foot(9)}</section>''')
# 10 applications
pages.append(f'''<section class="p" style="background:{F};color:{H}">
<div class="eyebrow" style="color:{H};position:absolute;top:84px;left:120px">09 · In use</div>
<h2 style="position:absolute;left:112px;top:124px;font-size:112px">Level, everywhere.</h2>
<img src="brb.png" style="position:absolute;left:120px;top:300px;width:900px;border-radius:36px;border:3px solid {H}">
<div class="cap" style="position:absolute;left:120px;top:830px;width:900px">The viewer screen when the phone drops. Replace with your own channel branding any time.</div>
<div style="position:absolute;left:1100px;top:300px;display:flex;gap:28px;align-items:flex-end"><img src="../../brand/keel-icon.svg" width="280" style="border-radius:62px"><img src="../../brand/keel-icon.svg" width="140" style="border-radius:31px"><img src="../../brand/keel-favicon.svg" width="64"></div>
<div style="position:absolute;left:1100px;top:660px;width:700px;height:220px;background:{O};border-radius:44px;display:flex;align-items:center;padding:0 48px"><div class="t" style="font-size:60px;line-height:.95;letter-spacing:-.045em;color:{H}">Stream from anywhere.<br>It holds.</div></div>
{foot(10)}</section>''')

CSS = f'''@page{{size:1920px 1080px;margin:0}}*{{margin:0;box-sizing:border-box}}body{{font-family:'Cabinet Grotesk',system-ui,sans-serif;font-weight:500}}
.p{{width:1920px;height:1080px;position:relative;overflow:hidden;page-break-after:always}}
h1,h2,h3,.t,.aa{{font-weight:800;letter-spacing:-.045em}}h3{{font-size:56px;line-height:1;margin:26px 0 14px}}p{{font-size:28px;line-height:1.35}}
.eyebrow{{font-weight:700;font-size:24px;letter-spacing:.12em;text-transform:uppercase}}.lead{{font-size:34px;line-height:1.3}}
.cap{{font-size:22px;font-weight:700;line-height:1.35}}.pill{{display:inline-block;border-radius:999px;padding:8px 22px;font-weight:700;font-size:22px}}
.foot{{position:absolute;left:120px;right:120px;bottom:46px;display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:22px}}.foot .cap{{position:absolute;left:640px}}
.disc{{width:36px;height:36px;border-radius:50%;display:inline-block}}'''
html = f'<!doctype html><html><head><meta charset="utf-8"><title>Keel brand guidelines</title><link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700,800&display=swap" rel="stylesheet"><style>{CSS}</style></head><body>{"".join(pages)}</body></html>'
(HERE / "guide.html").write_text(html)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1920, "height": 1080})
    pg.goto(f"file://{HERE}/guide.html"); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(3000)
    pg.pdf(path=str(HERE.parent / "Keel-brand-guidelines.pdf"), width="1920px", height="1080px", print_background=True)
    b.close()
print("ok")
