import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keel } from '../src/keel.ts';
import { ObsClient } from '../src/obs.ts';
import { Stats } from '../src/stats.ts';
import { loadConfig } from '../src/config.ts';
import type { IngestSample } from '../src/ingest.ts';
import { MockObs } from '../tools/mock-obs.ts';

class FakeIngest extends EventEmitter {
  last: IngestSample = { t: 0, ready: false, kbps: 0, apiError: false, source: null, tracks: [] };
  push(t: number, kbps: number, ready = true) {
    this.last = { t, ready, kbps, apiError: false, source: 'srtConn', tracks: ['H264'] };
    this.emit('sample', this.last);
  }
}

async function setup(env: Record<string, string> = {}) {
  const mock = new MockObs({ port: 0 });
  const cfg = loadConfig({
    KEEL_OUTPUT_MODE: 'direct',
    KEEL_BACKUP_INGEST_PATH: 'off',
    KEEL_OBS_URL: `ws://127.0.0.1:${mock.port}`,
    KEEL_INGEST_PATH: 'live/test',
    KEEL_RTMP_URL: 'rtmp://sink/app',
    KEEL_STREAM_KEY: 'k',
    KEEL_DATA_DIR: '',
    ...env,
  } as NodeJS.ProcessEnv);
  const obs = new ObsClient(cfg.obsUrl, '');
  const ingest = new FakeIngest();
  const stats = new Stats(mkdtempSync(join(tmpdir(), 'keel-')));
  const keel = new Keel(cfg, obs as any, ingest as any, stats);
  keel.start();
  obs.connect();
  await once(obs, 'connected');
  // wait until bootstrap finishes (synced)
  for (let i = 0; i < 100 && !keel.synced; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(keel.synced, 'keel should sync with OBS');
  const done = async () => {
    keel.stop();
    obs.close();
    await mock.close();
  };
  return { mock, keel, ingest, stats, obs, cfg, done };
}

/** Push one sample per second (simulated clock) and wait for async scene switches to land. */
async function feed(ingest: FakeIngest, from: number, seconds: number, kbps: number, ready = true) {
  for (let i = 0; i <= seconds; i++) ingest.push((from + i) * 1000, kbps, ready);
  await new Promise((r) => setTimeout(r, 60));
}

test('bootstrap creates the scenes, inputs and stream service, and starts on BRB', async () => {
  const { mock, done } = await setup();
  assert.deepEqual(mock.scenes.sort(), ['BRB', 'LIVE', 'LOW SIGNAL', 'Scene'].sort());
  assert.ok(mock.inputs.has('Keel Ingest'));
  assert.ok(mock.inputs.has('Keel BRB Screen'));
  assert.equal(mock.streamService.streamServiceSettings.server, 'rtmp://sink/app');
  assert.equal(mock.currentScene, 'BRB');
  const ingestCall = mock.log.find((l) => l.type === 'CreateInput' && l.data.inputName === 'Keel Ingest');
  assert.equal(ingestCall?.data.inputSettings.input, 'rtmp://mediamtx:1935/live/test');
  await done();
});

test('bootstrap is idempotent on a second run', async () => {
  const { mock, keel, obs, done } = await setup();
  const before = mock.scenes.length;
  mock.dropClients();
  await once(obs, 'connected');
  for (let i = 0; i < 100 && !keel.synced; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(mock.scenes.length, before);
  await done();
});

test('auto mode: feed up -> LIVE, drop -> BRB, return -> LIVE', async () => {
  const { mock, keel, ingest, done } = await setup();
  await feed(ingest, 0, 8, 4000);
  assert.equal(mock.currentScene, 'LIVE');
  await feed(ingest, 9, 3, 0, false);
  assert.equal(mock.currentScene, 'BRB');
  await feed(ingest, 13, 8, 4000);
  assert.equal(mock.currentScene, 'LIVE');
  assert.equal(keel.signal, 'live');
  await done();
});

test('low bitrate switches to LOW SIGNAL', async () => {
  const { mock, ingest, done } = await setup();
  await feed(ingest, 0, 8, 4000);
  await feed(ingest, 9, 5, 300);
  assert.equal(mock.currentScene, 'LOW SIGNAL');
  await done();
});

test('manual scene change turns auto off and sticks through a drop', async () => {
  const { mock, keel, ingest, done } = await setup();
  await feed(ingest, 0, 8, 4000);
  await keel.setScene('live');
  assert.equal(keel.mode, 'manual');
  await feed(ingest, 9, 5, 0, false);
  assert.equal(mock.currentScene, 'LIVE', 'manual mode must not auto switch');
  await keel.setAuto();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(mock.currentScene, 'BRB', 'resuming auto applies the current signal');
  await done();
});

test('stream start and stop work, and an unexpected stop is recorded', async () => {
  const { mock, keel, stats, done } = await setup();
  await keel.startStream();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(keel.streaming, true);
  await keel.stopStream();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(keel.streaming, false);
  assert.equal(stats.summary().streamUnexpectedStops, 0);

  await keel.startStream();
  await new Promise((r) => setTimeout(r, 60));
  mock.setStreaming(false); // OBS stopped without us asking
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(stats.summary().streamUnexpectedStops, 1);
  await done();
});

test('startStream without a destination fails with a clear message', async () => {
  const { keel, cfg, done } = await setup();
  (cfg as any).rtmpUrl = '';
  (cfg as any).destinations = [];
  await assert.rejects(keel.startStream(), /KEEL_RTMP_URL/);
  await done();
});

test('stats count drops and offline time', async () => {
  const { ingest, stats, done } = await setup();
  await feed(ingest, 0, 8, 4000);
  await feed(ingest, 9, 4, 0, false);
  await feed(ingest, 14, 8, 4000);
  const s = stats.summary();
  assert.equal(s.drops >= 1, true);
  await done();
});

test('status exposes ingest URLs and the shape the dashboard needs', async () => {
  const { keel, done } = await setup();
  const st = keel.status() as any;
  assert.equal(st.urls.rtmp, 'rtmp://localhost:1935/live/test');
  assert.equal(st.urls.srt, 'srt://localhost:8890?streamid=publish:live/test');
  for (const k of ['obs', 'ingest', 'mode', 'summary', 'events', 'scenes']) assert.ok(k in st, k);
  await done();
});

test('idle event fires after the configured quiet period', async () => {
  const mock = new MockObs({ port: 0 });
  const cfg = loadConfig({ KEEL_OBS_URL: `ws://127.0.0.1:${mock.port}`, KEEL_IDLE_MINUTES: '1' } as NodeJS.ProcessEnv);
  const obs = new ObsClient(cfg.obsUrl, '');
  const ingest = new FakeIngest();
  let clock = 0;
  const keel = new Keel(cfg, obs as any, ingest as any, new Stats(null), () => clock);
  let fired = 0;
  keel.on('idle', () => fired++);
  (keel as any).checkIdle();
  assert.equal(fired, 0);
  clock = 61_000;
  (keel as any).checkIdle();
  assert.equal(fired, 1);
  (keel as any).checkIdle();
  assert.equal(fired, 1, 'fires once');
  keel.touch();
  clock += 61_000;
  (keel as any).checkIdle();
  assert.equal(fired, 2, 'fires again after activity');
  await mock.close();
});
