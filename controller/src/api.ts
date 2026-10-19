// HTTP API + static dashboard. Bearer token auth, SSE for live updates.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Keel, SceneKey } from './keel.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

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

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function metricsText(keel: Keel): string {
  const st = keel.status() as any;
  const lines = [
    '# TYPE keel_ingest_kbps gauge',
    `keel_ingest_kbps ${st.ingest.kbps}`,
    '# TYPE keel_ingest_ready gauge',
    `keel_ingest_ready ${st.ingest.ready ? 1 : 0}`,
    '# TYPE keel_signal_state gauge',
    `keel_signal_state{state="${st.ingest.state}"} 1`,
    '# TYPE keel_obs_connected gauge',
    `keel_obs_connected ${st.obs.connected ? 1 : 0}`,
    '# TYPE keel_streaming gauge',
    `keel_streaming ${st.obs.streaming ? 1 : 0}`,
    '# TYPE keel_drops_total counter',
    `keel_drops_total ${st.summary.drops}`,
    '# TYPE keel_offline_seconds_total counter',
    `keel_offline_seconds_total ${st.summary.offlineSeconds}`,
    '# TYPE keel_stream_seconds_total counter',
    `keel_stream_seconds_total ${st.summary.streamSeconds}`,
    '# TYPE keel_unexpected_stops_total counter',
    `keel_unexpected_stops_total ${st.summary.streamUnexpectedStops}`,
  ];
  return lines.join('\n') + '\n';
}

export function createApi(keel: Keel, opts: { token: string; publicDir: string }): Server {
  const clients = new Set<ServerResponse>();

  const push = () => {
    if (!clients.size) return;
    const data = `data: ${JSON.stringify(keel.status())}\n\n`;
    for (const c of clients) c.write(data);
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
  }, 1000).unref();

  const authed = (req: IncomingMessage, url: URL): boolean => {
    if (!opts.token) return true;
    const header = req.headers['authorization'] ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const q = url.searchParams.get('token') ?? '';
    return safeEqual(bearer, opts.token) || safeEqual(q, opts.token);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/healthz') return send(res, 200, 'ok');

      if (path.startsWith('/api/') || path === '/metrics') {
        if (!authed(req, url)) return send(res, 401, { error: 'unauthorized' });
        keel.touch();

        if (path === '/metrics') {
          res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
          return void res.end(metricsText(keel));
        }
        if (path === '/api/status' && req.method === 'GET') return send(res, 200, keel.status());
        if (path === '/api/history' && req.method === 'GET') return send(res, 200, keel.history);
        if (path === '/api/events' && req.method === 'GET') {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          });
          res.write(`data: ${JSON.stringify(keel.status())}\n\n`);
          clients.add(res);
          req.on('close', () => clients.delete(res));
          return;
        }
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (path === '/api/scene') {
            const scene = body.scene as SceneKey;
            if (!['live', 'low', 'brb'].includes(scene)) return send(res, 400, { error: 'scene must be live, low or brb' });
            return send(res, 200, { message: await keel.setScene(scene) });
          }
          if (path === '/api/mode') {
            if (body.mode === 'auto') return send(res, 200, { message: await keel.setAuto() });
            if (body.mode === 'manual') {
              keel.mode = 'manual';
              keel.emit('change');
              return send(res, 200, { message: 'Auto-switching off.' });
            }
            return send(res, 400, { error: 'mode must be auto or manual' });
          }
          if (path === '/api/stream/start') return send(res, 200, { message: await keel.startStream() });
          if (path === '/api/stream/stop') return send(res, 200, { message: await keel.stopStream() });
        }
        return send(res, 404, { error: 'not found' });
      }

      // Static dashboard
      const rel = path === '/' ? 'index.html' : path.slice(1);
      const file = normalize(join(opts.publicDir, rel));
      if (!file.startsWith(opts.publicDir + sep) && file !== opts.publicDir) return send(res, 403, 'forbidden');
      try {
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        send(res, 404, 'not found');
      }
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  });
  return server;
}
