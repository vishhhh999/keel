import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Service } from './service.ts';
import { verifyStripe } from './stripe.ts';
import { portalHtml } from './portal.ts';

const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const body = (req: IncomingMessage, max = 64_000) => new Promise<string>((ok, no) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > max) { no(new Error('too large')); req.destroy(); } }); req.on('end', () => ok(s)); req.on('error', no); });
class BadRequest extends Error {}
const json = (s: string) => { try { return JSON.parse(s || '{}'); } catch { throw new BadRequest('invalid JSON'); } };
// Values end up in a shell env file via cloud-init, so no whitespace or quotes are allowed.
const safeValue = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length < 512 && /^[^\s'"`$\\]+$/.test(v);
const send = (res: ServerResponse, code: number, v: unknown, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(v) : String(v)); };

export function api(svc: Service, o: { adminToken: string; stripeSecret?: string }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x'); const p = url.pathname;
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    try {
      if (p === '/healthz') return send(res, 200, 'ok', 'text/plain');
      if (p === '/') return send(res, 200, portalHtml(), 'text/html; charset=utf-8');

      if (p === '/v1/admin/tenants' && req.method === 'POST') {
        if (!o.adminToken || !eq(bearer, o.adminToken)) return send(res, 401, { error: 'unauthorized' });
        const b = json(await body(req));
        if (!b.name || !/^[^@\s]+@[^@\s]+$/.test(b.email ?? '')) return send(res, 400, { error: 'name and valid email required' });
        if (b.stripeCustomer !== undefined && !/^cus_\w+$/.test(b.stripeCustomer)) return send(res, 400, { error: 'stripeCustomer must look like cus_...' });
        return send(res, 201, svc.createTenant(String(b.name), String(b.email), b.plan, b.stripeCustomer ?? null));
      }
      const hook = /^\/v1\/hooks\/idle\/([0-9a-f-]{36})\/([\w-]+)$/.exec(p);
      if (hook && req.method === 'POST') return send(res, (await svc.idle(hook[1], hook[2])) ? 200 : 403, { ok: true });

      if (p === '/v1/stripe' && req.method === 'POST') {
        const raw = await body(req, 512_000);
        if (!o.stripeSecret || !verifyStripe(raw, String(req.headers['stripe-signature'] ?? ''), o.stripeSecret)) return send(res, 400, { error: 'bad signature' });
        const ev = json(raw); const cust = ev.data?.object?.customer;
        if (cust && ['customer.subscription.deleted', 'invoice.payment_failed'].includes(ev.type)) await svc.suspend(cust);
        if (cust && ev.type === 'invoice.paid') svc.setStatus(cust, 'active');
        return send(res, 200, { received: true });
      }

      if (p.startsWith('/v1/')) {
        const t = svc.byToken(bearer); if (!t) return send(res, 401, { error: 'unauthorized' });
        if (p === '/v1/me') {
          const s = svc.server(t.id);
          return send(res, 200, { tenant: { id: t.id, name: t.name, plan: t.plan, status: t.status }, server: { state: s.state, ip: s.ip, host: s.host, error: s.error }, access: svc.access(t.id), usage: svc.usage(t.id) });
        }
        if (p === '/v1/server/start' && req.method === 'POST') {
          const b = json(await body(req));
          // Either destinations: [{ name, url }] (multistream) or the single rtmpUrl + streamKey form.
          let dests: { name: string; url: string }[] = [];
          if (Array.isArray(b.destinations)) dests = b.destinations;
          else if (b.rtmpUrl || b.streamKey) dests = [{ name: 'Main', url: String(b.rtmpUrl ?? '').replace(/\/+$/, '') + '/' + String(b.streamKey ?? '') }];
          if (!dests.length || dests.length > 10) return send(res, 400, { error: 'send 1 to 10 destinations, or rtmpUrl and streamKey' });
          for (const d of dests) {
            if (!d || typeof d.name !== 'string' || !/^[\w .-]{1,40}$/.test(d.name)) return send(res, 400, { error: 'destination names: letters, numbers, spaces, dots and dashes, up to 40' });
            if (!/^(rtmps?|srt):\/\/[^/]+\/?\S*[^/]$/.test(d.url ?? '') || !safeValue(d.url) || d.url.includes(';')) return send(res, 400, { error: `${d.name}: an rtmp, rtmps or srt URL including the stream key, no spaces or quotes` });
          }
          const s = await svc.start(t.id, { destinations: dests.map((d) => ({ name: d.name.trim(), url: d.url })) });
          return send(res, 200, { state: s.state, ip: s.ip, host: s.host, error: s.error, access: svc.access(t.id) });
        }
        if (p === '/v1/server/stop' && req.method === 'POST') { const s = await svc.stop(t.id); return send(res, 200, { state: s.state }); }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      send(res, 500, { error: (e as Error).message });
    }
  });
}
