"""Generates the static site into web/. Run: python3 build_site.py  (no dependencies).

The demo page is the real controller dashboard (controller/public/index.html) running on a
simulated server (web/js/demo-engine.js), so the demo can never drift from the product.
"""
from pathlib import Path
import re, shutil

W = Path(__file__).parent
ROOT = W.parent
MARK = re.sub(r"<metadata>.*?</metadata>", "", (ROOT / "brand" / "mark_inline.txt").read_text(), flags=re.S).strip()
FONT = '<link rel="preconnect" href="https://api.fontshare.com"><link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700,800&display=swap">'
# Public address of the site. Link previews on X and Discord need absolute image URLs.
SITE = "https://keel-web-eta.vercel.app"
X_URL, X_HANDLE, EMAIL = "https://x.com/vishafterdark", "@vishafterdark", "work@visheshmahendru.com"

NAV = [("/features", "Features"), ("/how-it-works", "How it works"), ("/demo", "Live demo"), ("/setup", "Phone setup"), ("/investors", "Investors"), ("/status", "Status")]


def mk(d):
    return f'<svg class="mk" viewBox="0 0 92 110.2" aria-hidden="true"><g transform="translate(46 52.21)"><g transform="translate(0 -6.21) rotate({-d})"><path d="M-46 0A46 46 0 0 1 46 0Z" fill="#FF5B1F"/></g><path d="M-46 12H46A46 46 0 0 1 -46 12Z" fill="currentColor"/></g></svg>'


