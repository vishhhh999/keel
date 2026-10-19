// The brain. Connects the ingest monitors, the switchers, OBS and the relay, and
// exposes one status snapshot and a small set of actions to the dashboard, the
// mobile app and the chat bot.

import { EventEmitter } from 'node:events';
import type { Config, SourceConfig } from './config.ts';
import type { IngestSample } from './ingest.ts';
import { Switcher, type SignalState } from './switcher.ts';
import type { Stats } from './stats.ts';
import { bootstrapObs, type SourceItems } from './bootstrap.ts';
import type { DestStatus } from './relay.ts';
import { SettingsStore, validate, type Editable } from './settings.ts';

export const VERSION = '0.3.0';

export type SceneKey = 'live' | 'low' | 'brb';
export type Mode = 'auto' | 'manual';
export type SourcePin = 'auto' | 'primary' | 'backup';

export interface ObsPort {
  connected: boolean;
  on(event: string, fn: (...args: any[]) => void): unknown;
  request<T = any>(type: string, data?: object): Promise<T>;
  getScene(): Promise<string>;
  setScene(name: string): Promise<unknown>;
  getStreamStatus(): Promise<{ active: boolean; reconnecting: boolean; timecode: string; bytes: number; skippedFrames: number; totalFrames: number }>;
  startStream(): Promise<unknown>;
  stopStream(): Promise<unknown>;
}

export interface IngestPort {
  last: IngestSample;
  on(event: 'sample', fn: (s: IngestSample) => void): unknown;
}

export interface RelayPort {
  active: boolean;
  onAir: boolean;
  shielding: boolean;
  start(): void;
  stop(): void;
  setInputReady(ready: boolean): void;
  setEnabled(id: string, enabled: boolean): boolean;
  status(): DestStatus[];
  on(event: string, fn: (...args: any[]) => void): unknown;
}

export interface NotifierPort {
  send(kind: string, text: string): boolean;
}

export interface HistoryPoint {
  t: number;
  kbps: number;
  state: SignalState;
  scene: string | null;
  streaming: boolean;
  source?: string;
  rttMs?: number | null;
}

export interface Extras {
  relay?: RelayPort | null;
  /** Monitor of the local program path (relay mode). Drives the crash shield. */
  program?: IngestPort | null;
  notifier?: NotifierPort | null;
  settings?: SettingsStore | null;
}

interface SourceRt {
  cfg: SourceConfig;
  ingest: IngestPort;
  switcher: Switcher;
  state: SignalState;
  reason: string;
}

const HISTORY_MAX = 600;
const STATE_TO_SCENE: Record<SignalState, SceneKey> = { live: 'live', low: 'low', offline: 'brb' };
const SEVERITY: Record<SignalState, number> = { live: 0, low: 1, offline: 2 };

export class Keel extends EventEmitter {
  mode: Mode = 'auto';
  signal: SignalState = 'offline';
  signalReason = 'waiting for feed';
  scene: string | null = null;
  streaming = false;
  reconnecting = false;
  synced = false;
  /** The operator asked to be live. Drives auto-restart and the crash shield. */
  wantLive = false;
  autoRestarts = 0;
  pin: SourcePin = 'auto';
  activeSource: 'primary' | 'backup' = 'primary';
  streamInfo = { timecode: '', skippedFrames: 0, totalFrames: 0 };
  history: HistoryPoint[] = [];
  private sources: SourceRt[];
  private items: SourceItems = {};
  private lastActivity: number;
  private idleFired = false;
  private stopRequested = false;
  private offlineSince: number | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartAttempt = 0;
  private cfg: Config;
  private obs: ObsPort;
  private stats: Stats;
  private now: () => number;
  private relay: RelayPort | null;
  private program: IngestPort | null;
  private notifier: NotifierPort | null;
  private store: SettingsStore | null;
  private streamPoll: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(cfg: Config, obs: ObsPort, ingests: IngestPort | IngestPort[], stats: Stats, now: () => number = Date.now, extras: Extras = {}) {
    super();
    this.cfg = cfg;
    this.obs = obs;
    this.stats = stats;
    this.now = now;
    this.relay = extras.relay ?? null;
    this.program = extras.program ?? null;
    this.notifier = extras.notifier ?? null;
    this.store = extras.settings ?? null;
    this.lastActivity = now();
    const saved = this.store?.load() ?? {};
    Object.assign(cfg.thresholds, saved);
    const list = Array.isArray(ingests) ? ingests : [ingests];
    this.sources = list.slice(0, cfg.sources.length).map((ingest, i) => ({
      cfg: cfg.sources[i]!,
      ingest,
      switcher: new Switcher(this.switcherConfig()),
      state: 'offline' as SignalState,
      reason: 'waiting for feed',
    }));
  }

