import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, describe, formatKbps, normalizeUrl, parseShareLink } from '../src/model.ts';
import { KeelClient } from '../src/client.ts';

test('describe maps states to words and tilt', () => {
  assert.deepEqual(describe({ ingest: { state: 'live', kbps: 4200.4, ready: true } }).word, 'Live.');
  assert.equal(describe({ ingest: { state: 'low', kbps: 400, ready: true } }).tilt, 12);
  assert.equal(describe({ ingest: { state: 'offline', kbps: -5, ready: false } }).kbps, 0);
});
test('formatKbps', () => { assert.equal(formatKbps(5400), '5.4 Mbps'); assert.equal(formatKbps(485.2), '485 kbps'); });
test('normalizeUrl', () => {
  assert.equal(normalizeUrl('keel.example.com/'), 'https://keel.example.com');
  assert.equal(normalizeUrl('http://1.2.3.4:8080/x'), 'http://1.2.3.4:8080');
  assert.equal(normalizeUrl('  '), null);
});
test('parseShareLink', () => {
  assert.deepEqual(parseShareLink('keel://connect?url=keel.example.com&token=abc'), { url: 'https://keel.example.com', token: 'abc' });
  assert.equal(parseShareLink('https://nope'), null);
  assert.equal(parseShareLink('keel://connect?url=x.com'), null);
});
test('backoff caps at 15s', () => { assert.equal(backoffMs(0), 1000); assert.equal(backoffMs(3), 8000); assert.equal(backoffMs(10), 15000); });
test('client sends bearer token and maps 401', async () => {
  let seen: any;
  const ok = (async (u: any, init: any) => { seen = { u, init }; return { ok: true, status: 200, json: async () => ({ message: 'ok' }) }; }) as any;
  const c = new KeelClient('https://h', 'tok', ok);
  await c.setScene('brb');
  assert.equal(seen.u, 'https://h/api/scene'); assert.equal(seen.init.headers.authorization, 'Bearer tok'); assert.equal(seen.init.body, '{"scene":"brb"}');
  const bad = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as any;
  await assert.rejects(new KeelClient('https://h', 'x', bad).status(), /Wrong token/);
});
import { linkChips, onAir } from '../src/model.ts';
test('link chips grade RTT, loss and drops; RTMP has none', () => {
  const c = linkChips({ rttMs: 312.4, lossPct: 1.2, dropPct: 3.1 });
  assert.deepEqual(c.map((x) => [x.label, x.value, x.level]), [['RTT', '312 ms', 'warn'], ['Loss', '1.2%', ''], ['Dropped', '3.1%', 'bad']]);
  assert.deepEqual(linkChips(null), []);
});
test('onAir prefers the relay view and falls back to OBS for older servers', () => {
  assert.equal(onAir({ obs: { connected: true, scene: null, streaming: false }, broadcast: { output: 'relay', wanted: true, onAir: true, shield: true, autoRestarts: 0, destinations: [] } }), true);
  assert.equal(onAir({ obs: { connected: true, scene: null, streaming: true } }), true);
});
test('client: source pin, destination toggle and 403 for moderators', async () => {
  let seen: any;
  const ok = (async (u: any, init: any) => { seen = { u, body: init.body }; return { ok: true, status: 200, json: async () => ({ message: 'ok' }) }; }) as any;
  const c = new KeelClient('https://h', 'tok', ok);
  await c.setSource('backup'); assert.equal(seen.u, 'https://h/api/source'); assert.equal(seen.body, '{"source":"backup"}');
  await c.setDestination('kick', false); assert.equal(seen.body, '{"id":"kick","enabled":false}');
  const forbidden = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as any;
  await assert.rejects(new KeelClient('https://h', 'm', forbidden).stopStream(), /Only the streamer/);
});
