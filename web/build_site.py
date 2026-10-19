"""Generates the static site into web/. Run: python3 build_site.py  (no dependencies)."""
from pathlib import Path
W = Path(__file__).parent
MARK = (W.parent / "brand" / "mark_inline.txt").read_text().strip()
FONT = '<link rel="preconnect" href="https://api.fontshare.com"><link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700,800&display=swap">'

def page(name, title, desc, body, scripts=""):
    nav = '''<header class="nav"><div class="wrap"><a href="/"><img src="/assets/keel-lockup.svg" alt="keel"></a><nav class="links"><a href="/how-it-works">How it works</a><a href="/#states">States</a><a href="/investors">Investors</a><a href="/status">Status</a></nav><span class="sp"></span><a class="btn small solid" href="/start">Get it running</a></div></header>'''
    foot = '''<footer><div class="wrap"><div class="grid"><div><img src="/assets/keel-lockup-on-dark.svg" alt="keel" style="height:38px"><p style="margin-top:18px;max-width:300px;color:#9FB3B0">The signal moves. The stream holds.</p></div><div><div class="eyebrow" style="color:#9FB3B0">Product</div><a href="/how-it-works">How it works</a><a href="/start">Get it running</a><a href="/status">What is tested</a></div><div><div class="eyebrow" style="color:#9FB3B0">Investors</div><a href="/investors">Model and costs</a><a href="/investors#week">Launch in a week</a></div><div><div class="eyebrow" style="color:#9FB3B0">Open</div><a href="https://github.com/">Source on GitHub</a></div></div><p class="small">Keel is an independent project and is not affiliated with any streaming platform or existing toolkit. Figures on this site are labelled assumptions unless marked tested.</p></div></footer>'''
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><meta name="description" content="{desc}"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta name="theme-color" content="#0E2A2F"><link rel="icon" href="/assets/keel-favicon.svg" type="image/svg+xml">{FONT}<link rel="stylesheet" href="/css/site.css"></head><body>{nav}{body}{foot}{scripts}</body></html>'''
    (W / name).write_text(html)

# ---------- HOME ----------
home = f'''
<section class="hero"><div class="wrap"><div class="grid"><div>
<div class="eyebrow" style="margin-bottom:22px">Cloud streaming for people who stream from the street</div>
<h1>The signal moves. <em>The stream holds.</em></h1>
<p class="lead">Keel is a cloud stack that sits between your phone and Twitch, Kick or YouTube. When your signal drops, viewers see a clean Be right back screen. When it returns, you are live again. The broadcast never stops.</p>
<div class="cta"><a class="btn primary" href="/start">Get it running</a><a class="btn" href="/how-it-works">How it works</a></div>
<div class="proof"><span class="pill">SRT and SRTLA in</span><span class="pill">Headless OBS</span><span class="pill">Open source</span></div>
</div>
<div class="sim" aria-label="Interactive signal simulator">
<div class="top"><span class="eyebrow">Try it. Drag the signal.</span><span class="pill" style="font-size:13px;padding:3px 12px;color:#9FB3B0">simulation</span></div>
<div class="screen" id="screen"><div class="feed"><div class="who"></div></div><div class="low"><i></i>Weak signal holding on</div><div class="brb"><b>Be right<br>back.</b><span>The signal moves. The stream holds.</span><svg viewBox="0 0 92 110.2"><g transform="translate(46 52.21)"><g transform="translate(0 -6.21) rotate(-18)"><path d="M-46 0A46 46 0 0 1 46 0Z" fill="#FF5B1F"/></g><path d="M-46 12H46A46 46 0 0 1 -46 12Z" fill="#F3EEE4" opacity=".1"/></g></svg></div><span class="tag">what viewers see</span></div>
<div class="row"><div class="markbox">{MARK}</div><div><div class="word" id="word">Live.</div><div class="kb" id="kb">4,200 kbps in</div></div></div>
<div class="ctl"><input id="sig" type="range" min="0" max="1000" aria-label="Incoming bitrate"><div class="btns"><button id="b-good">Good signal</button><button id="b-weak">Weak</button><button id="b-dead">Dead</button><button id="b-tunnel">Drive through a tunnel</button></div>
<div class="stats"><span>Drops <b id="st-drops">0</b></span><span>Held on BRB <b id="st-hold">0s</b></span><span>Broadcast stops <b id="st-out">0</b></span></div>
<p class="hint">Same rules as the real controller: degrade in 2 to 3 seconds, recover after 5.</p></div></div>
</div></div></section>

