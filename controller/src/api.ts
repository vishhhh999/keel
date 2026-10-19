// HTTP API + static dashboard. Bearer token auth (admin or moderator), one-time
// tickets for the live event stream so tokens never sit in URLs or logs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Keel, SceneKey, SourcePin } from './keel.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export type Role = 'admin' | 'mod';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function send(res: ServerResponse, code: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'cache-control': 'no-store',
  });
  res.end(text);
}

class HttpError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
  }
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

export function metricsText(keel: Keel): string {
  const st = keel.status() as any;
  const link = st.ingest.link ?? {};
  const lines = [
    '# TYPE keel_ingest_kbps gauge',
    `keel_ingest_kbps ${st.ingest.kbps}`,
    '# TYPE keel_ingest_ready gauge',
    `keel_ingest_ready ${st.ingest.ready ? 1 : 0}`,
    '# TYPE keel_signal_state gauge',
    `keel_signal_state{state="${st.ingest.state}"} 1`,
    '# TYPE keel_ingest_rtt_ms gauge',
    `keel_ingest_rtt_ms ${link.rttMs ?? 'NaN'}`,
    '# TYPE keel_ingest_loss_pct gauge',
    `keel_ingest_loss_pct ${link.lossPct ?? 'NaN'}`,
    '# TYPE keel_ingest_drop_pct gauge',
    `keel_ingest_drop_pct ${link.dropPct ?? 'NaN'}`,
    '# TYPE keel_active_source gauge',
    `keel_active_source{source="${st.ingest.active}"} 1`,
    '# TYPE keel_obs_connected gauge',
    `keel_obs_connected ${st.obs.connected ? 1 : 0}`,
    '# TYPE keel_streaming gauge',
    `keel_streaming ${st.obs.streaming ? 1 : 0}`,
    '# TYPE keel_on_air gauge',
    `keel_on_air ${st.broadcast.onAir ? 1 : 0}`,
    '# TYPE keel_crash_shield gauge',
    `keel_crash_shield ${st.broadcast.shield ? 1 : 0}`,
    '# TYPE keel_destination_up gauge',
    ...st.broadcast.destinations.map((d: any) => `keel_destination_up{destination="${esc(d.name)}"} ${d.state === 'live' || d.state === 'shield' ? 1 : 0}`),
    '# TYPE keel_destination_restarts_total counter',
    ...st.broadcast.destinations.map((d: any) => `keel_destination_restarts_total{destination="${esc(d.name)}"} ${d.restarts}`),
    '# TYPE keel_drops_total counter',
    `keel_drops_total ${st.summary.drops}`,
    '# TYPE keel_failovers_total counter',
    `keel_failovers_total ${st.summary.failovers}`,
    '# TYPE keel_offline_seconds_total counter',
    `keel_offline_seconds_total ${st.summary.offlineSeconds}`,
    '# TYPE keel_stream_seconds_total counter',
    `keel_stream_seconds_total ${st.summary.streamSeconds}`,
    '# TYPE keel_unexpected_stops_total counter',
    `keel_unexpected_stops_total ${st.summary.streamUnexpectedStops}`,
    '# TYPE keel_auto_restarts_total counter',
    `keel_auto_restarts_total ${st.broadcast.autoRestarts}`,
  ];
  return lines.join('\n') + '\n';
}

