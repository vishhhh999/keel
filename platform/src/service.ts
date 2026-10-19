import { randomUUID } from 'node:crypto';
import type { DB, Tenant, ServerRow } from './db.ts';
import { sha, token } from './db.ts';
import type { Provider } from './providers.ts';
import { cloudInit } from './cloudinit.ts';

export interface Config { repo: string; ref: string; baseUrl: string; domain: string; idleMinutes: number; maxServersPerHour: number }
const now = () => Math.floor(Date.now() / 1000);

export function service(db: DB, provider: Provider, cfg: Config) {
  const audit = (tenant: string | null, event: string, detail = '') => db.prepare('INSERT INTO audit (t,tenant_id,event,detail) VALUES (?,?,?,?)').run(now(), tenant, event, detail);

  function createTenant(name: string, email: string, plan = 'trial') {
    const id = randomUUID(); const tk = token('kt'); const hook = token('kh');
    db.prepare('INSERT INTO tenants (id,name,email,plan,token_hash,hook_secret,created) VALUES (?,?,?,?,?,?,?)').run(id, name, email, plan, sha(tk), hook, now());
    db.prepare('INSERT INTO servers (tenant_id,state,updated) VALUES (?,?,?)').run(id, 'none', now());
    audit(id, 'tenant.create', email);
    return { id, token: tk };
  }
  const byToken = (tk: string) => db.prepare('SELECT * FROM tenants WHERE token_hash=?').get(sha(tk)) as unknown as Tenant | undefined;
  const byId = (id: string) => db.prepare('SELECT * FROM tenants WHERE id=?').get(id) as unknown as (Tenant & { hook_secret: string }) | undefined;
  const server = (id: string) => db.prepare('SELECT * FROM servers WHERE tenant_id=?').get(id) as unknown as ServerRow;

  async function start(tenantId: string, stream: { rtmpUrl: string; streamKey: string }) {
    const t = byId(tenantId); if (!t) throw new Error('no such tenant');
    if (t.status !== 'active') throw new Error('Account is not active.');
    const cur = server(tenantId);
    if (cur.state === 'running' || cur.state === 'provisioning') return cur;
    const recent = (db.prepare("SELECT COUNT(*) c FROM audit WHERE event='server.start' AND t > ?").get(now() - 3600) as any).c as number;
    if (recent >= cfg.maxServersPerHour) throw new Error('Provisioning rate limit reached. Try again soon.');
    const apiToken = token('ks'), obs = token('ko'), ingest = 'live/' + token('k').slice(2);
    db.prepare("UPDATE servers SET state='provisioning', updated=?, error=NULL, api_token=? WHERE tenant_id=?").run(now(), apiToken, tenantId);
    audit(tenantId, 'server.start');
    try {
      const host = `${tenantId.slice(0, 8)}.${cfg.domain}`;
      const p = await provider.create({ name: `keel-${tenantId.slice(0, 8)}`, userData: cloudInit({
        repo: cfg.repo, ref: cfg.ref, apiToken, obsPassword: obs, ingestPath: ingest, publicHost: host, rtmpUrl: stream.rtmpUrl, streamKey: stream.streamKey,
        idleWebhook: `${cfg.baseUrl}/v1/hooks/idle/${tenantId}/${t.hook_secret}`, idleMinutes: cfg.idleMinutes }) });
      db.prepare("UPDATE servers SET provider_id=?, ip=?, state='running', started=?, updated=? WHERE tenant_id=?").run(p.id, p.ip, now(), now(), tenantId);
    } catch (e) {
      db.prepare("UPDATE servers SET state='error', error=?, updated=? WHERE tenant_id=?").run((e as Error).message, now(), tenantId);
      audit(tenantId, 'server.error', (e as Error).message);
    }
    return server(tenantId);
  }

  async function stop(tenantId: string, reason = 'manual') {
    const s = server(tenantId);
    if (!s || s.state !== 'running' || !s.provider_id) return s;
    db.prepare("UPDATE servers SET state='stopping', updated=? WHERE tenant_id=?").run(now(), tenantId);
    try { await provider.destroy(s.provider_id); } catch (e) { db.prepare("UPDATE servers SET state='error', error=? WHERE tenant_id=?").run((e as Error).message, tenantId); audit(tenantId, 'server.error', (e as Error).message); return server(tenantId); }
    const end = now(); const started = s.started ?? end;
    db.prepare('INSERT INTO usage (tenant_id,started,ended,seconds) VALUES (?,?,?,?)').run(tenantId, started, end, end - started);
    db.prepare("UPDATE servers SET state='stopped', provider_id=NULL, ip=NULL, started=NULL, updated=? WHERE tenant_id=?").run(end, tenantId);
    audit(tenantId, 'server.stop', reason);
    return server(tenantId);
  }

  function usage(tenantId: string, sinceSec = now() - 30 * 86400) {
    const r = db.prepare('SELECT COALESCE(SUM(seconds),0) s, COUNT(*) n FROM usage WHERE tenant_id=? AND ended>=?').get(tenantId, sinceSec) as any;
    return { hours: +(r.s / 3600).toFixed(2), sessions: r.n as number };
  }
  async function idle(tenantId: string, secret: string) {
    const t = byId(tenantId); if (!t || t.hook_secret !== secret) return false;
    await stop(tenantId, 'idle'); return true;
  }
  function setStatus(customer: string, status: string) {
    const r = db.prepare('UPDATE tenants SET status=? WHERE stripe_customer=?').run(status, customer);
    return Number(r.changes) > 0;
  }
  return { createTenant, byToken, byId, server, start, stop, usage, idle, setStatus, audit };
}
export type Service = ReturnType<typeof service>;
