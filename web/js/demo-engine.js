// Keel demo engine. A simulated Keel server that runs in the browser and speaks the same
// status shape and actions as the real controller, so the website can show the real
// dashboard UI with no server. The switching logic mirrors controller/src/switcher.ts.
(() => {
  const now = () => Date.now();
  const TH = { lowKbps: 800, offlineKbps: 50, degradeLowS: 3, degradeOfflineS: 2, recoverS: 5, windowS: 2, maxDropPct: 2, maxLossPct: 20 };
  const SEV = { live: 0, low: 1, offline: 2 };
  const SCENES = { live: 'LIVE', low: 'LOW SIGNAL', brb: 'BRB' };
  const HOST = 'demo.keel.stream';
  const KEY = 'live/k3Elx9Q2mVdemo7Hs4Rt';

  // ---- switcher (same rules as the controller) ----
  function classify(s) {
    if (!s.ready || s.kbps < TH.offlineKbps) return 'offline';
    if (s.kbps < TH.lowKbps) return 'low';
    if (TH.maxDropPct && (s.dropPct || 0) > TH.maxDropPct) return 'low';
    if (TH.maxLossPct && (s.lossPct || 0) > TH.maxLossPct) return 'low';
    return 'live';
  }
  function weakReason(s) {
    if (s.kbps < TH.lowKbps) return 'bitrate below ' + TH.lowKbps + ' kbps';
    if (TH.maxDropPct && s.dropPct > TH.maxDropPct) return s.dropPct.toFixed(1) + '% of packets dropped';
    return Math.round(s.lossPct) + '% packet loss';
  }
  function Switcher() { this.state = 'offline'; this.r = { off: null, deg: null, ok: null, notOff: null }; }
  Switcher.prototype.update = function (s) {
    const raw = classify(s), t = s.t, r = this.r, prev = this.state;
    r.off = raw === 'offline' ? (r.off ?? t) : null;
    r.deg = raw !== 'live' ? (r.deg ?? t) : null;
    r.ok = raw === 'live' ? (r.ok ?? t) : null;
    r.notOff = raw !== 'offline' ? (r.notOff ?? t) : null;
    const held = (since, sec) => since !== null && t - since >= sec * 1000;
    let next = prev, reason = 'steady';
    if (prev !== 'offline' && held(r.off, TH.degradeOfflineS)) { next = 'offline'; reason = s.ready ? 'bitrate collapsed' : 'publisher disconnected'; }
    else if (prev === 'live' && held(r.deg, TH.degradeLowS)) { next = 'low'; reason = weakReason(s); }
    else if (prev !== 'live' && held(r.ok, TH.recoverS)) { next = 'live'; reason = 'healthy for ' + TH.recoverS + 's'; }
    else if (prev === 'offline' && raw === 'low' && held(r.notOff, TH.recoverS)) { next = 'low'; reason = 'feed back, bitrate weak'; }
    if (next !== prev) {
      this.state = next;
      r.deg = raw !== 'live' ? t : null; r.ok = raw === 'live' ? t : null; r.off = raw === 'offline' ? t : null; r.notOff = raw !== 'offline' ? t : null;
    }
    return { state: this.state, previous: prev, changed: next !== prev, reason };
  };

  // ---- world ----
  const urls = (p) => ({ srt: 'srt://' + HOST + ':8890?streamid=publish:' + p, srtla: 'srtla://' + HOST + ':5000?streamid=publish:' + p, rtmp: 'rtmp://' + HOST + ':1935/' + p });
  const mkSrc = (id, label, path, base, rtt) => ({ id, label, path, base, rtt, sw: new Switcher(), stateReason: 'waiting for feed', feed: { ready: true, kbps: base, lossPct: 0.4, dropPct: 0, rttMs: rtt }, script: null });
  const src = [mkSrc('primary', 'Primary', KEY, 4800, 72), mkSrc('backup', 'Backup', KEY + '-backup', 3200, 118)];
  const dests = [
    { id: 'twitch', name: 'Twitch', target: 'rtmp://live.twitch.tv/app/••••8f2a' },
    { id: 'kick', name: 'Kick', target: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app/••••91c0' },
    { id: 'youtube', name: 'YouTube', target: 'rtmp://a.rtmp.youtube.com/live2/••••k7wq' },
  ].map((d) => Object.assign(d, { enabled: true, state: 'off', since: now(), kbps: 0, restarts: 0, lastError: '', down: 0 }));

  const S = {
    mode: 'auto', pin: 'auto', active: 'primary', signal: 'offline', reason: 'waiting for feed', scene: SCENES.brb,
    obsConnected: true, obsStreaming: false, wanted: false, shield: false, shieldAt: null, obsDownUntil: 0, autoRestarts: 0,
    events: [], history: [], since: now(), t0: now(),
    sum: { drops: 0, lowEvents: 0, offlineMs: 0, longestMs: 0, offlineSince: null, streamMs: 0, streamSince: null, streamStarts: 0, unexpected: 0, obsDisconnects: 0, failovers: 0, shieldMs: 0, destReconnects: 0 },
  };
  const ev = (type, state, detail) => { S.events.push({ t: now(), type, state, detail }); if (S.events.length > 30) S.events.shift(); };

  // ---- scenarios: each sets a script on a source or the stack, keyed by seconds from start ----
  const at = (sec) => now() + sec * 1000;
  const SCEN = {
    calm() { for (const s of src) s.script = null; dests.forEach((d) => (d.down = 0)); S.obsDownUntil = 0; return 'Both phones healthy.'; },
    tunnel() { src[0].script = [[at(0), 0, false], [at(11), 380, true], [at(15), null]]; src[1].script = [[at(0), 0, false], [at(16), null]]; return 'Single phone into a tunnel: Weak, then Holding on, then back.'; },
    weak() { src[0].script = [[at(0), 460, true, 9], [at(16), null]]; return 'Signal sagging to 460 kbps for 16 seconds.'; },
    packets() { src[0].script = [[at(0), 4700, true, 4, 6.5], [at(14), null]]; return 'Full bitrate, but 6.5% of packets arrive too late. Bitrate-only switchers miss this.'; },
    failover() { src[0].script = [[at(0), 0, false], [at(24), null]]; return 'Primary phone dies. The backup encoder takes over, viewers stay live.'; },
    platform() { const k = dests[1]; k.down = at(7); k.lastError = 'Connection reset by peer'; return 'Kick drops the connection. Twitch and YouTube are not touched.'; },
    obs() { S.obsDownUntil = at(11); return 'OBS crashes. The crash shield holds BRB on every platform until it is back.'; },
  };
  function feedFor(s, t) {
    const jitter = 1 + Math.sin(t / 1000 * 1.7 + (s.id === 'backup' ? 2 : 0)) * 0.05 + Math.sin(t / 1000 * 0.31) * 0.04;
    let f = { ready: true, kbps: s.base * jitter, lossPct: 0.3 + Math.abs(Math.sin(t / 3700)) * 0.8, dropPct: 0, rttMs: s.rtt + Math.sin(t / 2100) * 14 };
    if (s.script) {
      let row = null;
      for (const r of s.script) if (t >= r[0]) row = r;
      if (row && row[1] === null) s.script = null;
      else if (row) {
        f = { ready: row[2], kbps: row[2] ? row[1] * jitter : 0, lossPct: row[3] ?? (row[1] < 800 ? 13 : 0.6), dropPct: row[4] ?? (row[1] < 800 ? 2.4 : 0.05), rttMs: s.rtt + (row[1] < 800 ? 260 : 40) + Math.sin(t / 900) * 30 };
      }
    }
    if (!f.ready) f = { ready: false, kbps: 0, lossPct: null, dropPct: null, rttMs: null };
    return f;
  }

  function current() { return src.find((s) => s.id === S.active) || src[0]; }
  function pick() {
    if (S.pin !== 'auto') return src.find((s) => s.id === S.pin);
    let best = src[0];
    for (const s of src.slice(1)) if (SEV[s.sw.state] < SEV[best.sw.state]) best = s;
    return best;
  }
  const onAir = () => dests.some((d) => d.state === 'live' || d.state === 'shield');

  function tick() {
    const t = now();
    // OBS crash and recovery
    const obsUp = t >= S.obsDownUntil;
    if (!obsUp && S.obsConnected) { S.obsConnected = false; S.obsStreaming = false; S.shieldAt = t + 3000; S.sum.obsDisconnects++; ev('obs', 'disconnected'); }
    if (obsUp && !S.obsConnected) {
      S.obsConnected = true;
      if (S.wanted) { S.obsStreaming = true; S.autoRestarts++; }
      if (S.shield) { S.shield = false; S.sum.shieldMs += t - S.shieldStart; ev('shield', 'off'); }
      S.shieldAt = null;
    }
    if (!S.obsConnected && S.wanted && !S.shield && S.shieldAt && t >= S.shieldAt) { S.shield = true; S.shieldStart = t; ev('shield', 'on'); }

    // sources
    for (const s of src) {
      s.feed = feedFor(s, t);
      const d = s.sw.update({ t, ready: s.feed.ready, kbps: s.feed.kbps, lossPct: s.feed.lossPct, dropPct: s.feed.dropPct });
      if (d.changed) s.stateReason = d.reason;
    }
    const next = pick();
    if (next.id !== S.active) { S.active = next.id; ev('source', next.id, S.pin === 'auto' ? 'automatic failover' : 'pinned'); if (next.id === 'backup') S.sum.failovers++; }
    const st = next.sw.state;
    const reason = next.id === 'backup' && st !== 'offline' ? 'on backup: ' + next.stateReason : next.stateReason;
    if (st !== S.signal) {
      const prev = S.signal; S.signal = st; S.reason = reason; ev('signal', st, reason);
      if (st === 'offline') { S.sum.drops++; S.sum.offlineSince = t; }
      else { if (st === 'low') S.sum.lowEvents++; if (prev === 'offline' && S.sum.offlineSince) { const d = t - S.sum.offlineSince; S.sum.offlineMs += d; S.sum.longestMs = Math.max(S.sum.longestMs, d); S.sum.offlineSince = null; } }
    } else S.reason = reason;
    if (S.mode === 'auto' && S.obsConnected) S.scene = st === 'live' ? SCENES.live : st === 'low' ? SCENES.low : SCENES.brb;

    // destinations (relay)
    for (const d of dests) {
      const prevState = d.state;
      if (!S.wanted || !d.enabled) { d.state = d.enabled ? 'off' : 'disabled'; d.kbps = 0; }
      else if (d.down && t < d.down) { if (d.state !== 'retrying') { d.restarts++; S.sum.destReconnects++; ev('dest', 'retrying', d.name); } d.state = 'retrying'; d.kbps = 0; }
      else {
        if (d.down) { d.down = 0; ev('dest', 'live', d.name); }
        if (S.shield) { d.state = 'shield'; d.kbps = 2500 + Math.sin(t / 700) * 60; }
        else if (S.obsStreaming) { d.state = d.state === 'off' || d.state === 'disabled' ? 'connecting' : 'live'; d.kbps = 6000 + Math.sin(t / 900 + d.restarts) * 140; d.lastError = d.state === 'live' ? '' : d.lastError; }
        else if (!S.obsConnected) { d.state = 'connecting'; d.kbps = 0; }
      }
      if (d.state !== prevState) d.since = t;
    }
    const air = onAir();
    if (air && S.sum.streamSince === null) { S.sum.streamSince = t; S.sum.streamStarts++; }
    if (!air && S.sum.streamSince !== null && !S.wanted) { S.sum.streamMs += t - S.sum.streamSince; S.sum.streamSince = null; }

    const cur = current();
    S.history.push({ t, kbps: Math.round(cur.feed.kbps), state: S.signal, scene: S.scene, streaming: air, source: cur.id, rttMs: cur.feed.rttMs == null ? null : Math.round(cur.feed.rttMs) });
    if (S.history.length > 600) S.history.shift();
  }

  function summary(t) {
    const m = S.sum;
    const off = m.offlineMs + (m.offlineSince ? t - m.offlineSince : 0);
    return {
      since: S.since, drops: m.drops, lowEvents: m.lowEvents, offlineSeconds: Math.round(off / 1000), longestDropSeconds: Math.round(Math.max(m.longestMs, m.offlineSince ? t - m.offlineSince : 0) / 1000),
      streamSeconds: Math.round((m.streamMs + (m.streamSince ? t - m.streamSince : 0)) / 1000), streamStarts: m.streamStarts, streamUnexpectedStops: m.unexpected, obsDisconnects: m.obsDisconnects,
      failovers: m.failovers, shieldSeconds: Math.round((m.shieldMs + (S.shield ? t - S.shieldStart : 0)) / 1000), destReconnects: m.destReconnects,
    };
  }
  const link = (f) => (f.ready ? { rttMs: Math.round(f.rttMs), lossPct: Math.round(f.lossPct * 10) / 10, dropPct: Math.round(f.dropPct * 10) / 10, bufferMs: 1200, capacityMbps: Math.round(f.kbps / 100) / 10 * 2.2 } : null);
  function status() {
    const t = now(), cur = current();
    const secs = Math.floor((t - (S.sum.streamSince || t)) / 1000);
    const tc = [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60].map((n) => String(n).padStart(2, '0')).join(':');
    return {
      version: 'demo', t, mode: S.mode, scenes: SCENES, role: 'admin',
      obs: { connected: S.obsConnected, synced: S.obsConnected, scene: S.obsConnected ? S.scene : null, streaming: S.obsStreaming, reconnecting: false, timecode: S.obsStreaming ? tc + '.000' : '', skippedFrames: 0, totalFrames: 1 },
      ingest: { state: S.signal, reason: S.reason, ready: cur.feed.ready, kbps: Math.round(cur.feed.kbps), source: cur.feed.ready ? 'srtConn' : null, tracks: cur.feed.ready ? ['H264', 'MPEG-4 Audio'] : [], apiError: false, link: link(cur.feed), active: S.active, pin: S.pin, thresholds: Object.assign({}, TH) },
      sources: src.map((s) => ({ id: s.id, label: s.label, state: s.sw.state, reason: s.stateReason, ready: s.feed.ready, kbps: Math.round(s.feed.kbps), protocol: s.feed.ready ? 'srtConn' : null, link: link(s.feed), active: s.id === S.active, urls: urls(s.path) })),
      broadcast: { output: 'relay', wanted: S.wanted, onAir: onAir(), shield: S.shield, autoRestarts: S.autoRestarts, destinations: dests.map((d) => ({ id: d.id, name: d.name, target: d.target, enabled: d.enabled, state: d.state, since: d.since, kbps: Math.round(d.kbps), restarts: d.restarts, lastError: d.state === 'retrying' ? d.lastError : '' })) },
      urls: urls(KEY), summary: summary(t), events: S.events.slice(),
    };
  }

  // ---- warm start: two minutes of calm history, already live ----
  (function warm() {
    const t1 = now();
    for (let i = 120; i > 0; i--) {
      const t = t1 - i * 1000, f = feedFor(src[0], t);
      S.history.push({ t, kbps: Math.round(f.kbps), state: 'live', scene: SCENES.live, streaming: true, source: 'primary', rttMs: Math.round(f.rttMs) });
    }
    for (const s of src) { s.sw.state = 'live'; s.stateReason = 'healthy for 5s'; }
    S.signal = 'live'; S.reason = 'healthy for 5s'; S.scene = SCENES.live; S.wanted = true; S.obsStreaming = true;
    S.sum.streamSince = t1 - 120_000; S.sum.streamStarts = 1;
    dests.forEach((d) => { d.state = 'live'; d.since = t1 - 120_000; });
    S.events.push({ t: t1 - 121_000, type: 'stream', state: 'started' }, { t: t1 - 120_000, type: 'signal', state: 'live', detail: 'healthy for 5s' });
  })();

  const ok = (message) => Promise.resolve({ message });
  const subs = new Set();
  let timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(() => { tick(); const s = status(); for (const f of subs) f(s); }, 1000);
  }

  window.KeelDemo = {
    call(path, body) {
      if (path === '/api/history') return Promise.resolve(S.history.slice());
      if (path === '/api/status') return Promise.resolve(status());
      if (path === '/api/scene') { S.mode = 'manual'; S.scene = SCENES[body.scene]; return ok('Scene set to ' + body.scene.toUpperCase() + '. Auto-switching is off.'); }
      if (path === '/api/mode') { S.mode = body.mode; return ok(body.mode === 'auto' ? 'Auto-switching on.' : 'Auto-switching off.'); }
      if (path === '/api/source') { S.pin = body.source; return ok(body.source === 'auto' ? 'Source: automatic failover.' : 'Source pinned to ' + body.source + '.'); }
      if (path === '/api/stream/start') { S.wanted = true; S.obsStreaming = S.obsConnected; ev('stream', 'started'); return ok('Starting the broadcast to 3 destinations.'); }
      if (path === '/api/stream/stop') { S.wanted = false; S.obsStreaming = false; ev('stream', 'stopped'); return ok('Broadcast stopped.'); }
      if (path === '/api/destination') { const d = dests.find((x) => x.id === body.id); d.enabled = body.enabled; return ok(d.name + (body.enabled ? ' on.' : ' paused.')); }
      if (path === '/api/settings') {
        for (const [k, v] of Object.entries(body)) if (k in TH && Number.isFinite(v)) TH[k] = v;
        if (TH.offlineKbps >= TH.lowKbps) return Promise.reject(new Error('The offline floor must be below the weak signal floor.'));
        return Promise.resolve({ thresholds: TH });
      }
      return Promise.reject(new Error('Not available in the demo.'));
    },
    subscribe(fn) { subs.add(fn); start(); return () => subs.delete(fn); },
    scenario(name) { return (SCEN[name] || SCEN.calm)(); },
  };
})();
