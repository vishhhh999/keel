import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { DB, Tenant, ServerRow } from './db.ts';
import { sha, token } from './db.ts';
import type { Provider } from './providers.ts';
import { cloudInit } from './cloudinit.ts';
import { sslipDns, type Dns } from './dns.ts';

export interface Config {
  repo: string;
  ref: string;
  baseUrl: string;
  idleMinutes: number;
  maxServersPerHour: number;
  /** Minutes a server may take to answer /healthz before it is marked failed and destroyed. */
  bootTimeoutMin?: number;
  imagePrefix?: string;
  imageTag?: string;
  /** Kept for older configs; the DNS adapter decides hostnames now. */
  domain?: string;
}
export interface DestinationInput { name: string; url: string }
export interface StartInput { destinations: DestinationInput[] }

const now = () => Math.floor(Date.now() / 1000);

export function service(db: DB, provider: Provider, cfg: Config, opts: { dns?: Dns; fetchImpl?: typeof fetch } = {}) {
  const dns = opts.dns ?? sslipDns();
  const f = opts.fetchImpl ?? fetch;
  const bootTimeout = (cfg.bootTimeoutMin ?? 15) * 60;
  const audit = (tenant: string | null, event: string, detail = '') => db.prepare('INSERT INTO audit (t,tenant_id,event,detail) VALUES (?,?,?,?)').run(now(), tenant, event, detail);

  function createTenant(name: string, email: string, plan = 'trial', stripeCustomer: string | null = null) {
    const id = randomUUID(); const tk = token('kt'); const hook = token('kh');
    db.prepare('INSERT INTO tenants (id,name,email,plan,stripe_customer,token_hash,hook_secret,created) VALUES (?,?,?,?,?,?,?,?)').run(id, name, email, plan, stripeCustomer, sha(tk), hook, now());
    db.prepare('INSERT INTO servers (tenant_id,state,updated) VALUES (?,?,?)').run(id, 'none', now());
    audit(id, 'tenant.create', email);
    return { id, token: tk };
  }
  const byToken = (tk: string) => db.prepare('SELECT * FROM tenants WHERE token_hash=?').get(sha(tk)) as unknown as Tenant | undefined;
  const byId = (id: string) => db.prepare('SELECT * FROM tenants WHERE id=?').get(id) as unknown as (Tenant & { hook_secret: string }) | undefined;
  const server = (id: string) => db.prepare('SELECT * FROM servers WHERE tenant_id=?').get(id) as unknown as ServerRow;

  async function start(tenantId: string, input: StartInput) {
    const t = byId(tenantId); if (!t) throw new Error('no such tenant');
    if (t.status !== 'active') throw new Error('Account is not active.');
    if (!input.destinations.length) throw new Error('At least one destination is required.');
    const cur = server(tenantId);
    if (['running', 'provisioning', 'booting'].includes(cur.state)) return cur;
    const recent = (db.prepare("SELECT COUNT(*) c FROM audit WHERE event='server.start' AND t > ?").get(now() - 3600) as any).c as number;
    if (recent >= cfg.maxServersPerHour) throw new Error('Provisioning rate limit reached. Try again soon.');
    const apiToken = token('ks'), obs = token('ko'), ingest = 'live/' + token('k').slice(2);
    db.prepare("UPDATE servers SET state='provisioning', updated=?, error=NULL, api_token=?, ingest_path=?, host=NULL WHERE tenant_id=?").run(now(), apiToken, ingest, tenantId);
    audit(tenantId, 'server.start', input.destinations.map((d) => d.name).join(', '));
    try {
      const planned = dns.plannedHost(tenantId);
      const p = await provider.create({
        name: `keel-${tenantId.slice(0, 8)}`,
        labels: { keel: '1', tenant: tenantId.slice(0, 8) },
        userData: cloudInit({
          repo: cfg.repo, ref: cfg.ref, apiToken, obsPassword: obs, ingestPath: ingest, publicHost: planned,
          destinations: input.destinations.map((d) => `${d.name}=${d.url}`).join(';'),
          idleWebhook: `${cfg.baseUrl}/v1/hooks/idle/${tenantId}/${t.hook_secret}`, idleMinutes: cfg.idleMinutes,
          imagePrefix: cfg.imagePrefix, imageTag: cfg.imageTag,
        }),
      });
      const host = dns.hostFor(tenantId, p.ip);
      db.prepare("UPDATE servers SET provider_id=?, ip=?, host=?, state='booting', started=?, updated=? WHERE tenant_id=?").run(p.id, p.ip, host, now(), now(), tenantId);
      await dns.upsert(host, p.ip);
    } catch (e) {
      db.prepare("UPDATE servers SET state='error', error=?, updated=? WHERE tenant_id=?").run((e as Error).message, now(), tenantId);
      audit(tenantId, 'server.error', (e as Error).message);
    }
    return server(tenantId);
  }

  async function stop(tenantId: string, reason = 'manual') {
    const s = server(tenantId);
    // Also stop servers left in error, provisioning or booting with a provider id, otherwise they bill forever.
    if (!s || !s.provider_id || !['running', 'booting', 'error', 'provisioning'].includes(s.state)) return s;
    db.prepare("UPDATE servers SET state='stopping', updated=? WHERE tenant_id=?").run(now(), tenantId);
    try { await provider.destroy(s.provider_id); } catch (e) { db.prepare("UPDATE servers SET state='error', error=? WHERE tenant_id=?").run((e as Error).message, tenantId); audit(tenantId, 'server.error', (e as Error).message); return server(tenantId); }
    if (s.host) await dns.remove(s.host).catch((e: Error) => audit(tenantId, 'dns.error', e.message));
    const end = now(); const started = s.started ?? end;
    db.prepare('INSERT INTO usage (tenant_id,started,ended,seconds) VALUES (?,?,?,?)').run(tenantId, started, end, end - started);
    db.prepare("UPDATE servers SET state='stopped', provider_id=NULL, ip=NULL, host=NULL, started=NULL, api_token=NULL, updated=? WHERE tenant_id=?").run(end, tenantId);
    audit(tenantId, 'server.stop', reason);
    return server(tenantId);
  }

  /** Booting servers become running when their dashboard answers over HTTPS; stuck ones are destroyed. */
  async function tick() {
    const rows = db.prepare("SELECT * FROM servers WHERE state='booting'").all() as unknown as ServerRow[];
    for (const s of rows) {
      let ok = false;
      if (s.host) {
        try { ok = (await f(`https://${s.host}/healthz`, { signal: AbortSignal.timeout(5000) })).ok; } catch { ok = false; }
      }
      if (ok) {
        db.prepare("UPDATE servers SET state='running', updated=? WHERE tenant_id=? AND state='booting'").run(now(), s.tenant_id);
        audit(s.tenant_id, 'server.ready', `${now() - (s.started ?? now())}s to boot`);
      } else if (s.started && now() - s.started > bootTimeout) {
        audit(s.tenant_id, 'server.error', 'boot timeout');
        await stop(s.tenant_id, 'boot timeout');
        db.prepare("UPDATE servers SET state='error', error='The server did not come up in time. It was removed, try starting again.' WHERE tenant_id=?").run(s.tenant_id);
      }
    }
  }

  /** Destroy provider servers labelled as ours that no tenant row knows about. Grace period protects servers being created. */
  async function sweep(graceSec = 1800) {
    const known = new Set((db.prepare('SELECT provider_id FROM servers WHERE provider_id IS NOT NULL').all() as { provider_id: string }[]).map((r) => r.provider_id));
    const removed: string[] = [];
    for (const s of await provider.list()) {
      if (known.has(s.id) || now() - s.created < graceSec) continue;
      await provider.destroy(s.id);
      removed.push(s.id);
      audit(null, 'sweeper.destroy', `${s.id} ${s.name}`);
    }
    return removed;
  }

  function access(tenantId: string) {
    const s = server(tenantId);
    if (!s.host || !s.api_token || !s.ingest_path) return null;
    const h = s.host;
    const urls = (p: string) => ({ srt: `srt://${h}:8890?streamid=publish:${p}`, srtla: `srtla://${h}:5000?streamid=publish:${p}`, rtmp: `rtmp://${h}:1935/${p}` });
    return { dashboardUrl: `https://${h}`, dashboardToken: s.api_token, ingest: { primary: urls(s.ingest_path), backup: urls(s.ingest_path + '-backup') } };
  }

  function usage(tenantId: string, sinceSec = now() - 30 * 86400) {
    const r = db.prepare('SELECT COALESCE(SUM(seconds),0) s, COUNT(*) n FROM usage WHERE tenant_id=? AND ended>=?').get(tenantId, sinceSec) as any;
    return { hours: +(r.s / 3600).toFixed(2), sessions: r.n as number };
  }
  async function idle(tenantId: string, secret: string) {
    const t = byId(tenantId);
    if (!t || t.hook_secret.length !== secret.length || !timingSafeEqual(Buffer.from(t.hook_secret), Buffer.from(secret))) return false;
    await stop(tenantId, 'idle'); return true;
  }
  function setStatus(customer: string, status: string) {
    const r = db.prepare('UPDATE tenants SET status=? WHERE stripe_customer=?').run(status, customer);
    return Number(r.changes) > 0;
  }
  /** Failed payment or cancelled subscription: suspend and stop any running server so it stops costing money. */
  async function suspend(customer: string) {
    const ok = setStatus(customer, 'suspended');
    for (const t of db.prepare('SELECT id FROM tenants WHERE stripe_customer=?').all(customer) as { id: string }[]) await stop(t.id, 'suspended');
    return ok;
  }
  return { createTenant, byToken, byId, server, start, stop, tick, sweep, access, usage, idle, setStatus, suspend, audit };
}
export type Service = ReturnType<typeof service>;