def page(name, title, desc, body, scripts="", active=""):
    links = "".join(f'<a href="{h}"{" aria-current=page" if h == active else ""}>{t}</a>' for h, t in NAV)
    nav = f'''<header class="nav"><div class="wrap"><a href="/" class="logo"><img src="/assets/keel-lockup.svg" alt="keel"></a><nav class="links">{links}</nav><span class="sp"></span><a class="btn small primary" href="/take-it-forward">Take it forward</a><button class="menu" aria-label="Menu" onclick="document.body.classList.toggle('open')"><i></i><i></i></button></div><nav class="drawer">{links}<a href="/take-it-forward">Take it forward</a></nav></header>'''
    foot = f'''<footer><div class="wrap"><div class="grid"><div><img src="/assets/keel-lockup-on-dark.svg" alt="keel" style="height:38px"><p style="margin-top:18px;max-width:320px;color:#9FB3B0">The signal moves. The stream holds. A reliability layer for people who stream from the street.</p></div>
<div><div class="eyebrow" style="color:#9FB3B0">Product</div><a href="/features">Features</a><a href="/how-it-works">How it works</a><a href="/demo">Live demo</a><a href="/setup">Phone setup</a></div>
<div><div class="eyebrow" style="color:#9FB3B0">Business</div><a href="/investors">Model and costs</a><a href="/investors#week">Launch in a week</a><a href="/status">What is tested</a><a href="/start">Self-host guide</a></div>
<div><div class="eyebrow" style="color:#9FB3B0">Take it forward</div><a href="/take-it-forward">Acquire or partner</a><a href="{X_URL}" rel="noopener">{X_HANDLE} on X</a><a href="mailto:{EMAIL}">{EMAIL}</a></div></div>
<p class="small">Keel is an independent project. It is not affiliated with Twitch, Kick, YouTube, OBS, or any existing streaming toolkit. Product and company names belong to their owners. Figures on this site are labelled assumptions unless marked tested.</p></div></footer>'''
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><meta name="description" content="{desc}"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:type" content="website"><meta property="og:image" content="{SITE}/assets/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="{SITE}/{name.replace('.html','').replace('index','')}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{SITE}/assets/og.png"><meta name="twitter:creator" content="{X_HANDLE}"><meta name="theme-color" content="#0E2A2F"><link rel="icon" href="/assets/keel-favicon.svg" type="image/svg+xml">{FONT}<link rel="stylesheet" href="/css/site.css"></head><body>{nav}<main>{body}</main>{foot}{scripts}</body></html>'''
    (W / name).write_text(html)


CONTACT = f'''<div class="contact"><a class="btn solid" href="mailto:{EMAIL}?subject=Keel">Email {EMAIL}</a><a class="btn" href="{X_URL}" rel="noopener">DM {X_HANDLE} on X</a></div>'''

SALE = f'''<section class="section buoy"><div class="wrap"><div class="grid g2" style="align-items:end;gap:40px"><div><div class="eyebrow">Open to offers</div><h2 style="margin-top:14px">Take Keel forward.</h2></div>
<div><p class="lead">Keel is designed and built, and the core is tested. What it needs now is money, an engineer for field testing, and someone to run it. If that is you, the repo, brand, site and launch plan can be yours. Acquire it outright, license it, or partner.</p>{CONTACT}</div></div></div></section>'''

# ---------------------------------------------------------------- HOME
FEATURES = [
    ("Crash shield.", "If OBS crashes, every platform keeps receiving your Be right back screen while OBS restarts. Keel resumes the broadcast by itself. The stream never ends on viewers.", "Built, tested in code"),
    ("Backup encoder, automatic failover.", "Every server takes a second phone, app or Belabox. When the primary drops, viewers stay live on the backup instead of seeing BRB.", "Built, tested in code"),
    ("Switching that understands SRT.", "Keel reads packet loss, late packets and round trip time from the link, not only bitrate. A feed at full bitrate that is breaking up still counts as weak.", "Built, tested in code"),
    ("Multistream, isolated.", "Twitch, Kick, YouTube and any RTMP or SRT target at once. Each destination reconnects on its own, so one platform having a bad minute never touches the others.", "Built, tested in code"),
    ("Broadcast auto-recover.", "If the output stops without anyone pressing stop, Keel restarts it with a short backoff and tells the crew.", "Built, tested in code"),
    ("Rules you can change live.", "Thresholds, timings and SRT limits change from the dashboard mid-stream. No restart, no support ticket.", "Built, tested in code"),
    ("Crew alerts.", "Drops, recoveries, failovers, platform reconnects and crash shield events go to Discord or Slack, throttled so a flapping link cannot spam the channel.", "Built, tested in code"),
    ("Moderator access in seconds.", "A second token lets mods switch scenes and sources. They cannot stop the stream or change settings.", "Built, tested in code"),
    ("Phone setup by QR.", "Every ingest address has a copy button and a QR code. No typing stream keys on a phone keyboard.", "Built"),
    ("Reliability record.", "Drops held, failovers, time on BRB, platform reconnects and crash shield time, logged per stream. Proof you can show a sponsor.", "Built, tested in code"),
    ("Server stops when you do.", "Idle shutdown and per-minute metering, so a streamer never pays for an empty server.", "Built, tested in code"),
    ("Companion app.", "State, link quality, destinations and controls on your phone while you walk.", "Built, not yet on a device"),
]
feat_cards = "".join(f'<div class="card feat"><h3>{t}</h3><p class="muted">{d}</p><span class="tagline">{s}</span></div>' for t, d, s in FEATURES[:6])

COMPARE = [
    ("What decides BRB", "Bitrate thresholds", "Bitrate plus SRT packet loss, late packets and round trip time"),
    ("Second encoder", "Extra ingest on request or on a higher plan", "Primary and backup on every server, automatic failover"),
    ("If OBS crashes", "One OBS, one output. The platform connection goes with it", "Crash shield keeps BRB on every platform, broadcast resumes by itself"),
    ("Multistream", "Two to five destinations depending on plan", "Any number, each with its own reconnects, switch on or off while live"),
    ("Output stops unexpectedly", "Someone has to notice and press start", "Restarted automatically with backoff, crew alerted"),
    ("Changing settings mid-stream", "Often locked while live", "Switching rules change live from the dashboard"),
    ("Giving a mod access", "Through support", "A moderator token, limited by design"),
    ("Phone setup", "Copy and paste keys", "Copy or scan a QR code"),
    ("Crew alerts", "Chat bot", "Discord, Slack and Twitch chat"),
    ("Proof of reliability", "A status page for the service", "A reliability record for every stream, plus a public list of what is not proven yet"),
    ("Price", "About $120 to $180 per month for hosted cloud OBS", "Proposed from $49 per month (see investors)"),
]
cmp_rows = "".join(f'<tr><th scope="row">{a}</th><td class="muted">{b}</td><td><b>{c}</b></td></tr>' for a, b, c in COMPARE)

home = f'''
<section class="hero"><div class="wrap"><div class="grid"><div>
<div class="eyebrow" style="margin-bottom:22px">Cloud streaming for people who stream from the street</div>
<h1>The signal moves. <em>The stream holds.</em></h1>
<p class="lead">Keel sits between your phone and Twitch, Kick or YouTube. When your signal drops, viewers see a clean Be right back screen. When your backup phone is healthier, Keel switches to it. When OBS itself crashes, the platforms keep receiving your BRB screen. The audience never watches a dead stream.</p>
<div class="cta"><a class="btn primary" href="/demo">Open the live demo</a><a class="btn" href="/features">See every feature</a></div>
<div class="proof"><span class="pill">SRT, SRTLA and RTMP in</span><span class="pill">Backup encoder</span><span class="pill">Crash shield</span><span class="pill">Multistream</span></div>
</div>
<div class="sim" aria-label="Interactive signal simulator">
<div class="top"><span class="eyebrow">Try it. Drag the signal.</span><span class="pill" style="font-size:13px;padding:3px 12px;color:#9FB3B0">simulation</span></div>
<div class="screen" id="screen"><div class="feed"><div class="who"></div></div><div class="low"><i></i>Weak signal holding on</div><div class="brb"><b>Be right<br>back.</b><span>The signal moves. The stream holds.</span><svg viewBox="0 0 92 110.2"><g transform="translate(46 52.21)"><g transform="translate(0 -6.21) rotate(-18)"><path d="M-46 0A46 46 0 0 1 46 0Z" fill="#FF5B1F"/></g><path d="M-46 12H46A46 46 0 0 1 -46 12Z" fill="#F3EEE4" opacity=".1"/></g></svg></div><span class="tag">what viewers see</span></div>
<div class="row"><div class="markbox">{MARK}</div><div><div class="word" id="word">Live.</div><div class="kb" id="kb">4,200 kbps in</div></div></div>
<div class="ctl"><input id="sig" type="range" min="0" max="1000" aria-label="Incoming bitrate"><div class="btns"><button id="b-good">Good signal</button><button id="b-weak">Weak</button><button id="b-dead">Dead</button><button id="b-tunnel">Drive through a tunnel</button></div>
<div class="stats"><span>Drops <b id="st-drops">0</b></span><span>Held on BRB <b id="st-hold">0s</b></span><span>Broadcast stops <b id="st-out">0</b></span></div>
<p class="hint">Same rules as the real controller: degrade in 2 to 3 seconds, recover after 5.</p></div></div>
</div></div></section>

<section class="section dark"><div class="wrap"><div class="grid g2" style="align-items:end;gap:48px"><h2>Your viewers do not see your signal. They see your stream.</h2><p class="lead muted">IRL streams fail in public. A tunnel, a crowded cell tower, an overheating phone, a cloud OBS that crashes mid-raid. The platform sees the connection die, the VOD splits, and thousands of people leave. Keel is the part that does not move: a broadcaster in the cloud that the platform can always reach.</p></div>
<div class="grid g4 numbers"><div><div class="stat">2s</div><p class="muted">From a dead feed to Be right back, by default</p></div><div><div class="stat">5s</div><p class="muted">Of healthy signal before going back live, so it never flaps</p></div><div><div class="stat">2</div><p class="muted">Encoders per stream. Primary and backup, on every server</p></div><div><div class="stat">0</div><p class="muted">Unexpected broadcast stops in the tested path</p></div></div></div></section>

