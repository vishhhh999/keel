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
}

export interface SwitcherConfig {
  lowKbps: number;
  offlineKbps: number;
  degradeLowS: number;
  degradeOfflineS: number;
  recoverS: number;
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
  return 'live';
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
    this.cfg = cfg;
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
      reason = `bitrate below ${this.cfg.lowKbps} kbps`;
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
