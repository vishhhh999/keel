// Watches one feed by polling the ingest server's (mediamtx) control API.
// Turns its byte counter into a smoothed bitrate and, for SRT publishers,
// reads link quality: round trip time, packet loss and dropped packets.

import { EventEmitter } from 'node:events';
import type { Sample } from './switcher.ts';

export interface IngestOptions {
  apiUrl: string;
  path: string;
  intervalMs: number;
  windowS: number;
}

export interface LinkStats {
  /** Round trip time between the encoder (or SRTLA receiver) and the ingest, ms. */
  rttMs: number | null;
  /** Percent of packets lost before retransmission over the window. */
  lossPct: number | null;
  /** Percent of packets dropped as too late over the window. These show as glitches. */
  dropPct: number | null;
  /** Receiver buffer currently held, ms. Close to the SRT latency setting is healthy. */
  bufferMs: number | null;
  /** Link capacity estimate reported by SRT, Mbps. */
  capacityMbps: number | null;
}

export interface IngestSample extends Sample {
  /** True if the control API itself could not be reached (distinct from "no publisher"). */
  apiError: boolean;
  /** Publisher protocol as reported by the ingest server, e.g. "srtConn", "rtmpConn". */
  source: string | null;
  tracks: string[];
  link?: LinkStats | null;
}

interface PathInfo {
  ready?: boolean;
  source?: { type?: string; id?: string } | null;
  tracks?: string[];
  inboundBytes?: number;
  bytesReceived?: number;
}

interface SrtConn {
  id?: string;
  path?: string;
  state?: string;
  msRTT?: number;
  packetsReceived?: number;
  packetsReceivedLoss?: number;
  packetsReceivedDrop?: number;
  msReceiveBuf?: number;
  mbpsLinkCapacity?: number;
}

interface RingEntry {
  t: number;
  bytes: number;
  recv?: number;
  loss?: number;
  drop?: number;
}

const EMPTY: Omit<IngestSample, 't'> = { ready: false, kbps: 0, apiError: false, source: null, tracks: [], link: null };

export class IngestMonitor extends EventEmitter {
  private opts: IngestOptions;
  private fetchImpl: typeof fetch;
  private timer: NodeJS.Timeout | null = null;
  private ring: RingEntry[] = [];
  last: IngestSample = { t: 0, ...EMPTY };

  constructor(opts: IngestOptions, fetchImpl: typeof fetch = fetch) {
    super();
    this.opts = opts;
    this.fetchImpl = fetchImpl;
  }

  get path(): string {
    return this.opts.path;
  }

  start(): void {
    if (this.timer) return;
    const tick = () => {
      this.poll().catch(() => {
        /* poll never throws, defensive */
      });
    };
    tick();
    this.timer = setInterval(tick, this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async get(path: string): Promise<Response> {
    return this.fetchImpl(`${this.opts.apiUrl}${path}`, { signal: AbortSignal.timeout(2000) });
  }

  async poll(now: number = Date.now()): Promise<IngestSample> {
    let sample: IngestSample;
    try {
      const res = await this.get(`/v3/paths/get/${this.opts.path}`);
      if (res.status === 404) {
        // Path exists in config but nobody has ever published, or API says unknown.
        this.ring = [];
        sample = { t: now, ...EMPTY };
      } else if (!res.ok) {
        throw new Error(`ingest API returned ${res.status}`);
      } else {
        const info = (await res.json()) as PathInfo;
        const ready = info.ready === true;
        const bytes = info.inboundBytes ?? info.bytesReceived ?? 0;
        const type = info.source?.type ?? null;
        const conn = ready && type === 'srtConn' ? await this.srtConn() : null;
        const entry: RingEntry = { t: now, bytes };
        if (conn) Object.assign(entry, { recv: conn.packetsReceived, loss: conn.packetsReceivedLoss, drop: conn.packetsReceivedDrop });
        const kbps = ready ? this.push(entry) : this.clear();
        sample = {
          t: now,
          ready,
          kbps,
          apiError: false,
          source: type,
          tracks: info.tracks ?? [],
          link: conn ? this.link(conn) : null,
        };
        sample.lossPct = sample.link?.lossPct ?? null;
        sample.dropPct = sample.link?.dropPct ?? null;
      }
    } catch {
      this.ring = [];
      sample = { t: now, ...EMPTY, apiError: true };
    }
    this.last = sample;
    this.emit('sample', sample);
    return sample;
  }

  /** Link stats for this path's SRT publisher. Failures here never break the bitrate reading. */
  private async srtConn(): Promise<SrtConn | null> {
    try {
      const res = await this.get('/v3/srtconns/list');
      if (!res.ok) return null;
      const j = (await res.json()) as { items?: SrtConn[] };
      return (j.items ?? []).find((c) => c.path === this.opts.path && (c.state ?? 'publish') === 'publish') ?? null;
    } catch {
      return null;
    }
  }

  private link(c: SrtConn): LinkStats {
    const first = this.ring[0];
    const lastE = this.ring[this.ring.length - 1];
    let lossPct: number | null = null;
    let dropPct: number | null = null;
    if (first && lastE && first !== lastE && first.recv !== undefined && lastE.recv !== undefined) {
      const recv = lastE.recv - first.recv;
      const loss = (lastE.loss ?? 0) - (first.loss ?? 0);
      const drop = (lastE.drop ?? 0) - (first.drop ?? 0);
      if (recv + loss > 0) lossPct = round1((Math.max(0, loss) / (recv + Math.max(0, loss))) * 100);
      if (recv > 0) dropPct = round1((Math.max(0, drop) / recv) * 100);
    }
    return {
      rttMs: num(c.msRTT),
      lossPct,
      dropPct,
      bufferMs: num(c.msReceiveBuf),
      capacityMbps: num(c.mbpsLinkCapacity),
    };
  }

  private clear(): number {
    this.ring = [];
    return 0;
  }

  private push(e: RingEntry): number {
    const prev = this.ring[this.ring.length - 1];
    // Counter went backwards: a new publisher connected. Start measuring again.
    if (prev && (e.bytes < prev.bytes || (e.recv !== undefined && prev.recv !== undefined && e.recv < prev.recv))) this.ring = [];
    this.ring.push(e);
    const horizon = e.t - this.opts.windowS * 1000;
    while (this.ring.length > 2 && this.ring[1]!.t <= horizon) this.ring.shift();
    if (this.ring.length < 2) return 0;
    const first = this.ring[0]!;
    const dt = e.t - first.t;
    if (dt <= 0) return 0;
    return ((e.bytes - first.bytes) * 8) / dt; // bits per ms == kilobits per second
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? round1(v) : null);
