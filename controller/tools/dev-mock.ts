// Run the whole controller against a fake OBS and a simulated phone feed, no Docker needed.
//
//   cd controller && npm install && npm run dev:mock
//   open http://localhost:8080   (token: dev)
//
// The simulated phone cycles: connect -> healthy -> weak -> drop -> recover. Set SPEED=4 to run faster.

import { createServer } from 'node:http';
import { MockObs } from './mock-obs.ts';

const SPEED = Number(process.env.SPEED ?? 1);
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
let bytes = 0;
let lastT = t0;
let wasReady = false;

function phase(): { ready: boolean; kbps: number } {
  const t = (((Date.now() - t0) / 1000) * SPEED) % CYCLE;
  const row = TIMELINE.find(([a, b]) => t >= a && t < b)!;
  if (row[2] === 'none') return { ready: false, kbps: 0 };
  const jitter = 1 + Math.sin(t * 1.7) * 0.08 + Math.sin(t * 0.31) * 0.05;
  return { ready: true, kbps: row[3] * jitter };
}

// Pretend to be the mediamtx control API.
const fake = createServer((req, res) => {
  const now = Date.now();
  const { ready, kbps } = phase();
  if (ready && !wasReady) bytes = 0; // new publisher, counter resets
  wasReady = ready;
  if (ready) bytes += ((kbps * 1000) / 8) * ((now - lastT) / 1000);
  lastT = now;
  if (req.url === `/v3/paths/get/${PATH_NAME}` && ready) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: PATH_NAME, ready: true, source: { type: 'srtConn' }, tracks: ['H264', 'MPEG-4 Audio'], inboundBytes: Math.round(bytes) }));
  } else {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"path not found"}');
  }
});
fake.listen(9997, '127.0.0.1');

Object.assign(process.env, {
  KEEL_OBS_URL: 'ws://127.0.0.1:4455',
  KEEL_OBS_PASSWORD: 'dev-obs',
  KEEL_MEDIAMTX_API: 'http://127.0.0.1:9997',
  KEEL_INGEST_PATH: PATH_NAME,
  KEEL_API_TOKEN: 'dev',
  KEEL_RTMP_URL: 'rtmp://example.invalid/app',
  KEEL_STREAM_KEY: 'dev',
  KEEL_DATA_DIR: process.env.KEEL_DATA_DIR ?? './data-dev',
  KEEL_RECOVER_S: String(Math.max(2, Math.round(5 / SPEED))),
  KEEL_DEGRADE_OFFLINE_S: String(Math.max(1, Math.round(2 / SPEED))),
  KEEL_DEGRADE_LOW_S: String(Math.max(1, Math.round(3 / SPEED))),
  KEEL_PUBLIC_HOST: 'stream.example.com',
});

console.log(`dev mock running. Dashboard: http://localhost:8080  token: dev  (speed x${SPEED})`);
await import('../src/main.ts');
