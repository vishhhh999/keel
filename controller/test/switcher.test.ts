import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Switcher, classify, type Sample } from '../src/switcher.ts';

const cfg = { lowKbps: 800, offlineKbps: 50, degradeLowS: 3, degradeOfflineS: 2, recoverS: 5 };
const s = (t: number, kbps: number, ready = true): Sample => ({ t: t * 1000, ready, kbps });

/** Feed one sample per second from t0 for `seconds`, return the final decision and every change. */
function run(sw: Switcher, from: number, seconds: number, kbps: number, ready = true) {
  const changes: { t: number; to: string }[] = [];
  let last = sw.update(s(from, kbps, ready));
  if (last.changed) changes.push({ t: from, to: last.state });
  for (let i = 1; i <= seconds; i++) {
    last = sw.update(s(from + i, kbps, ready));
    if (last.changed) changes.push({ t: from + i, to: last.state });
  }
  return { last, changes };
}

test('classify uses thresholds and publisher presence', () => {
  assert.equal(classify(s(0, 5000), cfg), 'live');
  assert.equal(classify(s(0, 500), cfg), 'low');
  assert.equal(classify(s(0, 10), cfg), 'offline');
  assert.equal(classify(s(0, 5000, false), cfg), 'offline');
});

test('starts offline and only goes live after sustained healthy bitrate', () => {
  const sw = new Switcher(cfg);
  const { changes } = run(sw, 0, 10, 4000);
  assert.deepEqual(changes, [{ t: 5, to: 'live' }]);
});

test('a feed that dies goes offline within the offline threshold', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  assert.equal(sw.state, 'live');
  const { changes } = run(sw, 11, 5, 0, false);
  assert.deepEqual(changes, [{ t: 13, to: 'offline' }]);
});

test('a 1 second hiccup does not trigger BRB', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  sw.update(s(11, 0, false));
  const d = sw.update(s(12, 4000));
  assert.equal(d.changed, false);
  assert.equal(sw.state, 'live');
});

test('sagging bitrate goes to low, not offline', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  const { changes } = run(sw, 11, 6, 400);
  assert.deepEqual(changes, [{ t: 14, to: 'low' }]);
});

test('low then collapse goes offline', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  run(sw, 11, 6, 400);
  const { changes } = run(sw, 17, 4, 0, false);
  assert.deepEqual(changes, [{ t: 19, to: 'offline' }]);
});

test('recovery is slow: needs recoverS seconds of healthy feed', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  run(sw, 11, 5, 0, false);
  assert.equal(sw.state, 'offline');
  const { changes } = run(sw, 17, 8, 4000);
  assert.deepEqual(changes, [{ t: 22, to: 'live' }]);
});

test('a flapping connection never reaches live', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  run(sw, 11, 5, 0, false);
  let t = 17;
  const changes: string[] = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 3; j++) {
      const d = sw.update(s(t++, 4000));
      if (d.changed) changes.push(d.state);
    }
    const d = sw.update(s(t++, 0, false));
    if (d.changed) changes.push(d.state);
  }
  assert.deepEqual(changes, []);
  assert.equal(sw.state, 'offline');
});

test('offline to low when the feed returns weak', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  run(sw, 11, 5, 0, false);
  const { changes } = run(sw, 17, 8, 400);
  assert.deepEqual(changes, [{ t: 22, to: 'low' }]);
});

test('low recovers to live after sustained healthy bitrate', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  run(sw, 11, 6, 400);
  assert.equal(sw.state, 'low');
  const { changes } = run(sw, 18, 8, 4000);
  assert.deepEqual(changes, [{ t: 23, to: 'live' }]);
});

test('reset puts the switcher in a known state and clears timers', () => {
  const sw = new Switcher(cfg);
  run(sw, 0, 10, 4000);
  sw.reset('offline');
  assert.equal(sw.state, 'offline');
  const { changes } = run(sw, 20, 8, 4000);
  assert.deepEqual(changes, [{ t: 25, to: 'live' }]);
});
