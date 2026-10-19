import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

test('KEEL_FPS reaches the controller so OBS and the bootstrap agree', () => {
  assert.equal(loadConfig({}).fps, 30);
  assert.equal(loadConfig({ KEEL_FPS: '60' }).fps, 60);
});

test('an unknown KEEL_IDLE_ACTION fails at start instead of silently doing nothing', () => {
  assert.equal(loadConfig({ KEEL_IDLE_ACTION: 'webhook' }).idle.action, 'webhook');
  assert.throws(() => loadConfig({ KEEL_IDLE_ACTION: 'shutdown' }), /KEEL_IDLE_ACTION/);
});