export function createApi(keel: Keel, opts: { token: string; modToken?: string; publicDir: string; now?: () => number }): Server {
  const now = opts.now ?? Date.now;
  const clients = new Map<ServerResponse, Role>();
  const tickets = new Map<string, { role: Role; exp: number }>();

  const snapshot = (role: Role) => JSON.stringify({ ...keel.status(), role });
  const push = () => {
    if (!clients.size) return;
    const admin = `data: ${snapshot('admin')}\n\n`;
    const mod = `data: ${snapshot('mod')}\n\n`;
    for (const [c, role] of clients) c.write(role === 'admin' ? admin : mod);
  };
  // Throttle: signal changes can be bursty, the UI only needs ~1 update per second.
  let lastPush = 0;
  keel.on('change', () => {
    const n = Date.now();
    if (n - lastPush >= 900) {
      lastPush = n;
      push();
    }
  });
  // An open dashboard or app counts as activity, so idle shutdown never fires under someone watching.
  setInterval(() => {
    if (clients.size) keel.touch();
    push();
    const t = now();
    for (const [k, v] of tickets) if (v.exp < t) tickets.delete(k);
  }, 1000).unref();

  const roleOf = (req: IncomingMessage, url: URL, path: string): Role | null => {
    if (!opts.token) return 'admin';
    if (path === '/api/events') {
      const tk = url.searchParams.get('ticket') ?? '';
      const t = tickets.get(tk);
      if (t && t.exp >= now()) {
        tickets.delete(tk); // one use only
        return t.role;
      }
      return null;
    }
    const header = req.headers['authorization'] ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (bearer && safeEqual(bearer, opts.token)) return 'admin';
    if (bearer && opts.modToken && safeEqual(bearer, opts.modToken)) return 'mod';
    return null;
  };
  const adminOnly = (role: Role) => {
    if (role !== 'admin') throw new HttpError(403, 'Moderators cannot do that. Ask the streamer.');
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/healthz') return send(res, 200, 'ok');

      if (path.startsWith('/api/') || path === '/metrics') {
        const role = roleOf(req, url, path);
        if (!role) return send(res, 401, { error: 'unauthorized' });
        keel.touch();

        if (path === '/metrics') {
          res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
          return void res.end(metricsText(keel));
        }
        if (path === '/api/status' && req.method === 'GET') return send(res, 200, { ...keel.status(), role });
        if (path === '/api/history' && req.method === 'GET') return send(res, 200, keel.history);
        if (path === '/api/events' && req.method === 'GET') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
          res.write(`data: ${snapshot(role)}\n\n`);
          clients.set(res, role);
          req.on('close', () => clients.delete(res));
          return;
        }
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (path === '/api/ticket') {
            const ticket = randomBytes(24).toString('base64url');
            tickets.set(ticket, { role, exp: now() + 30_000 });
            return send(res, 200, { ticket, expiresIn: 30 });
          }
          if (path === '/api/scene') {
            const scene = body.scene as SceneKey;
            if (!['live', 'low', 'brb'].includes(scene)) return send(res, 400, { error: 'scene must be live, low or brb' });
            return send(res, 200, { message: await keel.setScene(scene) });
          }
          if (path === '/api/mode') {
            if (body.mode === 'auto') return send(res, 200, { message: await keel.setAuto() });
            if (body.mode === 'manual') return send(res, 200, { message: keel.setManual() });
            return send(res, 400, { error: 'mode must be auto or manual' });
          }
          if (path === '/api/source') {
            const pin = body.source as SourcePin;
            if (!['auto', 'primary', 'backup'].includes(pin)) return send(res, 400, { error: 'source must be auto, primary or backup' });
            return send(res, 200, { message: await keel.setSource(pin) });
          }
          if (path === '/api/stream/start') {
            adminOnly(role);
            return send(res, 200, { message: await keel.startStream() });
          }
          if (path === '/api/stream/stop') {
            adminOnly(role);
            return send(res, 200, { message: await keel.stopStream() });
          }
          if (path === '/api/destination') {
            adminOnly(role);
            if (typeof body.id !== 'string' || typeof body.enabled !== 'boolean') return send(res, 400, { error: 'id and enabled required' });
            return send(res, 200, { message: keel.setDestination(body.id, body.enabled) });
          }
          if (path === '/api/settings') {
            adminOnly(role);
            if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'send an object of settings' });
            return send(res, 200, { thresholds: keel.updateSettings(body) });
          }
        }
        return send(res, 404, { error: 'not found' });
      }

      // Static dashboard
      const rel = path === '/' ? 'index.html' : path.slice(1);
      const file = normalize(join(opts.publicDir, rel));
      if (!file.startsWith(opts.publicDir + sep) && file !== opts.publicDir) return send(res, 403, 'forbidden');
      try {
        const data = await readFile(file);
        res.writeHead(200, {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          ...(extname(file) === '.html' ? { 'x-frame-options': 'DENY' } : {}),
        });
        res.end(data);
      } catch {
        send(res, 404, 'not found');
      }
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.code, { error: e.message });
      const msg = (e as Error).message;
      // Validation errors from settings and actions are the caller's fault, not ours.
      const userError = /must be|Unknown setting|No .* configured|No destination|not connected|relay mode|below the weak/.test(msg);
      send(res, userError ? 400 : 500, { error: msg });
    }
  });
  return server;
}
