// Reliability record. Every state change is appended to a JSONL file so a beta
// can produce hard numbers (drops survived, time on BRB, stream uptime) instead of anecdotes.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SignalState } from './switcher.ts';

export interface StatEvent {
  t: number;
  type: 'signal' | 'stream' | 'obs' | 'source' | 'shield' | 'dest';
  state: string;
  detail?: string;
}

export interface Summary {
  since: number;
  drops: number;
  lowEvents: number;
  offlineSeconds: number;
  longestDropSeconds: number;
  streamSeconds: number;
  streamStarts: number;
  streamUnexpectedStops: number;
  obsDisconnects: number;
  /** Times Keel switched to the backup encoder automatically. */
  failovers: number;
  /** Seconds the crash shield covered a missing program feed. */
  shieldSeconds: number;
  /** Times a destination dropped and the relay reconnected it. */
  destReconnects: number;
}

export class Stats {
  private file: string | null;
  private events: StatEvent[] = [];
  private since: number;

  constructor(dataDir: string | null, now: number = Date.now()) {
    this.since = now;
    this.file = null;
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.file = join(dataDir, 'events.jsonl');
      if (existsSync(this.file)) {
        for (const line of readFileSync(this.file, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            this.events.push(JSON.parse(line));
          } catch {
            /* skip corrupt line */
          }
        }
        if (this.events.length) this.since = this.events[0]!.t;
      }
    }
  }

  record(ev: StatEvent): void {
    this.events.push(ev);
    if (this.file) appendFileSync(this.file, JSON.stringify(ev) + '\n');
  }

  signal(state: SignalState, detail: string, t: number = Date.now()): void {
    this.record({ t, type: 'signal', state, detail });
  }
  stream(state: 'started' | 'stopped' | 'unexpected_stop', t: number = Date.now()): void {
    this.record({ t, type: 'stream', state });
  }
  obs(state: 'connected' | 'disconnected', t: number = Date.now()): void {
    this.record({ t, type: 'obs', state });
  }

  recent(n = 30): StatEvent[] {
    return this.events.slice(-n);
  }

  summary(now: number = Date.now()): Summary {
    let drops = 0;
    let lowEvents = 0;
    let offlineMs = 0;
    let longestMs = 0;
    let streamMs = 0;
    let streamStarts = 0;
    let unexpected = 0;
    let obsDisconnects = 0;
    let failovers = 0;
    let shieldMs = 0;
    let shieldSince: number | null = null;
    let destReconnects = 0;
    let offlineSince: number | null = null;
    let streamSince: number | null = null;

    for (const e of this.events) {
      if (e.type === 'signal') {
        if (e.state === 'offline') {
          drops++;
          offlineSince = e.t;
        } else {
          if (e.state === 'low') lowEvents++;
          if (offlineSince !== null) {
            const d = e.t - offlineSince;
            offlineMs += d;
            longestMs = Math.max(longestMs, d);
            offlineSince = null;
          }
        }
      } else if (e.type === 'stream') {
        if (e.state === 'started') {
          streamStarts++;
          streamSince = e.t;
        } else {
          if (e.state === 'unexpected_stop') unexpected++;
          if (streamSince !== null) {
            streamMs += e.t - streamSince;
            streamSince = null;
          }
        }
      } else if (e.type === 'obs' && e.state === 'disconnected') {
        obsDisconnects++;
      } else if (e.type === 'source' && e.state === 'backup') {
        failovers++;
      } else if (e.type === 'shield') {
        if (e.state === 'on') shieldSince ??= e.t;
        else if (shieldSince !== null) {
          shieldMs += e.t - shieldSince;
          shieldSince = null;
        }
      } else if (e.type === 'dest' && e.state === 'retrying') {
        destReconnects++;
      }
    }
    if (offlineSince !== null) {
      const d = now - offlineSince;
      offlineMs += d;
      longestMs = Math.max(longestMs, d);
    }
    if (streamSince !== null) streamMs += now - streamSince;
    if (shieldSince !== null) shieldMs += now - shieldSince;

    return {
      since: this.since,
      drops,
      lowEvents,
      offlineSeconds: Math.round(offlineMs / 1000),
      longestDropSeconds: Math.round(longestMs / 1000),
      streamSeconds: Math.round(streamMs / 1000),
      streamStarts,
      streamUnexpectedStops: unexpected,
      obsDisconnects,
      failovers,
      shieldSeconds: Math.round(shieldMs / 1000),
      destReconnects,
    };
  }
}