<section class="section dark"><div class="wrap grid g2" style="align-items:end"><h2>Your viewers do not see your signal. They see your stream.</h2><p class="lead muted">Most mobile streaming fails in public: the platform sees the ingest die, the VOD splits, viewers leave. Keel puts a stable broadcaster in the cloud, so the platform only ever talks to a connection that does not drop.</p></div></section>

<section class="section" id="states"><div class="wrap"><div class="eyebrow">Three states</div><h2 style="margin:14px 0 40px">One mark. Three tilts.</h2>
<div class="grid g3">
<div class="card"><span class="chip live"><i></i>Live.</span><h3 style="margin:22px 0 10px">Signal is good.</h3><p class="muted">Your phone feed goes straight through. Tilt: 6 degrees. Nothing to do.</p></div>
<div class="card"><span class="chip low"><i></i>Weak signal.</span><h3 style="margin:22px 0 10px">Below 800 kbps for 3 seconds.</h3><p class="muted">A small pill tells viewers you are on a weak connection. The feed keeps playing. Tilt: 12 degrees.</p></div>
<div class="card"><span class="chip off"><i></i>Holding on.</span><h3 style="margin:22px 0 10px">Below 50 kbps for 2 seconds.</h3><p class="muted">Be right back screen goes up. The broadcast to the platform continues. Back to live only after 5 stable seconds. Tilt: 18 degrees.</p></div>
</div></div></section>

<section class="section foam"><div class="wrap"><div class="eyebrow">The operator view</div><h2 style="margin:14px 0 40px">A dashboard you can read at arm's length.</h2>
<div class="shots"><img src="/assets/dashboard.png" alt="Keel dashboard on desktop" loading="lazy"><img src="/assets/dashboard-mobile.png" alt="Keel dashboard on phone" loading="lazy"></div></div></section>

<section class="section"><div class="wrap"><div class="grid g2" style="gap:48px;align-items:start"><div><div class="eyebrow">Why rebuild this</div><h2 style="margin-top:14px">Streamers should not have to debug their tools live.</h2></div>
<div><p class="lead" style="margin-bottom:22px">Existing hosted toolkits work until the moment they do not. Glitches and dead sessions happen in front of tens of thousands of viewers.</p><p class="lead">Keel is built around one idea: degrade fast, recover slow. Switch to Be right back within seconds of a real drop, and wait for a stable signal before going back. No flapping, no half-frozen frames.</p></div></div></div></section>

<section class="section sand"><div class="wrap"><div class="eyebrow">Questions</div><h2 style="margin:14px 0 36px">Straight answers.</h2>
<details><summary>Does it work today?</summary><p>The core path is tested end to end in a container: SRT in, OBS switching between LIVE, LOW SIGNAL and BRB, broadcast out, recovery, zero unexpected stops. It has not yet been tested on a real phone over cellular or against live Twitch, Kick or YouTube. The <a href="/status">status page</a> lists exactly what is and is not proven.</p></details>
<details><summary>Which apps can send to it?</summary><p>Anything that speaks SRT or RTMP, which includes the common IRL streaming apps. Bonded cellular (SRTLA) is supported through a receiver in the stack, still to be field tested.</p></details>
<details><summary>What does it cost to run?</summary><p>A CPU server with x264 is the cheapest start. A GPU server is for heavier scenes. The <a href="/investors">investor page</a> has a cost model with every assumption visible and editable.</p></details>
<details><summary>Can I self host?</summary><p>Yes. One docker compose file brings up the whole stack on any Linux server with a public IP. The guide takes about thirty minutes.</p></details>
<details><summary>Who is behind it?</summary><p>It is an open project, designed so a funded team can take it to launch in about a week. See the <a href="/investors#week">launch plan</a>.</p></details>
</div></section>

