import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { open } from '../src/db.ts';
import { service } from '../src/service.ts';
import { mockProvider, hetznerProvider } from '../src/providers.ts';
import { verifyStripe } from '../src/stripe.ts';
import { api } from '../src/api.ts';
import { cloudInit } from '../src/cloudinit.ts';

const cfg = { repo: 'https://example.com/keel.git', ref: 'main', baseUrl: 'https://p.test', idleMinutes: 15, maxServersPerHour: 2 };
const setup = () => { const db = open(':memory:'); const prov = mockProvider(); return { db, prov, svc: service(db, prov, cfg) }; };
const stream = { destinations: [{ name: 'Twitch', url: 'rtmp://live.twitch.tv/app/live_x' }] };

test('tenant lifecycle: start, idle webhook stops it, usage is metered', async () => {
  const { svc, prov, db } = setup();
  const { id, token } = svc.createTenant('A', 'a@x.com');
  assert.equal(svc.byToken(token)?.id, id);
  const s = await svc.start(id, stream);
  assert.equal(s.state, 'booting'); assert.equal(prov.servers.size, 1);
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
  const s = cloudInit({ repo: "x'; rm -rf / #", ref: 'main', apiToken: 'a', obsPassword: 'b', ingestPath: 'live/c', publicHost: 'h', destinations: 'T=rtmp://x/y', idleWebhook: 'w', idleMinutes: 15 });
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
test('a server stuck in error with a provider id can still be stopped', async () => {
  const { svc, prov, db } = setup(); const t = svc.createTenant('A', 'a@x.com');
  await svc.start(t.id, stream); assert.equal(prov.servers.size, 1);
  db.prepare("UPDATE servers SET state='error', error='destroy failed' WHERE tenant_id=?").run(t.id);
  const s = await svc.stop(t.id); assert.equal(s.state, 'stopped'); assert.equal(prov.servers.size, 0);
});
test('http api: bad JSON is 400, unsafe stream keys are refused, stripe customer is linked', async () => {
  const { svc, prov } = setup(); const srv = api(svc, { adminToken: 'admin' }); await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`; const admin = { authorization: 'Bearer admin' };
  assert.equal((await fetch(base + '/v1/admin/tenants', { method: 'POST', headers: admin, body: '{nope' })).status, 400);
  const r = await fetch(base + '/v1/admin/tenants', { method: 'POST', headers: admin, body: JSON.stringify({ name: 'A', email: 'a@x.com', stripeCustomer: 'cus_9' }) });
  const { id, token } = await r.json() as any;
  assert.equal(svc.setStatus('cus_9', 'suspended'), true); svc.setStatus('cus_9', 'active');
  const start = (k: string) => fetch(base + '/v1/server/start', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ rtmpUrl: 'rtmp://live.twitch.tv/app', streamKey: k }) });
  const raw = (b: unknown) => fetch(base + '/v1/server/start', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(b) });
  assert.equal((await raw({ destinations: [{ name: 'A;B', url: 'rtmp://x/y/k' }] })).status, 400);
  assert.equal((await raw({ destinations: [{ name: 'A', url: 'rtmp://x/y/k;Evil=rtmp://e/f' }] })).status, 400);
  assert.equal((await start('live_x\nKEEL_API_TOKEN=owned')).status, 400);
  assert.equal((await start("live_x'")).status, 400);
  assert.equal(prov.servers.size, 0);
  assert.equal((await start('live_123_abc')).status, 200); assert.equal(svc.server(id).state, 'booting');
  srv.close();
});

import { cloudflareDns, sslipHost } from '../src/dns.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('tenant gets the dashboard URL, token and phone URLs; the server becomes running only once healthy', async () => {
  const db = open(':memory:'); const prov = mockProvider(); let healthy = false;
  const f = (async (u: string) => { assert.match(u, /^https:\/\/10-0-0-1\.sslip\.io\/healthz$/); if (!healthy) throw new Error('refused'); return new Response('ok'); }) as any;
  const svc = service(db, prov, cfg, { fetchImpl: f });
  const t = svc.createTenant('A', 'a@x.com');
  await svc.start(t.id, { destinations: [{ name: 'Twitch', url: 'rtmp://live.twitch.tv/app/k1' }, { name: 'Kick', url: 'rtmps://kick/app/k2' }] });
  const ud = [...prov.servers.values()][0]!.userData;
  assert.match(ud, /KEEL_DESTINATIONS=Twitch=rtmp:\/\/live.twitch.tv\/app\/k1;Kick=rtmps:\/\/kick\/app\/k2/);
  assert.match(ud, /__KEEL_AUTO_HOST__/); assert.match(ud, /sslip\.io/); assert.match(ud, /KEEL_DASHBOARD_BIND=127.0.0.1/);
  const a = svc.access(t.id)!;
  assert.equal(a.dashboardUrl, 'https://10-0-0-1.sslip.io');
  assert.match(a.dashboardToken, /^ks_/);
  assert.match(a.ingest.primary.srt, /^srt:\/\/10-0-0-1\.sslip\.io:8890\?streamid=publish:live\//);
  assert.match(a.ingest.backup.srt, /-backup$/);
  await svc.tick(); assert.equal(svc.server(t.id).state, 'booting');
  healthy = true; await svc.tick(); assert.equal(svc.server(t.id).state, 'running');
  await svc.stop(t.id); assert.equal(svc.access(t.id), null, 'credentials are cleared on stop');
});

test('a server that never becomes healthy is destroyed after the boot timeout', async () => {
  const db = open(':memory:'); const prov = mockProvider();
  const svc = service(db, prov, { ...cfg, bootTimeoutMin: 1 }, { fetchImpl: (async () => { throw new Error('down'); }) as any });
  const t = svc.createTenant('A', 'a@x.com'); await svc.start(t.id, stream);
  db.prepare('UPDATE servers SET started=started-120 WHERE tenant_id=?').run(t.id);
  await svc.tick();
  assert.equal(prov.servers.size, 0); assert.equal(svc.server(t.id).state, 'error'); assert.match(svc.server(t.id).error ?? '', /did not come up/);
});

test('orphan sweeper removes unknown keel servers after the grace period, never known ones', async () => {
  const { svc, prov } = setup(); const t = svc.createTenant('A', 'a@x.com'); await svc.start(t.id, stream);
  const orphan = await prov.create({ name: 'keel-lost', userData: '', labels: { keel: '1' } });
  await prov.create({ name: 'someone-else', userData: '' });
  assert.deepEqual(await svc.sweep(3600), [], 'too young');
  prov.servers.get(orphan.id)!.created -= 7200;
  assert.deepEqual(await svc.sweep(3600), [orphan.id]);
  assert.equal(prov.servers.size, 2, 'tenant server and unlabelled server survive');
});

test('stripe suspension also stops a running server', async () => {
  const { svc, prov } = setup(); const t = svc.createTenant('A', 'a@x.com', 'pro', 'cus_7');
  await svc.start(t.id, stream); assert.equal(prov.servers.size, 1);
  await svc.suspend('cus_7');
  assert.equal(prov.servers.size, 0); assert.equal(svc.byId(t.id)!.status, 'suspended');
});

test('cloudflare DNS: planned host, create then update then delete', async () => {
  const calls: string[] = []; let exists = false;
  const f = (async (u: string, i: any = {}) => {
    calls.push(i.method ?? 'GET');
    if (!i.method) return new Response(JSON.stringify({ result: exists ? [{ id: 'r1' }] : [] }));
    if (i.method === 'POST') exists = true;
    if (i.method === 'DELETE') exists = false;
    return new Response('{}');
  }) as any;
  const d = cloudflareDns({ token: 'T', zoneId: 'Z', domain: 'streams.example.com', fetchImpl: f });
  assert.equal(d.plannedHost('abcdef12-3456'), 'abcdef12.streams.example.com');
  await d.upsert('abcdef12.streams.example.com', '1.2.3.4');
  await d.upsert('abcdef12.streams.example.com', '1.2.3.5');
  await d.remove('abcdef12.streams.example.com');
  assert.deepEqual(calls, ['GET', 'POST', 'GET', 'PUT', 'GET', 'DELETE']);
  assert.equal(sslipHost('203.0.113.7'), '203-0-113-7.sslip.io');
});

test('a database from an older version is migrated in place', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'keel-db-')), 'p.db');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE servers (tenant_id TEXT PRIMARY KEY, provider_id TEXT, ip TEXT, state TEXT NOT NULL DEFAULT 'none', started INTEGER, updated INTEGER NOT NULL, error TEXT, api_token TEXT)");
  old.close();
  const db = open(file);
  const cols = (db.prepare('PRAGMA table_info(servers)').all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('host') && cols.includes('ingest_path'));
});