<section class="section"><div class="wrap"><div class="eyebrow">What makes it different</div><h2 style="margin:14px 0 18px">Built for the moment it goes wrong.</h2><p class="lead muted" style="max-width:760px;margin-bottom:40px">Most tools handle the easy failure: the phone drops, show a BRB screen. Keel also handles the hard ones that end streams today.</p>
<div class="grid g3">{feat_cards}</div><div style="margin-top:32px"><a class="btn" href="/features">All twelve features</a></div></div></section>

<section class="section foam"><div class="wrap"><div class="grid g2" style="gap:40px;align-items:end"><div><div class="eyebrow">Live demo</div><h2 style="margin-top:14px">The real dashboard. Simulated trouble.</h2></div><p class="lead">This is the actual control room every streamer gets, running on a simulated server. Send a phone into a tunnel, kill the primary encoder, crash OBS, knock Kick offline. Watch what Keel does.</p></div>
<div class="demo-frame"><div class="bar"><i></i><i></i><i></i><span>demo.keel.stream</span></div><iframe src="/demo?embed=1" title="Keel dashboard demo" loading="lazy"></iframe></div>
<div style="margin-top:28px;display:flex;gap:14px;flex-wrap:wrap"><a class="btn solid" href="/demo">Open full screen</a></div></div></section>

<section class="section"><div class="wrap"><div class="eyebrow">Compared honestly</div><h2 style="margin:14px 0 18px">The usual setup, and Keel.</h2><p class="muted" style="max-width:760px;margin-bottom:34px">The left column describes what hosted cloud OBS services commonly offer today, based on their public plan pages. It is a general picture, not a claim about any one company. Keel's column is what is built in this repository. What is not yet field tested is listed on the <a href="/status">status page</a>.</p>
<div class="tablewrap"><table class="compare"><thead><tr><th></th><th>Common today</th><th>Keel</th></tr></thead><tbody>{cmp_rows}</tbody></table></div></div></section>

<section class="section dark" id="states"><div class="wrap"><div class="eyebrow" style="color:#FF5B1F">Three states</div><h2 style="margin:14px 0 40px">One mark. Three tilts.</h2>
<div class="grid g3 states">
<div class="card"><div class="m live">{mk(6)}</div><span class="chip live"><i></i>Live.</span><h3 style="margin:22px 0 10px">Signal is good.</h3><p class="muted">Your phone feed goes straight through. Nothing to do.</p></div>
<div class="card"><div class="m low">{mk(12)}</div><span class="chip low"><i></i>Weak signal.</span><h3 style="margin:22px 0 10px">Struggling, still moving.</h3><p class="muted">Under 800 kbps, or packets breaking up, for 3 seconds. A small pill tells viewers. The feed keeps playing.</p></div>
<div class="card"><div class="m off">{mk(18)}</div><span class="chip off"><i></i>Holding on.</span><h3 style="margin:22px 0 10px">Feed gone.</h3><p class="muted">Under 50 kbps for 2 seconds. Be right back goes up, the broadcast continues. Live again after 5 stable seconds.</p></div>
</div></div></section>

<section class="section"><div class="wrap"><div class="grid g2" style="gap:48px;align-items:start"><div><div class="eyebrow">Works with what you carry</div><h2 style="margin-top:14px">Any phone app. Any bonding box.</h2></div>
<div><p class="lead" style="margin-bottom:26px">If it sends SRT, SRTLA or RTMP, it works. Bonded cellular (SIMs plus Wi-Fi) goes through the SRTLA receiver.</p>
<div class="apps"><span class="pill">Moblin</span><span class="pill">IRL Pro</span><span class="pill">Larix Broadcaster</span><span class="pill">Belabox</span><span class="pill">OBS Studio</span><span class="pill">FFmpeg</span><span class="pill">Any SRT encoder</span></div>
<p style="margin-top:26px"><a class="btn" href="/setup">Phone setup guides</a></p></div></div></div></section>

<section class="section sand"><div class="wrap"><div class="eyebrow">Proposed pricing</div><h2 style="margin:14px 0 18px">Less than the incumbents. More than a VPS.</h2><p class="muted" style="max-width:720px;margin-bottom:36px">Not live yet. These are the plans the cost model supports. Every plan gets the reliability features; plans differ by hours and scale.</p>
<div class="grid g3 plans">
<div class="card"><div class="eyebrow">Solo</div><div class="price">$49<span>/mo</span></div><ul><li>40 live hours included</li><li>1080p60 output</li><li>Primary and backup encoder</li><li>3 destinations</li><li>Crash shield, alerts, app</li></ul></div>
<div class="card hl"><div class="eyebrow">Pro</div><div class="price">$99<span>/mo</span></div><ul><li>120 live hours included</li><li>Up to 1440p, GPU option</li><li>Primary and backup encoder</li><li>Unlimited destinations</li><li>Priority stream-day support</li></ul></div>
<div class="card"><div class="eyebrow">Crew and networks</div><div class="price">Custom</div><ul><li>Streamer groups and agencies</li><li>White label dashboards</li><li>Revenue share for creators who bring their community</li><li>Dedicated region</li></ul></div>
</div></div></section>