<section class="section buoy"><div class="wrap" style="text-align:left"><h2>Hold the line.</h2><div style="margin-top:32px;display:flex;gap:14px;flex-wrap:wrap"><a class="btn solid" href="/start">Get it running</a><a class="btn" href="/investors">For investors</a></div></div></section>
'''
page("index.html", "Keel. The signal moves. The stream holds.", "A cloud stack for mobile streamers. When your signal drops, viewers see Be right back. When it returns, you are live again.", home, '<script src="/js/sim.js"></script>')

# ---------- HOW IT WORKS ----------
how = '''
<section class="hero" style="padding-bottom:40px"><div class="wrap"><div class="eyebrow">How it works</div><h1 style="font-size:clamp(48px,7vw,104px);margin-top:16px">Phone in. Platform out. Keel in the middle.</h1><p class="lead" style="margin-top:26px;max-width:720px">Four parts. Each is boring on purpose. The only clever bit is the switching rule.</p></div></section>
<section class="section" style="padding-top:20px"><div class="wrap">
<div class="flow">
<div class="node"><div class="box"><div class="n">01 Ingest</div><h3>Your phone sends SRT.</h3><p class="muted" style="margin-top:10px">mediamtx receives SRT, RTMP or bonded SRTLA and exposes live bitrate.</p></div></div>
<div class="node key"><div class="box"><div class="n">02 Decide</div><h3>The controller watches.</h3><p style="margin-top:10px;color:#9FB3B0">Polls bitrate every second. Degrades fast, recovers slow. Drives OBS over websocket.</p></div></div>
<div class="node"><div class="box"><div class="n">03 Compose</div><h3>Headless OBS.</h3><p class="muted" style="margin-top:10px">Scenes LIVE, LOW SIGNAL and BRB. Renders and encodes in the cloud.</p></div></div>
<div class="node"><div class="box"><div class="n">04 Broadcast</div><h3>One steady stream out.</h3><p class="muted" style="margin-top:10px">RTMP to Twitch, Kick and YouTube. The platform never sees your phone drop.</p></div></div>
</div>
<div class="waterline"></div>
<p class="muted" style="max-width:640px">Everything above the line can fail. Everything below it keeps broadcasting.</p>
</div></section>

<section class="section dark light-rules"><div class="wrap"><div class="eyebrow" style="color:#FF5B1F">The switching rule</div><h2 style="margin:14px 0 36px">Degrade fast. Recover slow.</h2>
<table class="rules"><tr><th>Input</th><th>Condition</th><th>Holds for</th><th>Result</th></tr>
<tr><td>Good</td><td>800 kbps or more</td><td>5 s to recover</td><td><span class="chip live"><i></i>Live.</span></td></tr>
<tr><td>Weak</td><td>50 to 800 kbps</td><td>3 s to degrade</td><td><span class="chip low"><i></i>Weak signal.</span></td></tr>
<tr><td>Dead</td><td>under 50 kbps</td><td>2 s to degrade</td><td><span class="chip off"><i></i>Holding on.</span></td></tr></table>
<p class="muted" style="margin-top:22px;max-width:640px">All thresholds are configurable per streamer. Defaults come from the reference controller in <code>controller/src/switcher.ts</code>.</p></div></section>

<section class="section"><div class="wrap grid g2" style="gap:48px"><div><div class="eyebrow">Also in the box</div><h2 style="margin:14px 0">Operator tools.</h2></div>
<div class="grid" style="gap:14px"><div class="card" style="padding:22px"><b>Dashboard and API.</b> Bearer token, live updates over SSE, history, Prometheus metrics, health check.</div><div class="card" style="padding:22px"><b>Chat commands.</b> Moderators on Twitch can switch scenes or force BRB.</div><div class="card" style="padding:22px"><b>Reliability record.</b> Every state change is logged, so you can show a streamer their uptime.</div><div class="card" style="padding:22px"><b>Idle shutdown.</b> The server stops itself when nobody streams, so you do not pay for empty hours.</div><div class="card" style="padding:22px"><b>Mobile app.</b> A companion app to watch state and switch scenes from the street.</div></div></div></section>
'''
page("how-it-works.html", "How Keel works", "Phone in, platform out. A cloud controller switches between live, weak signal and Be right back.", how)

# ---------- INVESTORS ----------
inv = '''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">For investors and operators</div><h1 style="font-size:clamp(48px,7vw,104px);margin-top:16px">Hosted streaming reliability is a subscription business.</h1><p class="lead" style="margin-top:26px;max-width:760px">Streamers pay monthly to avoid failing in front of their audience. The product is built and the core path is tested. What remains is field testing, a billing layer and distribution. A funded team can run that in a week.</p></div></section>

