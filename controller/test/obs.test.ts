import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ObsClient, obsAuth, ObsRequestError } from '../src/obs.ts';
import { MockObs } from '../tools/mock-obs.ts';

test('obsAuth implements secret = b64(sha256(pw+salt)), auth = b64(sha256(secret+challenge))', () => {
  // Expected value computed with Python hashlib, independent of this code. It checks our
  // implementation of the algorithm, not that the algorithm matches real OBS: that is
  // covered by the Docker end-to-end test against a real OBS (docs/TESTING.md).
  const out = obsAuth('supersecretpassword33', 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=');
  assert.equal(out, 'ciDWYZ5UMzw2ZLFfY1QtOPECWYyMkOtaxHC/YlLWVD4=');
});

test('connects without a password', async () => {
  const mock = new MockObs({ port: 0 });
  const c = new ObsClient(`ws://127.0.0.1:${mock.port}`, '');
  c.connect();
  await once(c, 'connected');
  assert.equal(await c.getScene(), 'Scene');
  c.close();
  await mock.close();
});

test('connects with the right password and is rejected with the wrong one', async () => {
  const mock = new MockObs({ port: 0, password: 'hunter2' });
  const good = new ObsClient(`ws://127.0.0.1:${mock.port}`, 'hunter2');
  good.connect();
  await once(good, 'connected');
  good.close();

  const bad = new ObsClient(`ws://127.0.0.1:${mock.port}`, 'nope');
  bad.connect();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(bad.connected, false);
  bad.close();
  await mock.close();
});

test('requests surface error codes', async () => {
  const mock = new MockObs({ port: 0 });
  const c = new ObsClient(`ws://127.0.0.1:${mock.port}`, '');
  c.connect();
  await once(c, 'connected');
  await assert.rejects(c.setScene('Nope'), (e: unknown) => e instanceof ObsRequestError && e.code === 600);
  c.close();
  await mock.close();
});

test('emits scene change events and survives a dropped connection', async () => {
  const mock = new MockObs({ port: 0 });
  mock.scenes.push('A');
  const c = new ObsClient(`ws://127.0.0.1:${mock.port}`, '');
  c.connect();
  await once(c, 'connected');
  const ev = once(c, 'obs-event');
  await c.setScene('A');
  const [type, data] = await ev;
  assert.equal(type, 'CurrentProgramSceneChanged');
  assert.equal(data.sceneName, 'A');

  mock.dropClients();
  await once(c, 'disconnected');
  await once(c, 'connected'); // auto reconnect
  assert.equal(await c.getScene(), 'A');
  c.close();
  await mock.close();
});

test('requests fail fast when not connected', async () => {
  const c = new ObsClient('ws://127.0.0.1:1', '');
  await assert.rejects(c.getScene(), /not connected/);
});
