import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { open } from '../src/db.ts';
import { service } from '../src/service.ts';
import { mockProvider, hetznerProvider } from '../src/providers.ts';
import { verifyStripe } from '../src/stripe.ts';
import { api } from '../src/api.ts';
import { cloudInit } from '../src/cloudinit.ts';

const cfg = { repo: 'https://example.com/keel.git', ref: 'main', baseUrl: 'https://p.test', domain: 's.test', idleMinutes: 15, maxServersPerHour: 2 };
const setup = () => { const db = open(':memory:'); const prov = mockProvider(); return { db, prov, svc: service(db, prov, cfg) }; };
const stream = { rtmpUrl: 'rtmp://live.twitch.tv/app', streamKey: 'live_x' };

test('tenant lifecycle: start, idle webhook stops it, usage is metered', async () => {
  const { svc, prov, db } = setup();
  const { id, token } = svc.createTenant('A', 'a@x.com');
  assert.equal(svc.byToken(token)?.id, id);
  const s = await svc.start(id, stream);
  assert.equal(s.state, 'running'); assert.equal(prov.servers.size, 1);
  const ud = [...prov.servers.values()][0].userData;
  assert.match(ud, /KEEL_IDLE_ACTION=webhook/); assert.match(ud, new RegExp(`/v1/hooks/idle/${id}/`));
  db.prepare('UPDATE servers SET started=started-3600 WHERE tenant_id=?').run(id);
  const secret = (svc.byId(id) as any).hook_secret;
  assert.equal(await svc.idle(id, 'wrong'), false); assert.equal(prov.servers.size, 1);
  assert.equal(await svc.idle(id, secret), true);
  assert.equal(prov.servers.size, 0); assert.equal(svc.server(id).state, 'stopped');
  assert.ok(svc.usage(id).hours >= 1);
});
test('start is idempotent and rate limited', async () => {
  const { svc, prov } = setup();
  const a = svc.createTenant('A', 'a@x.com'), b = svc.createTenant('B', 'b@x.com'), c = svc.createTenant('C', 'c@x.com');
  await svc.start(a.id, stream); await svc.start(a.id, stream); assert.equal(prov.servers.size, 1);
  await svc.start(b.id, stream);
  await assert.rejects(svc.start(c.id, stream), /rate limit/);
});
test('suspended tenant cannot start', async () => {
  const { svc, db } = setup(); const t = svc.createTenant('A', 'a@x.com');
  db.prepare("UPDATE tenants SET stripe_customer='cus_1' WHERE id=?").run(t.id);
  assert.equal(svc.setStatus('cus_1', 'suspended'), true);
  await assert.rejects(svc.start(t.id, stream), /not active/);
});
test('provider failure is recorded, not thrown', async () => {
  const db = open(':memory:'); const bad = { name: 'bad', create: async () => { throw new Error('quota'); }, destroy: async () => {} };
  const svc = service(db, bad, cfg); const t = svc.createTenant('A', 'a@x.com');
  const s = await svc.start(t.id, stream); assert.equal(s.state, 'error'); assert.equal(s.error, 'quota');
});
test('stripe signature', () => {
  const secret = 'whsec_x', payload = '{"a":1}', t = 1_700_000_000;
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  assert.equal(verifyStripe(payload, `t=${t},v1=${sig}`, secret, 300, t + 10), true);
  assert.equal(verifyStripe(payload, `t=${t},v1=${sig}`, secret, 300, t + 1000), false);
  assert.equal(verifyStripe(payload + ' ', `t=${t},v1=${sig}`, secret, 300, t), false);
});
test('hetzner adapter shapes the request', async () => {
  let seen: any;
  const f = (async (u: string, i: any) => { seen = { u, i }; return { ok: true, status: 201, json: async () => ({ server: { id: 42, public_net: { ipv4: { ip: '1.2.3.4' } } } }), text: async () => '' }; }) as any;
  const p = hetznerProvider({ token: 'T', fetchImpl: f });
  assert.deepEqual(await p.create({ name: 'n', userData: 'ud' }), { id: '42', ip: '1.2.3.4' });
  assert.equal(seen.u, 'https://api.hetzner.cloud/v1/servers'); assert.equal(JSON.parse(seen.i.body).user_data, 'ud');
});
test('cloud-init contains no unquoted repo injection', () => {
  const s = cloudInit({ repo: "x'; rm -rf / #", ref: 'main', apiToken: 'a', obsPassword: 'b', ingestPath: 'live/c', publicHost: 'h', rtmpUrl: 'r', streamKey: 'k', idleWebhook: 'w', idleMinutes: 15 });
  assert.ok(s.includes(`'x'\\''; rm -rf / #'`));
});
test('http api: auth, create tenant, me', async () => {
  const { svc } = setup(); const srv = api(svc, { adminToken: 'admin' }); await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  assert.equal((await fetch(base + '/v1/admin/tenants', { method: 'POST', body: '{}' })).status, 401);
  const r = await fetch(base + '/v1/admin/tenants', { method: 'POST', headers: { authorization: 'Bearer admin' }, body: JSON.stringify({ name: 'A', email: 'a@x.com' }) });
  assert.equal(r.status, 201); const { token } = await r.json() as any;
  const me = await (await fetch(base + '/v1/me', { headers: { authorization: 'Bearer ' + token } })).json() as any;
  assert.equal(me.server.state, 'none');
  assert.equal((await fetch(base + '/v1/me', { headers: { authorization: 'Bearer nope' } })).status, 401);
  srv.close();
});
