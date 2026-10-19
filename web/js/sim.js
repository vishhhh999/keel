// Keel signal simulator. Same rules as controller/src/switcher.ts, running in the browser.
// Defaults: low < 800 kbps, offline < 50 kbps. Degrade fast (2s offline, 3s low), recover slow (5s).
(() => {
  const LOW = 800, OFF = 50, DEG_OFF = 2000, DEG_LOW = 3000, REC = 5000;
  const $ = (s) => document.querySelector(s);
  const screen = $('#screen'), word = $('#word'), kb = $('#kb'), tilt = $('.markbox .tilt'), slider = $('#sig');
  if (!screen) return;
  let state = 'live', kbps = 4200, since = { low: null, off: null, good: null }, t0 = performance.now();
  let drops = 0, holdMs = 0, dropAt = null;
  const WORDS = { live: ['Live.', '#7BDDB0', 6], low: ['Weak signal.', '#F5B83D', 12], offline: ['Holding on.', '#FF5B1F', 18] };
  function apply(s) {
    state = s;
    const [w, c, a] = WORDS[s];
    word.textContent = w; word.style.color = c;
    tilt.style.transform = `rotate(${-a}deg)`;
    screen.className = 'screen' + (s === 'low' ? ' s-low' : s === 'offline' ? ' s-offline' : '');
  }
  function tick(now) {
    const dt = now - t0; t0 = now;
    const raw = kbps < OFF ? 'offline' : kbps < LOW ? 'low' : 'live';
    for (const k of ['low', 'off', 'good']) if (since[k] !== null) since[k] += dt;
    since.off = raw === 'offline' ? (since.off ?? 0) : null;
    since.low = raw === 'low' ? (since.low ?? 0) : null;
    since.good = raw === 'live' ? (since.good ?? 0) : null;
    let next = state;
    if (raw === 'offline' && since.off >= DEG_OFF) next = 'offline';
    else if (raw === 'low' && since.low >= DEG_LOW && state === 'live') next = 'low';
    else if (raw === 'low' && state === 'offline' && since.low >= REC) next = 'low';
    else if (raw === 'live' && since.good >= REC && state !== 'live') next = 'live';
    if (next !== state) {
      if (next === 'offline' && dropAt === null) { dropAt = now; drops++; }
      if (next === 'live') dropAt = null;
      apply(next);
    }
    if (dropAt !== null) holdMs += dt;
    kb.textContent = `${Math.round(kbps).toLocaleString()} kbps in`;
    $('#st-drops').textContent = drops;
    $('#st-hold').textContent = (holdMs / 1000).toFixed(0) + 's';
    $('#st-out').textContent = '0';
    requestAnimationFrame(tick);
  }
  const set = (v) => { kbps = v; slider.value = Math.round(Math.sqrt(v / 6000) * 1000); };
  slider.addEventListener('input', () => { const x = slider.value / 1000; kbps = x * x * 6000; });
  slider.value = Math.round(Math.sqrt(kbps / 6000) * 1000);
  $('#b-good').onclick = () => set(4200);
  $('#b-weak').onclick = () => set(450);
  $('#b-dead').onclick = () => set(0);
  $('#b-tunnel').onclick = () => { set(0); setTimeout(() => set(300), 6000); setTimeout(() => set(4200), 9000); };
  apply('live'); requestAnimationFrame((n) => { t0 = n; tick(n); });
})();