<section class="section"><div class="wrap"><div class="eyebrow">Questions</div><h2 style="margin:14px 0 36px">Straight answers.</h2>
<details><summary>Does it work today?</summary><p>The core path is tested end to end in containers with real OBS: SRT in, switching between LIVE, LOW SIGNAL and BRB, broadcast out, recovery, zero unexpected stops. The new reliability features (backup failover, relay, crash shield, SRT-aware switching, auto-recover) are covered by automated tests and a full end-to-end script that runs on every push. Nothing has been tested yet on a real phone over cellular or against live Twitch, Kick or YouTube. The <a href="/status">status page</a> lists exactly what is and is not proven.</p></details>
<details><summary>What happens to latency?</summary><p>Keel adds one cloud hop, like every hosted IRL setup. The OBS network buffer defaults to 1 MB, lower than usual, and is adjustable. The relay copies video without re-encoding, so it adds almost nothing. Glass to glass latency has not been measured yet; it is day 3 of the launch plan, and no number will be claimed until it is.</p></details>
<details><summary>What is a backup encoder?</summary><p>A second source on the same server: another phone, a second app on a different SIM, or a Belabox. Keel keeps it ready and shows it to viewers only when the primary is worse. When the primary is healthy again for 5 seconds, Keel goes back. You can also pin either one by hand.</p></details>
<details><summary>What does the crash shield actually do?</summary><p>OBS sends its program to Keel's relay instead of straight to the platforms. If that program disappears for 3 seconds while you are live, the relay sends an encoded Be right back screen to every platform until OBS is back. Then it switches back to the program and Keel restarts the OBS output if needed.</p></details>
<details><summary>Can I stream to several platforms at once?</summary><p>Yes. Add as many destinations as you like. Each one runs separately, reconnects on its own, and can be switched on or off while live. Check each platform's rules on simultaneous streaming before you do.</p></details>
<details><summary>Can I self host?</summary><p>Yes. One command sets up a fresh Ubuntu server with HTTPS. See <a href="/start">the self-host guide</a>.</p></details>
<details><summary>Who is behind it, and is it for sale?</summary><p>An independent designer created Keel to show what a reliable IRL stack should look like. There is no company and no funding behind it yet. The whole thing is open to acquisition, licensing or partnership. See <a href="/take-it-forward">take it forward</a>, or reach out on X at <a href="{X_URL}" rel="noopener">{X_HANDLE}</a> or by email at <a href="mailto:{EMAIL}">{EMAIL}</a>.</p></details>
</div></section>
{SALE}
'''
page("index.html", "Keel. The signal moves. The stream holds.", "A cloud reliability layer for IRL streamers: backup encoder failover, crash shield, SRT-aware switching and isolated multistream.", home, '<script src="/js/sim.js"></script>')

# ---------------------------------------------------------------- FEATURES
all_feats = "".join(f'<div class="card feat"><h3>{t}</h3><p class="muted">{d}</p><span class="tagline">{s}</span></div>' for t, d, s in FEATURES)
features = f'''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">Features</div><h1 class="h1s">Every way a stream dies, covered.</h1><p class="lead" style="margin-top:26px;max-width:760px">Twelve features, one goal: the audience never watches a dead stream. Each card says how far it has been proven.</p></div></section>
<section class="section" style="padding-top:10px"><div class="wrap"><div class="grid g3">{all_feats}</div></div></section>
<section class="section dark"><div class="wrap"><div class="eyebrow" style="color:#FF5B1F">Failure by failure</div><h2 style="margin:14px 0 36px">What breaks, and what Keel does.</h2>
<div class="tablewrap"><table class="rules"><tr><th>What breaks</th><th>What viewers see</th><th>What Keel does</th></tr>
<tr><td>Phone loses signal in a tunnel</td><td>Be right back screen</td><td>BRB within 2 seconds, live again after 5 stable seconds. Broadcast never stops.</td></tr>
<tr><td>Signal weak but not gone</td><td>Your feed with a small weak signal pill</td><td>Switches to LOW SIGNAL on low bitrate, high packet loss or late packets.</td></tr>
<tr><td>Primary phone dies, backup is fine</td><td>Your stream, from the backup</td><td>Fails over automatically. No BRB, no drop counted. Returns to primary when it is healthy.</td></tr>
<tr><td>OBS crashes or hangs</td><td>Be right back screen</td><td>Crash shield sends BRB to every platform, OBS restarts, broadcast resumes by itself.</td></tr>
<tr><td>One platform drops the connection</td><td>Nothing on the other platforms</td><td>That destination reconnects alone with backoff. The others are untouched.</td></tr>
<tr><td>OBS output stops by itself</td><td>A short gap at most</td><td>Restarted automatically, crew alerted on Discord or Slack.</td></tr>
<tr><td>Thresholds wrong for this city</td><td>Fewer false BRBs once fixed</td><td>Change the rules live from the dashboard. No restart.</td></tr>
</table></div></div></section>
<section class="section"><div class="wrap grid g2" style="gap:48px"><div><div class="eyebrow">For the crew</div><h2 style="margin-top:14px">Run it like a broadcast.</h2></div>
<div class="grid" style="gap:14px">
<div class="card sm"><b>Dashboard.</b> Signal, link quality, what viewers see, destinations, sources, rules and a full event log, live. Built to read on a phone in sunlight.</div>
<div class="card sm"><b>Twitch chat commands.</b> <code>!status</code>, <code>!live</code>, <code>!low</code>, <code>!brb</code>, <code>!auto</code>, <code>!source backup</code>, <code>!start</code>, <code>!stop</code>. Stop is limited to the broadcaster.</div>
<div class="card sm"><b>Prometheus metrics.</b> Bitrate, RTT, loss, drops, failovers, destination health, crash shield and restarts, ready for Grafana.</div>
<div class="card sm"><b>Security.</b> Tokens never sit in URLs (one-time tickets for the live feed), stream keys are redacted from every log and screen, HTTPS with automatic certificates, the plain HTTP port locked to the server.</div>
</div></div></section>
{SALE}
'''
page("features.html", "Keel features", "Backup encoder failover, crash shield, SRT-aware switching, isolated multistream, live rules, crew alerts and more.", features, active="/features")

# ---------------------------------------------------------------- HOW IT WORKS
how = '''
<section class="hero" style="padding-bottom:40px"><div class="wrap"><div class="eyebrow">How it works</div><h1 class="h1s">Phones in. Platforms out. Keel in the middle.</h1><p class="lead" style="margin-top:26px;max-width:760px">Five parts, each boring on purpose. Everything above the waterline can fail. Everything below it keeps broadcasting.</p></div></section>
<section class="section" style="padding-top:10px"><div class="wrap">
<div class="flow five">
<div class="node"><div class="box"><div class="n">01 Ingest</div><h3>Two encoders.</h3><p class="muted" style="margin-top:10px">Primary and backup phones send SRT, SRTLA or RTMP to mediamtx on secret paths.</p></div></div>
<div class="node key"><div class="box"><div class="n">02 Decide</div><h3>The controller.</h3><p style="margin-top:10px;color:#9FB3B0">Reads bitrate, packet loss, late packets and RTT every second. Picks the healthier source. Degrades fast, recovers slow.</p></div></div>
<div class="node"><div class="box"><div class="n">03 Compose</div><h3>Headless OBS.</h3><p class="muted" style="margin-top:10px">Scenes LIVE, LOW SIGNAL and BRB, your overlays. Encodes one program.</p></div></div>
<div class="node key"><div class="box"><div class="n">04 Relay</div><h3>The shield.</h3><p style="margin-top:10px;color:#9FB3B0">Copies the program to every platform. Covers OBS crashes with BRB. Reconnects each platform alone.</p></div></div>
<div class="node"><div class="box"><div class="n">05 Platforms</div><h3>Steady out.</h3><p class="muted" style="margin-top:10px">Twitch, Kick, YouTube, any RTMP or SRT target. They never see a phone drop.</p></div></div>
</div>
<div class="waterline"></div>
<p class="muted" style="max-width:640px">The phones and the network are out of anyone's control. Ingest, decision, OBS and relay run in the cloud, next to the platforms.</p>
</div></section>

