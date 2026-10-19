// The brain. Connects the ingest monitor, the switcher and OBS, and exposes
// one status snapshot and a small set of actions to the dashboard and chat bot.

import { EventEmitter } from 'node:events';
import type { Config } from './config.ts';
import type { IngestSample } from './ingest.ts';
import { Switcher, type SignalState } from './switcher.ts';
import type { Stats } from './stats.ts';
import { bootstrapObs } from './bootstrap.ts';

export const VERSION = '0.2.0';

export type SceneKey = 'live' | 'low' | 'brb';
export type Mode = 'auto' | 'manual';

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

export interface HistoryPoint {
  t: number;
  kbps: number;
  state: SignalState;
  scene: string | null;
  streaming: boolean;
}

const HISTORY_MAX = 600;
const STATE_TO_SCENE: Record<SignalState, SceneKey> = { live: 'live', low: 'low', offline: 'brb' };

export class Keel extends EventEmitter {
  mode: Mode = 'auto';
  signal: SignalState = 'offline';
  signalReason = 'waiting for feed';
  scene: string | null = null;
  streaming = false;
  reconnecting = false;
  synced = false;
  streamInfo = { timecode: '', skippedFrames: 0, totalFrames: 0 };
  history: HistoryPoint[] = [];
  private lastActivity: number;
  private idleFired = false;
  private stopRequested = false;
  private switcher: Switcher;
  private cfg: Config;
  private obs: ObsPort;
  private ingest: IngestPort;
  private stats: Stats;
  private now: () => number;
  private streamPoll: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(cfg: Config, obs: ObsPort, ingest: IngestPort, stats: Stats, now: () => number = Date.now) {
    super();
    this.cfg = cfg;
    this.obs = obs;
    this.ingest = ingest;
    this.stats = stats;
    this.now = now;
    this.lastActivity = now();
    this.switcher = new Switcher({
      lowKbps: cfg.thresholds.lowKbps,
      offlineKbps: cfg.thresholds.offlineKbps,
      degradeLowS: cfg.thresholds.degradeLowS,
      degradeOfflineS: cfg.thresholds.degradeOfflineS,
      recoverS: cfg.thresholds.recoverS,
    });
  }

  start(): void {
    this.obs.on('connected', () => void this.onObsConnected());
    this.obs.on('disconnected', () => {
      this.synced = false;
      this.stats.obs('disconnected', this.now());
      this.emit('change');
    });
    this.obs.on('obs-event', (type: string, data: any) => this.onObsEvent(type, data));
    this.ingest.on('sample', (s) => this.onSample(s));
    this.streamPoll = setInterval(() => void this.refreshStream(), 3000);
    this.idleTimer = setInterval(() => this.checkIdle(), 10_000);
  }

  stop(): void {
    if (this.streamPoll) clearInterval(this.streamPoll);
    if (this.idleTimer) clearInterval(this.idleTimer);
  }

  touch(): void {
    this.lastActivity = this.now();
    this.idleFired = false;
  }

  private sceneName(key: SceneKey): string {
    return this.cfg.scenes[key];
  }

  private async onObsConnected(): Promise<void> {
    try {
      await bootstrapObs(this.obs, this.cfg);
      this.scene = await this.obs.getScene();
      await this.refreshStream();
      this.synced = true;
      this.stats.obs('connected', this.now());
      // Whatever the signal looked like before, re-apply it to the fresh OBS.
      this.switcher.reset(this.signal);
      await this.applyAuto();
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
      if (!was && this.streaming) this.stats.stream('started', this.now());
      if (was && !this.streaming) {
        this.stats.stream(this.stopRequested ? 'stopped' : 'unexpected_stop', this.now());
        this.stopRequested = false;
      }
      this.emit('change');
    }
  }

  private onSample(s: IngestSample): void {
    const d = this.switcher.update(s);
    if (s.ready || this.streaming) this.touch();
    if (d.changed) {
      this.signal = d.state;
      this.signalReason = d.reason;
      this.stats.signal(d.state, d.reason, this.now());
      this.emit('log', `signal ${d.previous} -> ${d.state} (${d.reason})`);
      this.emit('signal', d);
      void this.applyAuto();
    }
    this.history.push({ t: s.t, kbps: Math.round(s.kbps), state: this.signal, scene: this.scene, streaming: this.streaming });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.emit('sample', s);
    this.emit('change');
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
    if (this.idleFired || this.cfg.idle.minutes <= 0) return;
    if (this.now() - this.lastActivity >= this.cfg.idle.minutes * 60_000) {
      this.idleFired = true;
      this.emit('idle', this.cfg.idle.minutes);
    }
  }

  // ---- actions (dashboard, chat) ----

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

  async startStream(): Promise<string> {
    this.touch();
    if (!this.obs.connected) throw new Error('OBS is not connected');
    if (this.streaming) return 'Already live.';
    if (!this.cfg.rtmpUrl) throw new Error('No stream destination configured (KEEL_RTMP_URL)');
    await this.obs.startStream();
    return 'Starting the broadcast.';
  }

  async stopStream(): Promise<string> {
    this.touch();
    if (!this.obs.connected) throw new Error('OBS is not connected');
    if (!this.streaming) return 'Not streaming.';
    this.stopRequested = true;
    await this.obs.stopStream();
    return 'Broadcast stopped.';
  }

  statusLine(): string {
    const s = this.ingest.last;
    const scene = this.scene ?? 'unknown';
    return `Signal ${this.signal.toUpperCase()} (${Math.round(s.kbps)} kbps), scene ${scene}, mode ${this.mode}, ${this.streaming ? 'broadcasting' : 'not broadcasting'}.`;
  }

  ingestUrls(): { rtmp: string; srt: string; srtla: string } {
    const h = this.cfg.publicHost;
    const p = this.cfg.ingestPath;
    return {
      rtmp: `rtmp://${h}:${this.cfg.publicRtmpPort}/${p}`,
      srt: `srt://${h}:${this.cfg.publicSrtPort}?streamid=publish:${p}`,
      srtla: `srtla://${h}:${this.cfg.publicSrtlaPort}?streamid=publish:${p}`,
    };
  }

  status(): Record<string, unknown> {
    const s = this.ingest.last;
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
        thresholds: this.cfg.thresholds,
      },
      urls: this.ingestUrls(),
      summary: this.stats.summary(this.now()),
      events: this.stats.recent(25),
    };
  }
}
