import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Stats } from '../src/stats.ts';

test('summarises drops, offline time and stream uptime', () => {
  const s = new Stats(null, 0);
  s.stream('started', 0);
  s.signal('live', 'ok', 5_000);
  s.signal('offline', 'drop', 60_000);
  s.signal('live', 'back', 75_000); // 15s drop
  s.signal('offline', 'drop', 100_000);
  s.signal('low', 'weak', 130_000); // 30s drop
  s.stream('stopped', 200_000);
  const sum = s.summary(300_000);
  assert.equal(sum.drops, 2);
  assert.equal(sum.offlineSeconds, 45);
  assert.equal(sum.longestDropSeconds, 30);
  assert.equal(sum.streamSeconds, 200);
  assert.equal(sum.lowEvents, 1);
});

test('an ongoing drop counts up to now', () => {
  const s = new Stats(null, 0);
  s.signal('offline', 'drop', 10_000);
  assert.equal(s.summary(40_000).offlineSeconds, 30);
});

test('flags unexpected stream stops', () => {
  const s = new Stats(null, 0);
  s.stream('started', 0);
  s.stream('unexpected_stop', 5000);
  assert.equal(s.summary(10_000).streamUnexpectedStops, 1);
});

test('persists to disk and reloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keel-stats-'));
  const a = new Stats(dir, 0);
  a.signal('offline', 'drop', 1000);
  a.signal('live', 'back', 4000);
  const b = new Stats(dir, 0);
  assert.equal(b.summary(10_000).drops, 1);
  assert.equal(b.summary(10_000).offlineSeconds, 3);
});