<section class="section dark light-rules"><div class="wrap"><div class="eyebrow" style="color:#FF5B1F">The switching rule</div><h2 style="margin:14px 0 36px">Degrade fast. Recover slow.</h2>
<div class="tablewrap"><table class="rules"><tr><th>Input</th><th>Condition</th><th>Holds for</th><th>Result</th></tr>
<tr><td>Good</td><td>800 kbps or more, packets arriving clean</td><td>5 s to recover</td><td><span class="chip live"><i></i>Live.</span></td></tr>
<tr><td>Weak</td><td>50 to 800 kbps, or over 2% late packets, or over 20% loss (SRT)</td><td>3 s to degrade</td><td><span class="chip low"><i></i>Weak signal.</span></td></tr>
<tr><td>Dead</td><td>under 50 kbps or disconnected</td><td>2 s to degrade</td><td><span class="chip off"><i></i>Holding on.</span></td></tr></table></div>
<p class="muted" style="margin-top:22px;max-width:720px">Every number is a default. Streamers change them live from the dashboard. With a backup encoder, the rule runs for each source and viewers see whichever is healthier.</p></div></section>

<section class="section"><div class="wrap grid g2" style="gap:48px"><div><div class="eyebrow">Under the hood</div><h2 style="margin-top:14px">Plain parts. Few of them.</h2></div>
<div class="grid" style="gap:14px">
<div class="card sm"><b>mediamtx.</b> The ingest server. SRT, RTMP and SRTLA through a receiver. Exposes bitrate and SRT link statistics.</div>
<div class="card sm"><b>Keel controller.</b> Node 22, TypeScript, one dependency. 76 automated tests. Dashboard, API, chat bot, alerts, relay supervisor.</div>
<div class="card sm"><b>OBS Studio.</b> Headless, driven over obs-websocket. Scenes are built automatically on first start.</div>
<div class="card sm"><b>Relay.</b> One FFmpeg process per destination, copying without re-encoding, supervised with backoff.</div>
<div class="card sm"><b>Platform.</b> Creates one isolated server per streamer, gives it a hostname with HTTPS, checks it is healthy, meters usage, and stops it when idle.</div>
</div></div></section>
'''
page("how-it-works.html", "How Keel works", "Two encoders in, one controller, headless OBS, a relay with a crash shield, every platform out.", how, active="/how-it-works")

# ---------------------------------------------------------------- SETUP (phone apps)
def app(name, steps, note):
    li = "".join(f"<li>{s}</li>" for s in steps)
    return f'<div class="card app"><h3>{name}</h3><ol>{li}</ol><p class="muted">{note}</p></div>'
apps = "".join([
    app("Moblin (iPhone)", ["Settings, Streams, add a stream.", "Paste the SRT or SRTLA address from your Keel dashboard as the URL.", "Video: H.264 or H.265, 1080p30, 4 to 6 Mbps. Enable adaptive bitrate.", "SRT latency around 2000 ms on cellular, lower on good Wi-Fi."], "Bonding: use the SRTLA address and turn on cellular plus Wi-Fi."),
    app("IRL Pro (Android)", ["Add a new connection, type SRT or SRTLA.", "Paste the address from the dashboard, or scan its QR code.", "Bitrate 4 to 6 Mbps, adaptive on.", "Latency 2000 ms to start, tune after a test walk."], "Bonding: add every network interface and choose SRTLA."),
    app("Larix Broadcaster", ["Settings, Connections, new connection.", "Paste the SRT address. Mode: Caller.", "Latency 2000 ms, max bandwidth relative to bitrate.", "Use the backup address on a second phone for failover."], "RTMP works too, but SRT reports link quality to Keel."),
    app("Belabox", ["In the Belabox UI, set the relay server to your Keel host.", "Port 5000, stream id from the dashboard's SRTLA address.", "Plug in your modems and Wi-Fi.", "Set Keel's backup address on a second unit or phone if you have one."], "SRTLA receiver image is written but not yet field tested."),
])
setup = f'''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">Phone setup</div><h1 class="h1s">From pocket to platform in five minutes.</h1><p class="lead" style="margin-top:26px;max-width:760px">Open your Keel dashboard, pick Primary or Backup, and copy or scan the address. These are starting points. Every city and carrier is different, so do a test walk first.</p></div></section>
<section class="section" style="padding-top:10px"><div class="wrap"><div class="grid g2">{apps}</div></div></section>
<section class="section dark"><div class="wrap grid g2" style="gap:48px"><div><div class="eyebrow" style="color:#FF5B1F">Field tips</div><h2 style="margin-top:14px">Set it once. Walk with confidence.</h2></div>
<div class="grid" style="gap:14px">
<div class="card sm"><b>Use SRT, not RTMP.</b> SRT recovers lost packets and tells Keel how the link is doing. RTMP only reports bitrate.</div>
<div class="card sm"><b>Run a backup.</b> A second phone on a different carrier, pointed at the backup address, turns most drops into a seamless switch.</div>
<div class="card sm"><b>Latency is a trade.</b> Higher SRT latency rides out more bad network. 1500 to 2500 ms suits most cellular. Watch "Dropped" on the dashboard: if it rises, raise latency.</div>
<div class="card sm"><b>Tune the rules on day one.</b> If you see BRB when the stream looked fine, lower "Gone below" or raise "BRB after" from the dashboard while live.</div>
</div></div></section>
'''
page("setup.html", "Keel phone setup", "How to point Moblin, IRL Pro, Larix and Belabox at Keel, with SRT latency and bonding tips.", setup, active="/setup")

# ---------------------------------------------------------------- INVESTORS
inv = f'''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">For investors and operators</div><h1 class="h1s">Reliability is what streamers pay for.</h1><p class="lead" style="margin-top:26px;max-width:780px">Hosted cloud OBS for IRL streamers already sells at about $120 to $180 a month per streamer, and the people paying it complain about the same thing: streams dying live. Keel is a product, a brand and a launch plan built around fixing exactly that.</p></div></section>

