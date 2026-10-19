// Watches the phone feed by polling the ingest server's (mediamtx) control API
// and turning its byte counter into a smoothed bitrate.

import { EventEmitter } from 'node:events';
import type { Sample } from './switcher.ts';

export interface IngestOptions {
  apiUrl: string;
  path: string;
  intervalMs: number;
  windowS: number;
}

export interface IngestSample extends Sample {
  /** True if the control API itself could not be reached (distinct from "no publisher"). */
  apiError: boolean;
  /** Publisher protocol as reported by the ingest server, e.g. "srtConn", "rtmpConn". */
  source: string | null;
  tracks: string[];
}

interface PathInfo {
  ready?: boolean;
  source?: { type?: string } | null;
  tracks?: string[];
  inboundBytes?: number;
  bytesReceived?: number;
}

export class IngestMonitor extends EventEmitter {
  private opts: IngestOptions;
  private fetchImpl: typeof fetch;
  private timer: NodeJS.Timeout | null = null;
  private ring: { t: number; bytes: number }[] = [];
  last: IngestSample = {
    t: 0,
    ready: false,
    kbps: 0,
    apiError: false,
    source: null,
    tracks: [],
  };

  constructor(opts: IngestOptions, fetchImpl: typeof fetch = fetch) {
    super();
    this.opts = opts;
    this.fetchImpl = fetchImpl;
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

  async poll(now: number = Date.now()): Promise<IngestSample> {
    let sample: IngestSample;
    try {
      const url = `${this.opts.apiUrl}/v3/paths/get/${this.opts.path}`;
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 404) {
        // Path exists in config but nobody has ever published, or API says unknown.
        this.ring = [];
        sample = { t: now, ready: false, kbps: 0, apiError: false, source: null, tracks: [] };
      } else if (!res.ok) {
        throw new Error(`ingest API returned ${res.status}`);
      } else {
        const info = (await res.json()) as PathInfo;
        const ready = info.ready === true;
        const bytes = info.inboundBytes ?? info.bytesReceived ?? 0;
        const kbps = ready ? this.bitrate(now, bytes) : this.clear();
        sample = {
          t: now,
          ready,
          kbps,
          apiError: false,
          source: info.source?.type ?? null,
          tracks: info.tracks ?? [],
        };
      }
    } catch {
      this.ring = [];
      sample = { t: now, ready: false, kbps: 0, apiError: true, source: null, tracks: [] };
    }
    this.last = sample;
    this.emit('sample', sample);
    return sample;
  }

  private clear(): number {
    this.ring = [];
    return 0;
  }

  private bitrate(now: number, bytes: number): number {
    const prev = this.ring[this.ring.length - 1];
    // Counter went backwards: a new publisher connected. Start measuring again.
    if (prev && bytes < prev.bytes) this.ring = [];
    this.ring.push({ t: now, bytes });
    const horizon = now - this.opts.windowS * 1000;
    while (this.ring.length > 2 && this.ring[1]!.t <= horizon) this.ring.shift();
    if (this.ring.length < 2) return 0;
    const first = this.ring[0]!;
    const dt = now - first.t;
    if (dt <= 0) return 0;
    return ((bytes - first.bytes) * 8) / dt; // bits per ms == kilobits per second
  }
}
