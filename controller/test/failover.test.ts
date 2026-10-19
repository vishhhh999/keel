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
import { Notifier } from '../src/notify.ts';
import { SettingsStore } from '../src/settings.ts';
import { IngestMonitor, type IngestSample } from '../src/ingest.ts';
import { Switcher } from '../src/switcher.ts';
import { MockObs } from '../tools/mock-obs.ts';

class FakeIngest extends EventEmitter {
  last: IngestSample = { t: 0, ready: false, kbps: 0, apiError: false, source: null, tracks: [] };
  push(t: number, kbps: number, ready = true) {
    this.last = { t, ready, kbps, apiError: false, source: 'srtConn', tracks: ['H264'] };
    this.emit('sample', this.last);
  }
}

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function setup(env: Record<string, string> = {}, extras: { notifier?: Notifier; dataDir?: string } = {}) {
  const mock = new MockObs({ port: 0 });
  const cfg = loadConfig({
    KEEL_OBS_URL: `ws://127.0.0.1:${mock.port}`,
    KEEL_INGEST_PATH: 'live/testkey',
    KEEL_RTMP_URL: 'rtmp://sink/app',
    KEEL_STREAM_KEY: 'k',
    KEEL_OUTPUT_MODE: 'direct',
    ...env,
  } as NodeJS.ProcessEnv);
  const obs = new ObsClient(cfg.obsUrl, '');
  const primary = new FakeIngest();
  const backup = new FakeIngest();
  const notifier = extras.notifier ?? null;
  const keel = new Keel(cfg, obs as any, [primary, backup] as any, new Stats(null), Date.now, { notifier, settings: extras.dataDir ? new SettingsStore(extras.dataDir) : null });
  keel.start();
  obs.connect();
  await once(obs, 'connected');
  for (let i = 0; i < 100 && !keel.synced; i++) await wait(20);
  /** Feed both sources one sample per simulated second. */
  const feed = async (from: number, secs: number, p: number | null, b: number | null) => {
    for (let i = 0; i <= secs; i++) {
      const t = (from + i) * 1000;
      primary.push(t, p ?? 0, p !== null);
      backup.push(t, b ?? 0, b !== null);
    }
    await wait();
  };
  const done = async () => {
    keel.stop();
    obs.close();
    await mock.close();
  };
  return { mock, keel, cfg, primary, backup, feed, done };
}

test('backup ingest is built into LIVE and LOW SIGNAL, hidden at start', async () => {
  const { mock, done } = await setup();
  assert.ok(mock.inputs.has('Keel Backup Ingest'));
  assert.equal(mock.visible('LIVE', 'Keel Ingest'), true);
  assert.equal(mock.visible('LIVE', 'Keel Backup Ingest'), false);
  assert.equal(mock.visible('LOW SIGNAL', 'Keel Backup Ingest'), false);
  const ingestCall = mock.log.find((l) => l.type === 'CreateInput' && l.data.inputName === 'Keel Backup Ingest');
  assert.equal(ingestCall?.data.inputSettings.input, 'rtmp://mediamtx:1935/live/testkey-backup');
  await done();
});

test('primary dies, backup is healthy: viewers stay LIVE on the backup, no drop is counted', async () => {
  const { mock, keel, feed, done } = await setup();
  await feed(0, 8, 4000, 3000);
  assert.equal(mock.currentScene, 'LIVE');
  assert.equal(keel.activeSource, 'primary');
  await feed(9, 4, null, 3000); // primary gone
  assert.equal(keel.activeSource, 'backup');
  assert.equal(mock.currentScene, 'LIVE', 'never went to BRB');
  assert.equal(mock.visible('LIVE', 'Keel Backup Ingest'), true);
  assert.equal(mock.visible('LIVE', 'Keel Ingest'), false);
  const st = keel.status() as any;
  assert.equal(st.summary.drops, 0);
  assert.equal(st.summary.failovers, 1);
  // primary comes back and holds healthy for the recovery time: return to it
  await feed(14, 8, 4000, 3000);
  assert.equal(keel.activeSource, 'primary');
  assert.equal(mock.visible('LIVE', 'Keel Ingest'), true);
  await done();
});

test('both sources dead: BRB; backup alone returns: LIVE on backup', async () => {
  const { mock, keel, feed, done } = await setup();
  await feed(0, 8, 4000, null);
  await feed(9, 4, null, null);
  assert.equal(mock.currentScene, 'BRB');
  await feed(14, 7, null, 3500);
  assert.equal(mock.currentScene, 'LIVE');
  assert.equal(keel.activeSource, 'backup');
  await done();
});

test('a pinned source is respected even when the other is healthier', async () => {
  const { keel, feed, done } = await setup();
  await feed(0, 8, 4000, 4000);
  await keel.setSource('backup');
  assert.equal(keel.activeSource, 'backup');
  await feed(9, 3, 4000, 4000);
  assert.equal(keel.activeSource, 'backup');
  await keel.setSource('auto');
  assert.equal(keel.activeSource, 'primary');
  await done();
});

test('with KEEL_BACKUP_INGEST_PATH=off there is one source and pinning backup is refused', async () => {
  const { keel, mock, done } = await setup({ KEEL_BACKUP_INGEST_PATH: 'off' });
  assert.equal(mock.inputs.has('Keel Backup Ingest'), false);
  await assert.rejects(keel.setSource('backup'), /No backup/);
  await done();
});