<section class="section" style="padding-top:10px"><div class="wrap"><div class="grid g4">
<div class="card"><div class="stat">$129</div><p class="muted" style="margin-top:10px">Entry price of the best-known hosted IRL toolkit, per streamer, per month (public plan page, Oct 2026)</p></div>
<div class="card"><div class="stat">~$0.05</div><p class="muted" style="margin-top:10px">Assumed CPU server cost per live hour. Editable below</p></div>
<div class="card"><div class="stat">76</div><p class="muted" style="margin-top:10px">Automated controller tests, plus a full end-to-end test with real OBS on every push</p></div>
<div class="card"><div class="stat">7d</div><p class="muted" style="margin-top:10px">Planned time from funding to three pilot streamers live</p></div></div></div></section>

<section class="section dark"><div class="wrap grid g2" style="gap:48px"><div><div class="eyebrow" style="color:#FF5B1F">Where value is</div><h2 style="margin-top:14px">The code is not the moat.</h2></div>
<div><p class="lead muted" style="margin-bottom:22px">OBS, mediamtx and SRTLA are open source. Anyone can assemble them. What is hard to copy: proven reliability on real streets, a product that designs for failure first, and distribution through streamers with large, loyal audiences who switch tools when a peer they trust does.</p>
<p class="lead muted">The plan: one anchor streamer on a revenue share, a published drive-test video with real numbers, a reliability record on every stream, then their network of streamers.</p></div></div></section>

<section class="section dark" id="model" style="padding-top:0"><div class="wrap"><div class="eyebrow" style="color:#FF5B1F">Cost model</div><h2 style="margin:14px 0 14px">Move the sliders.</h2><p class="muted" style="margin-bottom:36px;max-width:640px">Illustrative unit economics. Hourly rates and support costs are assumptions, not quotes. Change them in <code>web/js/calc.js</code> or <code>docs/COSTS.md</code>.</p>
<div class="calc"><div class="card"><div class="field"><label>Paying streamers <b id="v-n">50</b></label><input id="c-n" type="range" min="1" max="500" value="50"></div><div class="field"><label>Live hours per week, each <b id="v-h">20 h</b></label><input id="c-h" type="range" min="2" max="60" value="20"></div><div class="field"><label>Monthly price <b id="v-p">€49</b></label><input id="c-p" type="range" min="9" max="199" value="49"></div><div class="field"><label><span>Use a GPU server (NVENC, untested)</span><input id="c-g" type="checkbox"></label></div></div>
<div class="card"><div class="out"><span>Revenue per month</span><b id="o-rev"></b></div><div class="out"><span>Infrastructure and support</span><b id="o-cost"></b></div><div class="out"><span>Cost per streamer</span><b id="o-per"></b></div><div class="out"><span>Margin after payment fees</span><b id="o-gm"></b></div><div class="out"><span>Profit per month</span><b id="o-profit"></b></div><div class="out"><span>Break-even</span><b id="o-be"></b></div></div></div></div></section>

<section class="section" id="week"><div class="wrap"><div class="eyebrow">Launch in a week</div><h2 style="margin:14px 0 36px">Day by day.</h2>
<div class="tablewrap"><table class="table"><tr><th>Day</th><th>Goal</th><th>Done when</th></tr>
<tr><td><b>1</b></td><td>Cloud account, push the repo so CI builds images. Run <code>deploy/install.sh</code> on a test server.</td><td>Dashboard over HTTPS, CI green including the end-to-end test.</td></tr>
<tr><td><b>2</b></td><td>Field test: two real phones on two carriers, SRT then SRTLA, a moving car. <code>scripts/chaos.sh 20</code>.</td><td>Ten minute drive, zero broadcast stops, failover seen live.</td></tr>
<tr><td><b>3</b></td><td>Real Twitch, Kick and YouTube at once. Measure glass to glass latency. Kill OBS mid-stream.</td><td>Latency number recorded, crash shield seen on all three.</td></tr>
<tr><td><b>4</b></td><td>Platform live with the Hetzner provider and sslip or Cloudflare DNS.</td><td>Two test accounts get a working HTTPS server and remove it when idle.</td></tr>
<tr><td><b>5</b></td><td>Stripe, pricing, mobile app to TestFlight and Play internal testing.</td><td>First test payment clears, app connects to a real server.</td></tr>
<tr><td><b>6</b></td><td>Eight hour soak, security pass, backups.</td><td>Soak passes with zero unexpected stops.</td></tr>
<tr><td><b>7</b></td><td>Three pilot streamers.</td><td>Three real streams on Keel, list of what broke.</td></tr></table></div></div></section>