  private switcherConfig() {
    const t = this.cfg.thresholds;
    return { lowKbps: t.lowKbps, offlineKbps: t.offlineKbps, degradeLowS: t.degradeLowS, degradeOfflineS: t.degradeOfflineS, recoverS: t.recoverS, maxDropPct: t.maxDropPct, maxLossPct: t.maxLossPct };
  }

  /** Primary ingest, kept for callers that only know one feed. */
  get ingest(): IngestPort {
    return this.sources[0]!.ingest;
  }

  start(): void {
    this.obs.on('connected', () => void this.onObsConnected());
    this.obs.on('disconnected', () => {
      this.synced = false;
      this.stats.obs('disconnected', this.now());
      if (this.wantLive) {
        this.alert('obs', this.relay ? 'OBS stopped responding. The crash shield is holding the BRB screen on every platform while it restarts.' : 'OBS stopped responding. Keel will resume the broadcast when it is back.');
      }
      this.emit('change');
    });
    this.obs.on('obs-event', (type: string, data: any) => this.onObsEvent(type, data));
    for (const s of this.sources) s.ingest.on('sample', (x) => this.onSample(s, x));
    this.program?.on('sample', (x) => this.relay?.setInputReady(x.ready));
    if (this.relay) {
      this.relay.on('retry', (d: { id: string; name: string }, wait: number) => {
        const err = this.relay?.status().find((x) => x.id === d.id)?.lastError;
        this.emit('log', `${d.name}: connection lost, retrying in ${Math.round(wait / 1000)}s${err ? ` (${err})` : ''}`);
        this.stats.record({ t: this.now(), type: 'dest', state: 'retrying', detail: d.name });
        this.alert(`dest-${d.id}`, `${d.name} dropped the connection. Retrying on its own, other platforms are not affected.`);
      });
      this.relay.on('recovered', (d: { name: string }) => {
        this.stats.record({ t: this.now(), type: 'dest', state: 'live', detail: d.name });
        this.alert(`dest-ok-${d.name}`, `${d.name} is receiving the stream again.`);
      });
      this.relay.on('shield', (on: boolean) => {
        this.stats.record({ t: this.now(), type: 'shield', state: on ? 'on' : 'off' });
        this.emit('log', on ? 'crash shield on: program feed missing, destinations show BRB' : 'crash shield off: program feed back');
        this.alert(on ? 'shield' : 'shield-off', on ? 'Program feed from OBS is missing. Crash shield is showing BRB on every platform.' : 'Program feed is back. Crash shield off.');
      });
      this.relay.on('change', () => this.emit('change'));
    }
    this.streamPoll = setInterval(() => void this.refreshStream(), 3000);
    this.idleTimer = setInterval(() => this.checkIdle(), 10_000);
  }

  stop(): void {
    if (this.streamPoll) clearInterval(this.streamPoll);
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
  }

  touch(): void {
    this.lastActivity = this.now();
    this.idleFired = false;
  }

  private alert(kind: string, text: string): void {
    this.notifier?.send(kind, text);
  }

  private sceneName(key: SceneKey): string {
    return this.cfg.scenes[key];
  }

  private async onObsConnected(): Promise<void> {
    try {
      this.items = await bootstrapObs(this.obs, this.cfg);
      this.scene = await this.obs.getScene();
      await this.refreshStream();
      this.synced = true;
      this.stats.obs('connected', this.now());
      for (const s of this.sources) s.switcher.reset(s.state);
      await this.applySource(true);
      await this.applyAuto();
      // OBS came back (crash, restart) while the operator wants to be live: resume.
      if (this.wantLive && !this.streaming) {
        await this.obs.startStream().catch((e: Error) => this.emit('log', `resume failed: ${e.message}`));
        this.autoRestarts++;
        this.emit('log', 'OBS back, broadcast resumed');
        this.alert('obs-back', 'OBS is back and the broadcast has resumed.');
      }
    } catch (e) {
      this.emit('log', `OBS setup failed: ${(e as Error).message}`);
    }
    this.emit('change');
  }

