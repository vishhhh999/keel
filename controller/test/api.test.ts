import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keel } from '../src/keel.ts';
import { ObsClient } from '../src/obs.ts';
import { Stats } from '../src/stats.ts';
import { loadConfig } from '../src/config.ts';
import { createApi, metricsText } from '../src/api.ts';
import { MockObs } from '../tools/mock-obs.ts';

async function setup(token = 'secret') {
  const mock = new MockObs({ port: 0 });
  const cfg = loadConfig({ KEEL_OBS_URL: `ws://127.0.0.1:${mock.port}`, KEEL_RTMP_URL: 'rtmp://x/app' } as NodeJS.ProcessEnv);
  const obs = new ObsClient(cfg.obsUrl, '');
  const ingest: any = new EventEmitter();
  ingest.last = { t: 0, ready: false, kbps: 0, apiError: false, source: null, tracks: [] };
  const keel = new Keel(cfg, obs as any, ingest, new Stats(null));
  keel.start();
  obs.connect();
  await once(obs, 'connected');
  for (let i = 0; i < 100 && !keel.synced; i++) await new Promise((r) => setTimeout(r, 20));
  const pub = mkdtempSync(join(tmpdir(), 'keel-pub-'));
  writeFileSync(join(pub, 'index.html'), '<h1>dash</h1>');
  const server = createApi(keel, { token, publicDir: pub });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const done = async () => {
    server.closeAllConnections();
    server.close();
    keel.stop();
    obs.close();
    await mock.close();
  };
  return { base, keel, mock, done };
}

const auth = { authorization: 'Bearer secret' };

test('healthz is open, api requires the token', async () => {
  const { base, done } = await setup();
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  assert.equal((await fetch(`${base}/api/status`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/api/status`, { headers: auth })).status, 200);
  assert.equal((await fetch(`${base}/api/status?token=secret`)).status, 200);
  await done();
});

test('serves the dashboard and blocks path traversal', async () => {
  const { base, done } = await setup();
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /dash/);
  const raw = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
  assert.notEqual(raw.status, 200);
  await done();
});

test('scene, mode and stream endpoints drive OBS', async () => {
  const { base, mock, keel, done } = await setup();
  let r = await fetch(`${base}/api/scene`, { method: 'POST', headers: auth, body: JSON.stringify({ scene: 'live' }) });
  assert.equal(r.status, 200);
  assert.equal(mock.currentScene, 'LIVE');
  assert.equal(keel.mode, 'manual');

  r = await fetch(`${base}/api/scene`, { method: 'POST', headers: auth, body: JSON.stringify({ scene: 'nope' }) });
  assert.equal(r.status, 400);

  r = await fetch(`${base}/api/mode`, { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'auto' }) });
  assert.equal(r.status, 200);
  assert.equal(keel.mode, 'auto');

  r = await fetch(`${base}/api/stream/start`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(mock.streaming, true);
  r = await fetch(`${base}/api/stream/stop`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(r.status, 200);
  await done();
});

test('SSE stream delivers a status frame immediately', async () => {
  const { base, done } = await setup();
  const res = await fetch(`${base}/api/events?token=secret`);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /^data: \{/);
  assert.equal(JSON.parse(text.slice(6)).obs.connected, true);
  await reader.cancel();
  await done();
});

test('history endpoint returns the recent samples', async () => {
  const { base, keel, done } = await setup();
  keel.history.push({ t: 1, kbps: 4000, state: 'live', scene: 'LIVE', streaming: true });
  const r = await fetch(`${base}/api/history`, { headers: auth });
  const body = (await r.json()) as unknown[];
  assert.equal(r.status, 200);
  assert.equal(body.length, 1);
  await done();
});

test('metrics output is prometheus text', async () => {
  const { base, keel, done } = await setup();
  const r = await fetch(`${base}/metrics`, { headers: auth });
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /keel_ingest_kbps \d+/);
  assert.match(body, /keel_obs_connected 1/);
  assert.equal(body, metricsText(keel));
  await done();
});

test('oversized bodies are rejected', async () => {
  const { base, done } = await setup();
  const r = await fetch(`${base}/api/scene`, { method: 'POST', headers: auth, body: 'x'.repeat(10_000) });
  assert.equal(r.status, 500);
  await done();
});