<section class="section sand"><div class="wrap"><div class="eyebrow">Risks, stated plainly</div><h2 style="margin:14px 0 30px">What could go wrong.</h2>
<div class="grid g2"><div class="card"><b>Reliability is unproven in the field.</b><p class="muted" style="margin-top:8px">Containers are not a drive test. Days 2 and 3 exist for this, and nothing will be claimed before them.</p></div><div class="card"><b>Platform policy.</b><p class="muted" style="margin-top:8px">Simultaneous streaming and restreaming rules differ by platform and by contract. Review before selling multistream.</p></div><div class="card"><b>Incumbent response.</b><p class="muted" style="margin-top:8px">A larger toolkit can copy features. Reliability, design and an anchor streamer's network are the defence.</p></div><div class="card"><b>Team.</b><p class="muted" style="margin-top:8px">The author is a designer. Operating this needs an engineer on call during peak streaming hours.</p></div></div></div></section>
{SALE}
'''
page("investors.html", "Keel for investors", "Market, unit economics, launch plan and risks for taking Keel to market in a week.", inv, '<script src="/js/calc.js"></script>', active="/investors")

# ---------------------------------------------------------------- TAKE IT FORWARD
forward = f'''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">Take it forward</div><h1 class="h1s">Keel is built. It needs an owner.</h1><p class="lead" style="margin-top:26px;max-width:800px">I created Keel because IRL streamers deserve tools that do not fail them in front of millions of people. I do not have the capital to run it as a service. If you do, I would like to hand it to you, or build it with you.</p>{CONTACT}</div></section>
<section class="section" style="padding-top:10px"><div class="wrap"><div class="grid g3">
<div class="card"><div class="eyebrow">What you get</div><ul class="list"><li>The full repository: controller, relay, stack, platform, mobile app, website</li><li>The Keel brand: identity, logo set, guidelines, voice</li><li>This website, ready on Vercel</li><li>The seven-day launch plan, cost model and operations docs</li><li>Handover time from the designer</li></ul></div>
<div class="card"><div class="eyebrow">What it still needs</div><ul class="list"><li>Field tests on real phones and real platforms</li><li>An engineer to run it during peak hours</li><li>Cloud spend while pilots run, small at first</li><li>Billing go-live and a support channel</li><li>One anchor streamer</li></ul></div>
<div class="card hl"><div class="eyebrow">Ways to do it</div><ul class="list"><li><b>Acquire.</b> Everything above, outright.</li><li><b>License.</b> Run Keel under your own brand.</li><li><b>Partner.</b> You fund and operate, I stay on as product and brand lead.</li><li><b>Streamer-backed.</b> A creator group owns it, their community uses it.</li></ul></div>
</div></div></section>
<section class="section dark"><div class="wrap grid g2" style="gap:48px;align-items:end"><h2>Get in touch.</h2><div><p class="lead muted" style="margin-bottom:26px">The fastest way is a DM on X. For anything formal, email. I reply to every serious message.</p>
<div class="contact"><a class="btn primary" href="{X_URL}" rel="noopener">{X_HANDLE} on X</a><a class="btn" href="mailto:{EMAIL}?subject=Keel">{EMAIL}</a></div></div></div></section>
'''
page("take-it-forward.html", "Take Keel forward", "Keel is open to acquisition, licensing or partnership. Contact @vishafterdark on X or work@visheshmahendru.com.", forward, active="/take-it-forward")

# ---------------------------------------------------------------- START (self host)
start = '''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">Self-host guide</div><h1 class="h1s">One command to your first stream.</h1><p class="lead" style="margin-top:26px;max-width:720px">You need a fresh Ubuntu server with a public IP and a stream key for at least one platform. No domain needed: Keel can use a free sslip.io name with a real certificate.</p></div></section>
<section class="section" style="padding-top:10px"><div class="wrap" style="max-width:940px">
<div style="display:grid;gap:18px">
<div class="card"><span class="disc">1</span><h3 style="margin:16px 0 8px">Get the code on the server.</h3><pre>git clone https://github.com/vishhhh999/keel.git
cd keel</pre></div>
<div class="card"><span class="disc">2</span><h3 style="margin:16px 0 8px">Run the installer.</h3><pre>KEEL_DESTINATIONS='Twitch=rtmp://live.twitch.tv/app/live_xxx;Kick=rtmps://.../app/sk_xxx' \\
  bash deploy/install.sh</pre><p class="muted" style="margin-top:12px">It installs Docker, generates every secret, opens the firewall, starts the stack with HTTPS, and prints your dashboard address, admin token, moderator token and phone addresses. Add <code>KEEL_NOTIFY_WEBHOOK</code> for Discord or Slack alerts.</p></div>