test('an unexpected broadcast stop is restarted automatically while the operator wants to be live', async () => {
  const { mock, keel, done } = await setup();
  await keel.startStream();
  await wait();
  mock.setStreaming(false); // platform connection died inside OBS
  await wait(1300); // first backoff is 1 s
  assert.equal(mock.streaming, true, 'Keel restarted the broadcast');
  assert.equal(keel.autoRestarts, 1);
  await keel.stopStream();
  await wait();
  assert.equal(mock.streaming, false);
  await done();
});

test('OBS crash: on reconnect Keel rebuilds and resumes the broadcast', async () => {
  const { mock, keel, done } = await setup();
  await keel.startStream();
  await wait();
  mock.streaming = false; // a fresh OBS process is not streaming
  mock.dropClients();
  for (let i = 0; i < 100 && !(keel.synced && mock.streaming); i++) await wait(30);
  assert.equal(mock.streaming, true);
  assert.equal(keel.wantLive, true);
  await done();
});

test('crew alerts: drop and recovery are sent once each while live, throttled per kind', async () => {
  const posts: any[] = [];
  const notifier = new Notifier('https://hooks.example/x', { fetchImpl: (async (_u: string, i: any) => { posts.push(JSON.parse(i.body)); return new Response('ok'); }) as any });
  const { keel, feed, done } = await setup({ KEEL_BACKUP_INGEST_PATH: 'off' }, { notifier });
  await feed(0, 8, 4000, null);
  await keel.startStream();
  await feed(9, 4, null, null);
  await feed(14, 8, 4000, null);
  await feed(23, 4, null, null); // second drop inside 30 s: throttled
  const texts = posts.map((p) => p.content);
  assert.equal(texts.filter((t) => /Signal lost/.test(t)).length, 1);
  assert.equal(texts.filter((t) => /Signal back after/.test(t)).length, 1);
  assert.ok(posts.every((p) => p.text === p.content), 'Slack and Discord fields both set');
  await done();
});

test('settings persist across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keel-set-'));
  const a = await setup({ KEEL_BACKUP_INGEST_PATH: 'off' }, { dataDir: dir });
  a.keel.updateSettings({ lowKbps: 1500, maxDropPct: 5 });
  await a.done();
  const b = await setup({ KEEL_BACKUP_INGEST_PATH: 'off' }, { dataDir: dir });
  assert.equal(b.cfg.thresholds.lowKbps, 1500);
  assert.equal(b.cfg.thresholds.maxDropPct, 5);
  assert.throws(() => b.keel.updateSettings({ offlineKbps: 2000 }), /below the weak/);
  await b.done();
});

test('switcher: dropped packets count as weak even at full bitrate; 0 disables', () => {
  const cfg = { lowKbps: 800, offlineKbps: 50, degradeLowS: 3, degradeOfflineS: 2, recoverS: 5, maxDropPct: 2, maxLossPct: 20 };
  const s = new Switcher(cfg);
  for (let t = 0; t <= 6; t++) s.update({ t: t * 1000, ready: true, kbps: 5000, dropPct: 0 });
  assert.equal(s.state, 'live');
  let reason = '';
  for (let t = 7; t <= 11; t++) {
    const d = s.update({ t: t * 1000, ready: true, kbps: 5000, dropPct: 6 });
    if (d.changed) reason = d.reason;
  }
  assert.equal(s.state, 'low');
  assert.match(reason, /dropped/);
  s.configure({ maxDropPct: 0 });
  for (let t = 12; t <= 18; t++) s.update({ t: t * 1000, ready: true, kbps: 5000, dropPct: 6 });
  assert.equal(s.state, 'live');
});

test('ingest monitor reads SRT RTT, loss and drops for its path', async () => {
  let n = 0;
  const f = (async (url: string) => {
    if (url.endsWith('/v3/srtconns/list')) {
      const k = n;
      return new Response(JSON.stringify({ items: [
        { path: 'live/other', state: 'publish', msRTT: 999 },
        { path: 'live/k', state: 'publish', msRTT: 84.2, packetsReceived: 1000 + k * 1000, packetsReceivedLoss: k * 50, packetsReceivedDrop: k * 10, msReceiveBuf: 1180, mbpsLinkCapacity: 31.5 },
      ] }));
    }
    n++;
    return new Response(JSON.stringify({ ready: true, inboundBytes: n * 500_000, source: { type: 'srtConn' }, tracks: ['H264'] }));
  }) as unknown as typeof fetch;
  const m = new IngestMonitor({ apiUrl: 'http://x', path: 'live/k', intervalMs: 1000, windowS: 2 }, f);
  await m.poll(0);
  const s = await m.poll(1000);
  assert.equal(s.link?.rttMs, 84.2);
  assert.equal(s.link?.bufferMs, 1180);
  assert.equal(s.link?.capacityMbps, 31.5);
  assert.equal(s.link?.lossPct, 4.8); // 50 lost of 1050 sent
  assert.equal(s.link?.dropPct, 1);   // 10 dropped of 1000 received
  assert.equal(s.dropPct, 1);
});

test('RTMP publishers have no link stats and that is fine', async () => {
  const f = (async () => new Response(JSON.stringify({ ready: true, inboundBytes: 10, source: { type: 'rtmpConn' } }))) as unknown as typeof fetch;
  const m = new IngestMonitor({ apiUrl: 'http://x', path: 'live/k', intervalMs: 1000, windowS: 2 }, f);
  const s = await m.poll(0);
  assert.equal(s.link, null);
});
