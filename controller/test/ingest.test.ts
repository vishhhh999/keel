import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IngestMonitor } from '../src/ingest.ts';

function fakeFetch(responses: Array<{ status?: number; body?: object } | Error>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
}

const mon = (responses: Parameters<typeof fakeFetch>[0]) =>
  new IngestMonitor({ apiUrl: 'http://x', path: 'live/k', intervalMs: 1000, windowS: 2 }, fakeFetch(responses));

test('computes kbps from the byte counter', async () => {
  const m = mon([
    { body: { ready: true, inboundBytes: 0 } },
    { body: { ready: true, inboundBytes: 500_000 } }, // 4 Mbit in 1s
    { body: { ready: true, inboundBytes: 1_000_000 } },
  ]);
  await m.poll(0);
  const a = await m.poll(1000);
  assert.equal(Math.round(a.kbps), 4000);
  const b = await m.poll(2000);
  assert.equal(Math.round(b.kbps), 4000);
});

test('accepts the older bytesReceived field name', async () => {
  const m = mon([{ body: { ready: true, bytesReceived: 0 } }, { body: { ready: true, bytesReceived: 250_000 } }]);
  await m.poll(0);
  assert.equal(Math.round((await m.poll(1000)).kbps), 2000);
});

test('a stalled feed decays to zero within the window', async () => {
  const m = mon([
    { body: { ready: true, inboundBytes: 0 } },
    { body: { ready: true, inboundBytes: 500_000 } },
    { body: { ready: true, inboundBytes: 500_000 } },
    { body: { ready: true, inboundBytes: 500_000 } },
  ]);
  await m.poll(0);
  await m.poll(1000);
  assert.ok((await m.poll(2000)).kbps < 2500);
  assert.equal((await m.poll(3000)).kbps, 0);
});

test('404 means no publisher, not an API error', async () => {
  const m = mon([{ status: 404 }]);
  const s = await m.poll(0);
  assert.equal(s.ready, false);
  assert.equal(s.apiError, false);
});

test('network failure is reported as apiError and not ready', async () => {
  const m = mon([new Error('ECONNREFUSED')]);
  const s = await m.poll(0);
  assert.equal(s.ready, false);
  assert.equal(s.apiError, true);
});

test('a counter reset (new publisher) does not produce a negative bitrate', async () => {
  const m = mon([
    { body: { ready: true, inboundBytes: 9_000_000 } },
    { body: { ready: true, inboundBytes: 9_500_000 } },
    { body: { ready: true, inboundBytes: 1000 } },
    { body: { ready: true, inboundBytes: 501_000 } },
  ]);
  await m.poll(0);
  await m.poll(1000);
  const reset = await m.poll(2000);
  assert.equal(reset.kbps, 0);
  const after = await m.poll(3000);
  assert.equal(Math.round(after.kbps), 4000);
});

test('reports source and tracks', async () => {
  const m = mon([{ body: { ready: true, inboundBytes: 1, source: { type: 'srtConn' }, tracks: ['H264', 'MPEG-4 Audio'] } }]);
  const s = await m.poll(0);
  assert.equal(s.source, 'srtConn');
  assert.deepEqual(s.tracks, ['H264', 'MPEG-4 Audio']);
});