<section class="section" style="padding-top:20px"><div class="wrap"><div class="grid g3">
<div class="card"><div class="stat">1</div><p class="muted" style="margin-top:10px">Customer problem: streams that fail live.</p></div>
<div class="card"><div class="stat">0</div><p class="muted" style="margin-top:10px">Unexpected broadcast stops in the tested path.</p></div>
<div class="card"><div class="stat">7d</div><p class="muted" style="margin-top:10px">Planned time from funding to a paid pilot.</p></div></div></div></section>

<section class="section dark" id="model"><div class="wrap"><div class="eyebrow" style="color:#FF5B1F">Cost model</div><h2 style="margin:14px 0 14px">Move the sliders.</h2><p class="muted" style="margin-bottom:36px;max-width:640px">Illustrative unit economics. Hourly rates and support costs are assumptions, not quotes. Change them in <code>web/js/calc.js</code> or <code>docs/COSTS.md</code>.</p>
<div class="calc"><div class="card"><div class="field"><label>Paying streamers <b id="v-n">50</b></label><input id="c-n" type="range" min="1" max="500" value="50"></div><div class="field"><label>Live hours per week, each <b id="v-h">20 h</b></label><input id="c-h" type="range" min="2" max="60" value="20"></div><div class="field"><label>Monthly price <b id="v-p">€49</b></label><input id="c-p" type="range" min="9" max="199" value="49"></div><div class="field"><label><span>Use a GPU server (NVENC, untested)</span><input id="c-g" type="checkbox"></label></div></div>
<div class="card"><div class="out"><span>Revenue per month</span><b id="o-rev"></b></div><div class="out"><span>Infrastructure and support</span><b id="o-cost"></b></div><div class="out"><span>Cost per streamer</span><b id="o-per"></b></div><div class="out"><span>Margin after payment fees</span><b id="o-gm"></b></div><div class="out"><span>Profit per month</span><b id="o-profit"></b></div><div class="out"><span>Break-even</span><b id="o-be"></b></div></div></div></div></section>

<section class="section" id="week"><div class="wrap"><div class="eyebrow">Launch in a week</div><h2 style="margin:14px 0 36px">Day by day.</h2>
<table class="table"><tr><th>Day</th><th>Goal</th><th>Done when</th></tr>
<tr><td><b>1</b></td><td>Provision cloud account, domain, TLS. Run <code>deploy/install.sh</code>.</td><td>Dashboard reachable over HTTPS.</td></tr>
<tr><td><b>2</b></td><td>Field test with a real phone over cellular, including SRTLA bonding.</td><td>Ten minute drive test, zero stops.</td></tr>
<tr><td><b>3</b></td><td>Test real Twitch, Kick and YouTube outputs. Measure glass to glass latency.</td><td>Latency number recorded.</td></tr>
<tr><td><b>4</b></td><td>Enable platform service: tenant signup, server lifecycle, usage metering.</td><td>Two test tenants provisioned automatically.</td></tr>
<tr><td><b>5</b></td><td>Wire Stripe, set pricing, ship the mobile app to TestFlight and internal track.</td><td>First test payment clears.</td></tr>
<tr><td><b>6</b></td><td>Soak test, chaos script, security review of the token model.</td><td>Eight hour soak passes.</td></tr>
<tr><td><b>7</b></td><td>Onboard three pilot streamers.</td><td>Three real streams on Keel.</td></tr></table></div></section>

