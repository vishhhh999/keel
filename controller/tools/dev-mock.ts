// Run the whole controller against a fake OBS and a simulated phone feed, no Docker needed.
//
//   cd controller && npm install && npm run dev:mock
//   open http://localhost:8080   (token: dev)
//
// The simulated phone cycles: connect -> healthy -> weak -> drop -> recover. Set SPEED=4 to run faster.

import { createServer } from 'node:http';
import { chmodSync } from 'node:fs';
import { MockObs } from './mock-obs.ts';

const SPEED = Number(process.env.SPEED ?? 1);
// Uploading through the GitHub website or unzipping on Windows drops the executable bit; restore it.
function fakeFfmpeg(): string {
  const p = new URL('./fake-ffmpeg.sh', import.meta.url).pathname;
  try { chmodSync(p, 0o755); } catch { /* read-only checkout: run it anyway */ }
  return p;
}
const PATH_NAME = 'live/devmockkey0123456789';

const obs = new MockObs({ port: 4455, password: 'dev-obs' });
obs.setStreaming(false);

// Timeline in seconds: [start, end, state, kbps]
const CYCLE = 150;
const TIMELINE: [number, number, 'none' | 'ok' | 'low', number][] = [
  [0, 8, 'none', 0],
  [8, 62, 'ok', 4300],
  [62, 78, 'low', 520],
  [78, 94, 'none', 0],
  [94, 150, 'ok', 5200],
];

const t0 = Date.now();
let lastT = t0;

function phase(): { ready: boolean; kbps: number } {
  const t = (((Date.now() - t0) / 1000) * SPEED) % CYCLE;
  const row = TIMELINE.find(([a, b]) => t >= a && t < b)!;
  if (row[2] === 'none') return { ready: false, kbps: 0 };
  const jitter = 1 + Math.sin(t * 1.7) * 0.08 + Math.sin(t * 0.31) * 0.05;
  return { ready: true, kbps: row[3] * jitter };
}

// The backup phone runs on its own, overlapping timeline so failover can be watched.
const BACKUP: [number, number, 'none' | 'ok' | 'low', number][] = [
  [0, 40, 'none', 0],
  [40, 120, 'ok', 3100],
  [120, 150, 'none', 0],
];
function backupPhase(): { ready: boolean; kbps: number } {
  const t = (((Date.now() - t0) / 1000) * SPEED) % CYCLE;
  const row = BACKUP.find(([a, b]) => t >= a && t < b)!;
  if (row[2] === 'none') return { ready: false, kbps: 0 };
  return { ready: true, kbps: row[3] * (1 + Math.sin(t * 2.3) * 0.06) };
}

const counters = new Map<string, { bytes: number; was: boolean; recv: number; loss: number; drop: number }>();
function count(path: string, p: { ready: boolean; kbps: number }, dt: number) {
  const c = counters.get(path) ?? { bytes: 0, was: false, recv: 0, loss: 0, drop: 0 };
  if (p.ready && !c.was) Object.assign(c, { bytes: 0, recv: 0, loss: 0, drop: 0 });
  c.was = p.ready;
  if (p.ready) {
    c.bytes += ((p.kbps * 1000) / 8) * dt;
    const pkts = (p.kbps * 1000 * dt) / 8 / 1316;
    const weak = p.kbps < 800;
    c.recv += pkts;
    c.loss += pkts * (weak ? 0.12 : 0.008);
    c.drop += pkts * (weak ? 0.03 : 0.0005);
  }
  counters.set(path, c);
  return c;
}

// Pretend to be the mediamtx control API.
const BACKUP_PATH = PATH_NAME + '-backup';
const OUT_PATH = 'out/' + PATH_NAME.replace(/^live\//, '');
const fake = createServer((req, res) => {
  const now = Date.now();
  const dt = (now - lastT) / 1000;
  lastT = now;
  const feeds: Record<string, { ready: boolean; kbps: number }> = { [PATH_NAME]: phase(), [BACKUP_PATH]: backupPhase(), [OUT_PATH]: { ready: obs.streaming, kbps: 6000 } };
  const c = Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, count(k, v, dt)]));
  const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/v3/srtconns/list') {
    const t = (Date.now() - t0) / 1000;
    return json(200, { items: [PATH_NAME, BACKUP_PATH].filter((p) => feeds[p]!.ready).map((p, i) => ({
      path: p, state: 'publish', msRTT: Math.round((p === PATH_NAME ? 68 : 112) + Math.sin(t * 0.9 + i) * 18 + (feeds[p]!.kbps < 800 ? 140 : 0)),
      packetsReceived: Math.round(c[p]!.recv), packetsReceivedLoss: Math.round(c[p]!.loss), packetsReceivedDrop: Math.round(c[p]!.drop),
      msReceiveBuf: 1200, mbpsLinkCapacity: Math.round(feeds[p]!.kbps / 100) / 10 * 2.4,
    })) });
  }
  for (const [p, f] of Object.entries(feeds)) {
    if (req.url === `/v3/paths/get/${p}` && f.ready) {
      return json(200, { name: p, ready: true, source: { type: p === OUT_PATH ? 'rtmpConn' : 'srtConn' }, tracks: ['H264', 'MPEG-4 Audio'], inboundBytes: Math.round(c[p]!.bytes) });
    }
  }
  json(404, { error: 'path not found' });
});
fake.listen(9997, '127.0.0.1');

Object.assign(process.env, {
  KEEL_OBS_URL: 'ws://127.0.0.1:4455',
  KEEL_OBS_PASSWORD: 'dev-obs',
  KEEL_MEDIAMTX_API: 'http://127.0.0.1:9997',
  KEEL_INGEST_PATH: PATH_NAME,
  KEEL_API_TOKEN: 'dev',
  KEEL_DESTINATIONS: 'Twitch=rtmp://live.twitch.example/app/live_dev1234;Kick=rtmps://flaky.kick.example/app/sk_dev5678;YouTube=rtmp://a.rtmp.youtube.example/live2/dev-9012',
  KEEL_FFMPEG: fakeFfmpeg(),
  KEEL_MOD_TOKEN: 'mod',
  KEEL_DATA_DIR: process.env.KEEL_DATA_DIR ?? './data-dev',
  KEEL_RECOVER_S: String(Math.max(2, Math.round(5 / SPEED))),
  KEEL_DEGRADE_OFFLINE_S: String(Math.max(1, Math.round(2 / SPEED))),
  KEEL_DEGRADE_LOW_S: String(Math.max(1, Math.round(3 / SPEED))),
  KEEL_PUBLIC_HOST: 'stream.example.com',
});

console.log(`dev mock running. Dashboard: http://localhost:8080  token: dev (moderator: mod)  (speed x${SPEED})`);
await import('../src/main.ts');
