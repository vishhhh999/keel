// The decision engine. Pure and deterministic: feed it samples with timestamps,
// it tells you whether the signal state changed. No timers, no I/O, so it is
// trivial to test and to reason about.
//
// Philosophy: degrade fast, recover slow.
//  - Going to BRB must happen within a couple of seconds, viewers should never
//    watch a frozen frame.
//  - Coming back to LIVE must be conservative, so a flapping connection does not
//    bounce viewers between the feed and the BRB screen.

export type SignalState = 'live' | 'low' | 'offline';

export interface Sample {
  /** Milliseconds, monotonic or wall clock, only differences matter. */
  t: number;
  /** Is a publisher currently connected to the ingest path? */
  ready: boolean;
  /** Smoothed inbound bitrate in kilobits per second. */
  kbps: number;
  /** SRT only: percent of packets lost before retransmission over the window. */
  lossPct?: number | null;
  /** SRT only: percent of packets that arrived too late and were dropped (visible glitches). */
  dropPct?: number | null;
}

export interface SwitcherConfig {
  lowKbps: number;
  offlineKbps: number;
  degradeLowS: number;
  degradeOfflineS: number;
  recoverS: number;
  /** 0 disables. */
  maxDropPct?: number;
  /** 0 disables. */
  maxLossPct?: number;
}

export interface Decision {
  state: SignalState;
  previous: SignalState;
  changed: boolean;
  reason: string;
}

const SEVERITY: Record<SignalState, number> = { live: 0, low: 1, offline: 2 };

export function classify(s: Sample, cfg: SwitcherConfig): SignalState {
  if (!s.ready || s.kbps < cfg.offlineKbps) return 'offline';
  if (s.kbps < cfg.lowKbps) return 'low';
  // Bitrate alone lies on SRT: a link can carry full bitrate while packets arrive too late to show.
  if (cfg.maxDropPct && (s.dropPct ?? 0) > cfg.maxDropPct) return 'low';
  if (cfg.maxLossPct && (s.lossPct ?? 0) > cfg.maxLossPct) return 'low';
  return 'live';
}

/** Why a raw sample is not live, in words for the dashboard and logs. */
export function weakReason(s: Sample, cfg: SwitcherConfig): string {
  if (s.kbps < cfg.lowKbps) return `bitrate below ${cfg.lowKbps} kbps`;
  if (cfg.maxDropPct && (s.dropPct ?? 0) > cfg.maxDropPct) return `${(s.dropPct ?? 0).toFixed(1)}% of packets dropped`;
  if (cfg.maxLossPct && (s.lossPct ?? 0) > cfg.maxLossPct) return `${(s.lossPct ?? 0).toFixed(0)}% packet loss`;
  return 'signal weak';
}

export class Switcher {
  state: SignalState = 'offline';
  private cfg: SwitcherConfig;

  // Each tracker holds the timestamp at which its condition became continuously true.
  private offlineSince: number | null = null;
  private degradedSince: number | null = null; // raw is low or offline
  private healthySince: number | null = null; // raw is live
  private notOfflineSince: number | null = null; // raw is low or live

  constructor(cfg: SwitcherConfig) {
    this.cfg = { ...cfg };
  }

  /** Apply new thresholds live, without losing the current state. */
  configure(cfg: Partial<SwitcherConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  get config(): SwitcherConfig {
    return { ...this.cfg };
  }

  /** Reset to a known state (used when OBS reconnects and we re-sync). */
  reset(state: SignalState = 'offline'): void {
    this.state = state;
    this.offlineSince = this.degradedSince = this.healthySince = this.notOfflineSince = null;
  }

  update(sample: Sample): Decision {
    const raw = classify(sample, this.cfg);
    const t = sample.t;
    const previous = this.state;

    this.offlineSince = raw === 'offline' ? (this.offlineSince ?? t) : null;
    this.degradedSince = raw !== 'live' ? (this.degradedSince ?? t) : null;
    this.healthySince = raw === 'live' ? (this.healthySince ?? t) : null;
    this.notOfflineSince = raw !== 'offline' ? (this.notOfflineSince ?? t) : null;

    const held = (since: number | null, seconds: number) =>
      since !== null && t - since >= seconds * 1000;

    let next: SignalState = this.state;
    let reason = 'steady';

    // 1. Anything -> offline: feed is gone. Fast.
    if (this.state !== 'offline' && held(this.offlineSince, this.cfg.degradeOfflineS)) {
      next = 'offline';
      reason = sample.ready ? 'bitrate collapsed' : 'publisher disconnected';
    }
    // 2. live -> low: bitrate sagging but still moving. Slightly slower than offline.
    else if (this.state === 'live' && held(this.degradedSince, this.cfg.degradeLowS)) {
      next = 'low';
      reason = weakReason(sample, this.cfg);
    }
    // 3. Recovery to live: needs a sustained healthy stretch.
    else if (this.state !== 'live' && held(this.healthySince, this.cfg.recoverS)) {
      next = 'live';
      reason = `healthy for ${this.cfg.recoverS}s`;
    }
    // 4. offline -> low: feed is back but weak. Same patience as a full recovery.
    else if (
      this.state === 'offline' &&
      raw === 'low' &&
      held(this.notOfflineSince, this.cfg.recoverS)
    ) {
      next = 'low';
      reason = 'feed back, bitrate weak';
    }

    const changed = next !== previous;
    if (changed) {
      this.state = next;
      // Restart the clocks so we never chain two transitions off one old observation.
      this.degradedSince = raw !== 'live' ? t : null;
      this.healthySince = raw === 'live' ? t : null;
      this.offlineSince = raw === 'offline' ? t : null;
      this.notOfflineSince = raw !== 'offline' ? t : null;
    }
    return { state: this.state, previous, changed, reason };
  }

  static isWorse(a: SignalState, b: SignalState): boolean {
    return SEVERITY[a] > SEVERITY[b];
  }
}