<section class="section sand"><div class="wrap"><div class="eyebrow">Risks, stated plainly</div><h2 style="margin:14px 0 30px">What could go wrong.</h2>
<div class="grid g2"><div class="card"><b>Reliability claim is unproven in the field.</b><p class="muted" style="margin-top:8px">Container tests are not a drive test. Day 2 and 3 exist for this.</p></div><div class="card"><b>Platform policy.</b><p class="muted" style="margin-top:8px">Restream rules differ by platform. Review before selling.</p></div><div class="card"><b>Incumbent response.</b><p class="muted" style="margin-top:8px">A larger toolkit can copy features. Reliability and one anchor streamer are the defence.</p></div><div class="card"><b>GPU encoding.</b><p class="muted" style="margin-top:8px">NVENC path is untested. CPU x264 is the safe default.</p></div></div></div></section>
'''
page("investors.html", "Keel for investors", "Unit economics, launch plan and risks for taking Keel to market in a week.", inv, '<script src="/js/calc.js"></script>')

# ---------- START ----------
start = '''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">Get it running</div><h1 style="font-size:clamp(48px,7vw,104px);margin-top:16px">Thirty minutes to your first stream.</h1><p class="lead" style="margin-top:26px;max-width:700px">You need a Linux server with a public IP, Docker, and a stream key for one platform.</p></div></section>
<section class="section" style="padding-top:20px"><div class="wrap" style="max-width:900px">
<div style="display:grid;gap:18px">
<div class="card"><span class="disc">1</span><h3 style="margin:16px 0 8px">Get the code.</h3><pre style="background:#0E2A2F;color:#F3EEE4;padding:18px;border-radius:20px;overflow:auto;font-size:15px">git clone &lt;your keel repo&gt;
cd keel/stack
cp .env.example .env</pre></div>
<div class="card"><span class="disc">2</span><h3 style="margin:16px 0 8px">Fill in .env.</h3><p class="muted">Set your admin token, your platform stream key, and your public hostname.</p></div>
<div class="card"><span class="disc">3</span><h3 style="margin:16px 0 8px">Start it.</h3><pre style="background:#0E2A2F;color:#F3EEE4;padding:18px;border-radius:20px;overflow:auto;font-size:15px">docker compose up -d</pre></div>
<div class="card"><span class="disc">4</span><h3 style="margin:16px 0 8px">Point your phone at it.</h3><p class="muted">In your IRL streaming app set the output to <code>srt://your-host:8890</code> with the stream id from the README. Open the dashboard to watch the state.</p></div>
</div><p class="muted" style="margin-top:28px">Full guide with firewall ports, TLS and troubleshooting: <code>README.md</code> and <code>docs/</code> in the repo.</p></div></section>
'''
page("start.html", "Get Keel running", "Clone, configure, docker compose up. A first stream in about thirty minutes.", start)

# ---------- STATUS ----------
def row(a, b, c):
    cls = {"Tested": "tick", "Not tested": "cross", "Partial": "warn"}[b]
    return f'<tr><td>{a}</td><td class="{cls}">{b}</td><td class="muted">{c}</td></tr>'
rows = "".join([
 row("SRT ingest and bitrate read", "Tested", "Container end to end, real OBS and mediamtx"),
 row("State switching LIVE, LOW SIGNAL, BRB", "Tested", "Including recovery after a killed feed"),
 row("Broadcast continues during phone drop", "Tested", "Verified against a stand-in RTMP sink"),
 row("Dashboard, API, SSE, metrics", "Tested", "Unit tests and screenshots on desktop and phone"),
 row("SRTLA bonded cellular", "Not tested", "Image builds the receiver, no field test"),
 row("NVENC GPU encoding", "Not tested", "CPU x264 is the verified path"),
 row("Real Twitch, Kick, YouTube outputs", "Not tested", "Only a stand-in sink so far"),
 row("Real phone over cellular", "Not tested", "Day 2 of the launch plan"),
 row("Latency, soak, load", "Not tested", "Days 3 and 6 of the launch plan"),
 row("Mobile app on a device", "Partial", "Type-checked and logic tested, not yet run on hardware"),
 row("Multi-tenant platform service", "Partial", "Runs against a mock provider, real cloud adapter untested"),
])
status = f'''
<section class="hero" style="padding-bottom:30px"><div class="wrap"><div class="eyebrow">Status</div><h1 style="font-size:clamp(48px,7vw,104px);margin-top:16px">What is proven. What is not.</h1><p class="lead" style="margin-top:26px;max-width:700px">Investors and streamers should know exactly where the edge is.</p></div></section>
<section class="section" style="padding-top:20px"><div class="wrap"><table class="table"><tr><th>Capability</th><th>State</th><th>Notes</th></tr>{rows}</table></div></section>
'''
page("status.html", "Keel status", "Exactly what is tested and what is not.", status)

# ---------- 404 ----------
page("404.html", "Lost signal. Keel", "Page not found.", '''<section class="hero"><div class="wrap"><div class="eyebrow">404</div><h1 style="margin-top:16px">Be right back.</h1><p class="lead">That page is not here. <a href="/">Go home</a>.</p></div></section>''')
print("built")