  private onObsEvent(type: string, data: any): void {
    if (type === 'CurrentProgramSceneChanged') {
      this.scene = data.sceneName;
      this.emit('change');
    } else if (type === 'StreamStateChanged') {
      const was = this.streaming;
      this.streaming = data.outputActive === true;
      this.reconnecting = data.outputState === 'OBS_WEBSOCKET_OUTPUT_RECONNECTING';
      if (!was && this.streaming) {
        this.stats.stream('started', this.now());
        this.restartAttempt = 0;
      }
      if (was && !this.streaming) {
        const unexpected = !this.stopRequested;
        this.stats.stream(unexpected ? 'unexpected_stop' : 'stopped', this.now());
        this.stopRequested = false;
        if (unexpected && this.wantLive) this.scheduleRestart();
      }
      this.emit('change');
    }
  }

  /** The broadcast stopped without anyone asking. Bring it back with a short backoff. */
  private scheduleRestart(): void {
    if (!this.cfg.autoRestart || this.restartTimer) return;
    const wait = Math.min(15_000, 1000 * 2 ** this.restartAttempt++);
    this.emit('log', `broadcast stopped unexpectedly, restarting in ${Math.round(wait / 1000)}s`);
    this.alert('restart', 'The broadcast stopped unexpectedly. Keel is restarting it.');
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      if (!this.wantLive || this.streaming || !this.obs.connected) return;
      try {
        await this.obs.startStream();
        this.autoRestarts++;
      } catch (e) {
        this.emit('log', `restart failed: ${(e as Error).message}`);
        this.scheduleRestart();
      }
    }, wait);
    this.restartTimer.unref?.();
  }

  private pickSource(): SourceRt {
    const primary = this.sources[0]!;
    if (this.pin !== 'auto') return this.sources.find((s) => s.cfg.id === this.pin) ?? primary;
    // A publisher that has disconnected outright counts as gone right away for failover: there is no reason
    // to show a frozen or black frame for the degrade delay when a healthy backup is already on screen-ready.
    // Coming back still needs the full recovery time, because rank follows the switcher state once connected.
    const rank = (s: SourceRt) => (s.ingest.last.ready ? SEVERITY[s.state] : SEVERITY.offline);
    let best = primary;
    for (const s of this.sources.slice(1)) if (rank(s) < rank(best)) best = s;
    return best;
  }

  private onSample(src: SourceRt, s: IngestSample): void {
    const d = src.switcher.update(s);
    if (d.changed) {
      src.state = d.state;
      src.reason = d.reason;
      if (this.sources.length > 1) this.emit('log', `${src.cfg.label.toLowerCase()} ${d.previous} -> ${d.state} (${d.reason})`);
    }
    // A phone that disconnects outright while the other one is healthy is gone now, not after the degrade
    // delay: viewers switch to the healthy feed immediately, and this one must earn the full recovery time
    // before it is put back on air (no bounce on a one second blip).
    if (!s.ready && src.state !== 'offline' && this.sources.some((o) => o !== src && o.state === 'live' && o.ingest.last.ready)) {
      const prev = src.state;
      src.switcher.reset('offline');
      src.state = 'offline';
      src.reason = 'publisher disconnected';
      this.emit('log', `${src.cfg.label.toLowerCase()} ${prev} -> offline (publisher disconnected, healthy backup available)`);
    }
    if (s.ready || this.streaming || this.wantLive) this.touch();
    this.evaluate();
    if (src === this.sources[0]) {
      const act = this.current();
      this.history.push({ t: s.t, kbps: Math.round(act.ingest.last.kbps), state: this.signal, scene: this.scene, streaming: this.onAir, source: act.cfg.id, rttMs: act.ingest.last.link?.rttMs ?? null });
      if (this.history.length > HISTORY_MAX) this.history.shift();
    }
    this.emit('sample', s);
    this.emit('change');
  }

  private current(): SourceRt {
    return this.sources.find((s) => s.cfg.id === this.activeSource) ?? this.sources[0]!;
  }

  private evaluate(): void {
    const next = this.pickSource();
    if (next.cfg.id !== this.activeSource) {
      const prev = this.activeSource;
      this.activeSource = next.cfg.id;
      this.stats.record({ t: this.now(), type: 'source', state: next.cfg.id, detail: this.pin === 'auto' ? 'automatic failover' : 'pinned' });
      this.emit('log', `source ${prev} -> ${next.cfg.id}`);
      this.emit('failover', next.cfg.id);
      if (this.wantLive || this.streaming) {
        this.alert('source', next.cfg.id === 'backup' ? 'Primary feed failed. Switched to the backup encoder.' : 'Primary feed is healthy again. Back on primary.');
      }
      void this.applySource();
    }
    const state = next.state;
    const reason = this.sources.length > 1 && next.cfg.id === 'backup' && state !== 'offline' ? `on backup: ${next.reason}` : next.reason;
    if (state !== this.signal) {
      const previous = this.signal;
      this.signal = state;
      this.signalReason = reason;
      this.stats.signal(state, reason, this.now());
      this.emit('log', `signal ${previous} -> ${state} (${reason})`);
      this.emit('signal', { state, previous, reason });
      const t = this.now();
      if (state === 'offline') {
        this.offlineSince = t;
        if (this.wantLive || this.streaming) this.alert('offline', 'Signal lost. Viewers see the BRB screen, the broadcast is still up.');
      } else if (previous === 'offline' && this.offlineSince !== null) {
        const secs = Math.round((t - this.offlineSince) / 1000);
        this.offlineSince = null;
        if (this.wantLive || this.streaming) this.alert('back', `Signal back after ${secs}s.`);
      }
      void this.applyAuto();
    } else {
      this.signalReason = reason;
    }
  }

  /** Show only the active source in the LIVE and LOW SIGNAL scenes. */
  private async applySource(force = false): Promise<void> {
    if (!this.synced || !this.obs.connected || this.sources.length < 2) return;
    for (const s of this.sources) {
      const ids = this.items[s.cfg.id];
      if (!ids) continue;
      const enabled = s.cfg.id === this.activeSource;
      for (const [key, id] of [['live', ids.live], ['low', ids.low]] as const) {
        if (id === null) continue;
        try {
          await this.obs.request('SetSceneItemEnabled', { sceneName: this.sceneName(key), sceneItemId: id, sceneItemEnabled: enabled });
        } catch (e) {
          if (force) this.emit('log', `source visibility failed: ${(e as Error).message}`);
        }
      }
    }
  }

  private async applyAuto(): Promise<void> {
    if (this.mode !== 'auto' || !this.synced || !this.obs.connected) return;
    const want = this.sceneName(STATE_TO_SCENE[this.signal]);
    if (this.scene === want) return;
    try {
      await this.obs.setScene(want);
      this.scene = want;
    } catch (e) {
      this.emit('log', `scene switch failed: ${(e as Error).message}`);
    }
  }

  private async refreshStream(): Promise<void> {
    if (!this.obs.connected) return;
    try {
      const s = await this.obs.getStreamStatus();
      this.streaming = s.active;
      this.reconnecting = s.reconnecting;
      this.streamInfo = { timecode: s.timecode, skippedFrames: s.skippedFrames, totalFrames: s.totalFrames };
    } catch {
      /* next poll */
    }
  }

  private checkIdle(): void {
    if (this.idleFired || this.cfg.idle.minutes <= 0 || this.wantLive) return;
    if (this.now() - this.lastActivity >= this.cfg.idle.minutes * 60_000) {
      this.idleFired = true;
      this.emit('idle', this.cfg.idle.minutes);
    }
  }

  /** Is the audience receiving video right now? Relay mode: any destination live or shielded. */
  get onAir(): boolean {
    return this.relay ? this.relay.onAir : this.streaming;
  }

  // ---- actions (dashboard, app, chat) ----

  async setScene(key: SceneKey): Promise<string> {
    this.touch();
    if (!this.obs.connected) throw new Error('OBS is not connected');
    this.mode = 'manual';
    await this.obs.setScene(this.sceneName(key));
    this.scene = this.sceneName(key);
    this.emit('change');
    return `Scene set to ${key.toUpperCase()}. Auto-switching is off, send !auto to resume.`;
  }

  async setAuto(): Promise<string> {
    this.touch();
    this.mode = 'auto';
    await this.applyAuto();
    this.emit('change');
    return `Auto-switching on. Signal is ${this.signal}.`;
  }

  setManual(): string {
    this.touch();
    this.mode = 'manual';
    this.emit('change');
    return 'Auto-switching off.';
  }

  async setSource(pin: SourcePin): Promise<string> {
    this.touch();
    if (pin !== 'auto' && !this.sources.some((s) => s.cfg.id === pin)) throw new Error(`No ${pin} ingest is configured.`);
    this.pin = pin;
    this.evaluate();
    await this.applySource(true);
    this.emit('change');
    return pin === 'auto' ? 'Source: automatic failover.' : `Source pinned to ${pin}.`;
  }

  async startStream(): Promise<string> {
    this.touch();
    if (!this.obs.connected) throw new Error('OBS is not connected');
    if (!this.cfg.destinations.length && !this.cfg.rtmpUrl) throw new Error('No stream destination configured (KEEL_DESTINATIONS or KEEL_RTMP_URL)');
    this.wantLive = true;
    this.restartAttempt = 0;
    this.relay?.start();
    if (this.streaming) {
      this.emit('change');
      return 'Already live.';
    }
    await this.obs.startStream();
    this.emit('change');
    return this.relay ? `Starting the broadcast to ${this.cfg.destinations.length} destination${this.cfg.destinations.length === 1 ? '' : 's'}.` : 'Starting the broadcast.';
  }

  async stopStream(): Promise<string> {
    this.touch();
    this.wantLive = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.relay?.stop();
    if (!this.obs.connected) {
      this.emit('change');
      return 'Destinations stopped. OBS is not connected.';
    }
    if (!this.streaming) {
      this.emit('change');
      return 'Not streaming.';
    }
    this.stopRequested = true;
    await this.obs.stopStream();
    this.emit('change');
    return 'Broadcast stopped.';
  }

  setDestination(id: string, enabled: boolean): string {
    this.touch();
    if (!this.relay) throw new Error('Destinations can be toggled in relay mode only.');
    if (!this.relay.setEnabled(id, enabled)) throw new Error(`No destination "${id}".`);
    return `${id} ${enabled ? 'on' : 'off'}.`;
  }

  updateSettings(input: Record<string, unknown>): Editable {
    const patch = validate(input, this.cfg.thresholds);
    Object.assign(this.cfg.thresholds, patch);
    for (const s of this.sources) s.switcher.configure(this.switcherConfig());
    this.store?.save(this.cfg.thresholds);
    this.emit('log', `settings changed: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    this.emit('change');
    const { windowS: _w, ...rest } = this.cfg.thresholds;
    return rest;
  }

  statusLine(): string {
    const s = this.current().ingest.last;
    const scene = this.scene ?? 'unknown';
    const rtt = s.link?.rttMs != null ? `, rtt ${Math.round(s.link.rttMs)} ms` : '';
    const src = this.sources.length > 1 ? `, source ${this.activeSource}` : '';
    return `Signal ${this.signal.toUpperCase()} (${Math.round(s.kbps)} kbps${rtt}${src}), scene ${scene}, mode ${this.mode}, ${this.onAir ? 'broadcasting' : 'not broadcasting'}.`;
  }

  ingestUrls(path = this.cfg.ingestPath): { rtmp: string; srt: string; srtla: string } {
    const h = this.cfg.publicHost;
    return {
      rtmp: `rtmp://${h}:${this.cfg.publicRtmpPort}/${path}`,
      srt: `srt://${h}:${this.cfg.publicSrtPort}?streamid=publish:${path}`,
      srtla: `srtla://${h}:${this.cfg.publicSrtlaPort}?streamid=publish:${path}`,
    };
  }

  status(): Record<string, unknown> {
    const act = this.current();
    const s = act.ingest.last;
    return {
      version: VERSION,
      t: this.now(),
      mode: this.mode,
      scenes: this.cfg.scenes,
      obs: {
        connected: this.obs.connected,
        synced: this.synced,
        scene: this.scene,
        streaming: this.streaming,
        reconnecting: this.reconnecting,
        timecode: this.streamInfo.timecode,
        skippedFrames: this.streamInfo.skippedFrames,
        totalFrames: this.streamInfo.totalFrames,
      },
      ingest: {
        state: this.signal,
        reason: this.signalReason,
        ready: s.ready,
        kbps: Math.round(s.kbps),
        source: s.source,
        tracks: s.tracks,
        apiError: s.apiError,
        link: s.link ?? null,
        active: this.activeSource,
        pin: this.pin,
        thresholds: this.cfg.thresholds,
      },
      sources: this.sources.map((x) => ({
        id: x.cfg.id,
        label: x.cfg.label,
        state: x.state,
        reason: x.reason,
        ready: x.ingest.last.ready,
        kbps: Math.round(x.ingest.last.kbps),
        protocol: x.ingest.last.source,
        link: x.ingest.last.link ?? null,
        active: x.cfg.id === this.activeSource,
        urls: this.ingestUrls(x.cfg.path),
      })),
      broadcast: {
        output: this.relay ? 'relay' : 'direct',
        wanted: this.wantLive,
        onAir: this.onAir,
        shield: this.relay?.shielding ?? false,
        autoRestarts: this.autoRestarts,
        destinations: this.relay
          ? this.relay.status()
          : this.cfg.destinations.slice(0, 1).map((d) => ({ id: d.id, name: d.name, target: '', enabled: true, state: this.streaming ? 'live' : 'off', since: 0, kbps: 0, restarts: 0, lastError: '' })),
      },
      urls: this.ingestUrls(),
      summary: this.stats.summary(this.now()),
      events: this.stats.recent(30),
    };
  }
}