<div class="card"><span class="disc">3</span><h3 style="margin:16px 0 8px">Point your phones at it.</h3><p class="muted">Primary phone on the primary SRT address, backup phone on the backup address. Scan the QR codes from the dashboard. See <a href="/setup">phone setup</a>.</p></div>
<div class="card"><span class="disc">4</span><h3 style="margin:16px 0 8px">Go live.</h3><p class="muted">Press Go live on the dashboard. Walk into a dead zone on purpose once, so you know what your viewers see.</p></div>
</div><p class="muted" style="margin-top:28px">Full reference with every setting, the manual Docker route, GPU notes and troubleshooting: <code>README.md</code> and <code>docs/</code> in the repo.</p></div></section>
'''
page("start.html", "Keel self-host guide", "One command sets up Keel on a fresh Ubuntu server with HTTPS.", start)

# ---------------------------------------------------------------- STATUS
def row(a, b, c):
    cls = {"Tested": "tick", "Not tested": "cross", "Partial": "warn", "In CI": "warn"}[b]
    return f'<tr><td>{a}</td><td class="{cls}">{b}</td><td class="muted">{c}</td></tr>'
rows = "".join([
    row("SRT ingest and bitrate read", "Tested", "Container end to end with real OBS and mediamtx (v0.1 run)"),
    row("Switching LIVE, LOW SIGNAL, BRB", "Tested", "Including recovery after a killed feed"),
    row("Broadcast continues during a phone drop", "Tested", "Verified against a stand-in RTMP platform"),
    row("Backup encoder failover", "Tested", "Real OBS in Docker on every push (simulated phones): switch on the next second, no black frames"),
    row("SRT-aware switching (loss, late packets, RTT)", "In CI", "Unit tests against recorded mediamtx responses; needs a real cellular link"),
    row("Multistream relay, per-destination reconnects", "Tested", "Two destinations through the real relay in Docker on every push"),
    row("Crash shield and broadcast auto-recover", "Tested", "OBS killed mid-broadcast in Docker: BRB on the platform in about 2 s, broadcast resumed by itself"),
    row("Dashboard, API, roles, live rules, alerts", "Tested", "76 controller tests, plus visual checks on desktop and phone"),
    row("SRTLA bonded cellular", "Not tested", "Receiver image written, never built or run in the field"),
    row("NVENC GPU encoding", "Not tested", "CPU x264 is the verified path"),
    row("Real Twitch, Kick, YouTube outputs", "Not tested", "Day 3 of the launch plan"),
    row("Real phones over cellular", "Not tested", "Day 2 of the launch plan"),
    row("Glass to glass latency, soak, load", "Not tested", "Days 3 and 6 of the launch plan"),
    row("Mobile app on a device", "Partial", "Type-checked and logic tested, not yet run on hardware"),
    row("Multi-tenant platform", "Partial", "16 tests against a mock cloud; Hetzner, Cloudflare and Stripe never run live"),
])
status = f'''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">Status</div><h1 class="h1s">What is proven. What is not.</h1><p class="lead" style="margin-top:26px;max-width:720px">Streamers and investors should know exactly where the edge is. "In CI" means the GitHub workflow runs it in Docker with real OBS on every push; check the repository's Actions tab for the latest result.</p></div></section>
<section class="section" style="padding-top:10px"><div class="wrap"><div class="tablewrap"><table class="table"><tr><th>Capability</th><th>State</th><th>Notes</th></tr>{rows}</table></div></div></section>
'''
page("status.html", "Keel status", "Exactly what is tested and what is not.", status, active="/status")

# ---------------------------------------------------------------- 404
page("404.html", "Lost signal. Keel", "Page not found.", '''<section class="hero"><div class="wrap"><div class="eyebrow">404</div><h1 style="margin-top:16px">Be right back.</h1><p class="lead">That page is not here. <a href="/">Go home</a>.</p></div></section>''')

# ---------------------------------------------------------------- DEMO (real dashboard + simulator)
dash = (ROOT / "controller" / "public" / "index.html").read_text()
for a, b in [('href="/keel-favicon.svg"', 'href="/assets/keel-favicon.svg"'), ('src="/keel-lockup.svg"', 'src="/assets/keel-lockup.svg"'), ('src="/qrcode.js"', 'src="/js/qrcode.js"'), ("<title>Keel control room</title>", "<title>Keel live demo</title><meta name=\"description\" content=\"The real Keel dashboard on a simulated server. Trigger tunnels, failovers, platform drops and OBS crashes.\">" + f'<meta property="og:title" content="Keel live demo"><meta property="og:description" content="The real Keel dashboard on a simulated server. Trigger tunnels, failovers, platform drops and OBS crashes."><meta property="og:image" content="{SITE}/assets/og.png"><meta property="og:url" content="{SITE}/demo"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{SITE}/assets/og.png">')]:
    assert a in dash, a
    dash = dash.replace(a, b)
BAR = '''<style>
.demo-bar{max-width:1344px;margin:0 auto 18px;padding:0 32px}
.demo-bar .in{background:var(--hull);color:var(--bone);border-radius:28px;padding:16px 18px 16px 22px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.demo-bar b{font-weight:800;font-size:15px;margin-right:4px}
.demo-bar button{border:2px solid var(--line-dark);background:transparent;color:var(--bone);border-radius:999px;padding:8px 14px;font-weight:700;font-size:14px;cursor:pointer}
.demo-bar button:hover{border-color:var(--bone)} .demo-bar button.hot{background:var(--buoy);color:var(--hull);border-color:var(--buoy)}
.demo-bar .note{flex-basis:100%;color:var(--on-dark-60);font-size:14px;font-weight:700;min-height:20px}
.demo-back{font-size:14px;font-weight:700;color:var(--hull)}
@media(max-width:760px){.demo-bar{padding:0 12px}}
body.embed header .demo-back{display:none}
</style>
<div class="demo-bar"><div class="in"><b>Simulated server. Try what goes wrong live:</b>
<button data-s="tunnel">Tunnel</button><button data-s="weak">Weak signal</button><button data-s="packets">Packets breaking up</button><button data-s="failover" class="hot">Primary phone dies</button><button data-s="platform">Kick drops</button><button data-s="obs" class="hot">OBS crashes</button><button data-s="calm">Calm</button>
<div class="note" id="demoNote">Everything below is the real Keel dashboard. Only the server is simulated.</div></div></div>
<script>document.addEventListener('click',function(e){var b=e.target.closest('[data-s]');if(!b)return;var t=window.KeelDemo.scenario(b.dataset.s);document.getElementById('demoNote').textContent=t;});if(/embed=1/.test(location.search))document.body.classList.add('embed');</script>'''
dash = dash.replace('<button class="link" id="logout">Sign out</button>', '<a class="demo-back" href="/">Back to keel</a><button class="link" id="logout">Sign out</button>')
dash = dash.replace("</header>\n<main>", "</header>\n" + BAR + "\n<main>", 1)
dash = dash.replace('<script src="/js/qrcode.js"></script>', '<script src="/js/demo-engine.js"></script>\n<script src="/js/qrcode.js"></script>', 1)
assert "demo-engine.js" in dash and "demo-bar" in dash
(W / "demo.html").write_text(dash)
shutil.copy(ROOT / "controller" / "public" / "qrcode.js", W / "js" / "qrcode.js")
print("built")
