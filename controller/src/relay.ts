// Multistream relay and crash shield.
//
// OBS sends one finished program to a local mediamtx path. The relay runs one
// ffmpeg per destination that copies that program to Twitch, Kick, YouTube or
// any RTMP/SRT URL. Each destination reconnects on its own, so one platform
// having a bad minute never touches the others, and never touches OBS.
//
// Crash shield: if the program feed disappears while the broadcast should be
// up (OBS crashed, restarted, or hung), every destination switches to an
// encoded Be right back screen until the program returns. The platforms keep
// receiving video instead of ending the stream.

import { EventEmitter } from 'node:events';
import { spawn as nodeSpawn } from 'node:child_process';
import type { Destination } from './config.ts';
import { redactUrl } from './config.ts';

export type DestState = 'off' | 'disabled' | 'connecting' | 'live' | 'shield' | 'retrying';

export interface DestStatus {
  id: string;
  name: string;
  target: string;
  enabled: boolean;
  state: DestState;
  since: number;
  kbps: number;
  restarts: number;
  lastError: string;
}

export interface ChildLike {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', fn: (code: number | null) => void): unknown;
}
export type SpawnFn = (cmd: string, args: string[]) => ChildLike;

export interface RelayOptions {
  inputUrl: string;
  brbImage: string;
  fps: number;
  width: number;
  height: number;
  shieldDelayS: number;
  ffmpeg?: string;
  spawn?: SpawnFn;
  now?: () => number;
  /** Patience right after Go live, while OBS starts its output. Default 10 s. */
  startGraceS?: number;
  /** Seconds the program must stay back before leaving the crash shield, so a flapping OBS does not cause two reconnects. Default 2. */
  returnStableS?: number;
  /** Fast, direct check of the program path. When a copy dies, this decides between "OBS is gone, shield now" and "platform problem, retry". */
  checkInput?: () => Promise<boolean>;
  /** Override backoff for tests. */
  backoffMs?: (attempt: number) => number;
}

type Mode = 'copy' | 'shield';

interface Dest {
  d: Destination;
  enabled: boolean;
  state: DestState;
  since: number;
  kbps: number;
  restarts: number;
  attempt: number;
  lastError: string;
  proc: ChildLike | null;
  mode: Mode | null;
  startedAt: number;
  retry: NodeJS.Timeout | null;
  bytes: { t: number; size: number } | null;
}

const outFormat = (url: string) => (url.toLowerCase().startsWith('srt://') ? 'mpegts' : 'flv');

export function copyArgs(input: string, url: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-rw_timeout', '5000000',
    // Start sending within about two seconds instead of analysing the input for five. Shorter windows
    // sometimes miss the audio format right after OBS (re)starts, and the copy then fails to start.
    '-analyzeduration', '2000000', '-probesize', '2000000',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
    '-f', outFormat(url), url,
  ];
}

export function shieldArgs(o: { image: string; fps: number; width: number; height: number }, url: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-re', '-loop', '1', '-framerate', String(o.fps), '-i', o.image,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-vf', `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    // zerolatency: no lookahead buffering, so the first frame leaves within a fraction of a second.
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-bf', '0', '-r', String(o.fps), '-g', String(o.fps * 2),
    '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', outFormat(url), url,
  ];
}

export class Relay extends EventEmitter {
  private o: RelayOptions;
  private dests = new Map<string, Dest>();
  private wanted = false;
  private inputReady = false;
  private shieldTimer: NodeJS.Timeout | null = null;
  private returnTimer: NodeJS.Timeout | null = null;
  private shieldOn = false;
  private spawnFn: SpawnFn;
  private now: () => number;
  private backoff: (n: number) => number;

  constructor(o: RelayOptions, destinations: Destination[]) {
    super();
    this.o = o;
    this.spawnFn = o.spawn ?? ((cmd, args) => nodeSpawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }));
    this.now = o.now ?? Date.now;
    this.backoff = o.backoffMs ?? ((n) => Math.min(10_000, 1000 * 2 ** n));
    for (const d of destinations) this.dests.set(d.id, this.fresh(d));
  }

  private fresh(d: Destination): Dest {
    return { d, enabled: true, state: 'off', since: this.now(), kbps: 0, restarts: 0, attempt: 0, lastError: '', proc: null, mode: null, startedAt: 0, retry: null, bytes: null };
  }

  get active(): boolean {
    return this.wanted;
  }

  /** Is any destination currently receiving video (program or shield)? */
  get onAir(): boolean {
    for (const x of this.dests.values()) if (x.state === 'live' || x.state === 'shield') return true;
    return false;
  }

  get shielding(): boolean {
    for (const x of this.dests.values()) if (x.mode === 'shield' && x.proc) return true;
    return false;
  }

  start(): void {
    this.wanted = true;
    // Right after Go live OBS is still starting its output and the platforms have seen nothing yet,
    // so wait the longer start grace before covering with BRB (avoids a BRB flash and an extra reconnect).
    if (!this.inputReady) this.armShield(Math.max(this.o.shieldDelayS, this.o.startGraceS ?? 10));
    for (const x of this.dests.values()) this.ensure(x);
    this.emit('change');
  }

  stop(): void {
    this.wanted = false;
    if (this.shieldTimer) clearTimeout(this.shieldTimer);
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.shieldTimer = this.returnTimer = null;
    this.shieldOn = false;
    for (const x of this.dests.values()) {
      this.kill(x);
      this.set(x, x.enabled ? 'off' : 'disabled');
    }
    this.emit('change');
  }

  /** Called every poll with whether the program feed from OBS is present. */
  setInputReady(ready: boolean): void {
    if (ready === this.inputReady) return;
    this.inputReady = ready;
    if (!this.wanted) return;
    if (ready) {
      if (this.shieldTimer) clearTimeout(this.shieldTimer);
      this.shieldTimer = null;
      // Nothing on air yet (start of the broadcast): go straight to the program.
      if (!this.shieldOn) return this.toProgram();
      // Leaving the shield costs a reconnect on every platform, so only do it once OBS has stayed back.
      if (this.returnTimer) return;
      this.returnTimer = setTimeout(() => {
        this.returnTimer = null;
        if (this.wanted && this.inputReady) this.toProgram();
      }, (this.o.returnStableS ?? 2) * 1000);
      this.returnTimer.unref?.();
    } else {
      if (this.returnTimer) clearTimeout(this.returnTimer);
      this.returnTimer = null;
      this.armShield();
    }
  }

  private toProgram(): void {
    for (const x of this.dests.values()) if (x.enabled && x.mode !== 'copy') this.restart(x);
    if (this.shieldOn) {
      this.shieldOn = false;
      this.emit('shield', false);
    }
  }

  private shieldNow(): void {
    if (!this.shieldOn) {
      this.shieldOn = true;
      this.emit('shield', true);
    }
  }

  private armShield(delayS = this.o.shieldDelayS): void {
    if (this.shieldTimer) return;
    this.shieldTimer = setTimeout(() => {
      this.shieldTimer = null;
      if (!this.wanted || this.inputReady) return;
      for (const x of this.dests.values()) if (x.enabled && x.mode !== 'shield') this.restart(x);
      this.shieldNow();
    }, delayS * 1000);
    this.shieldTimer.unref?.();
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const x = this.dests.get(id);
    if (!x) return false;
    x.enabled = enabled;
    if (!enabled) {
      this.kill(x);
      this.set(x, 'disabled');
    } else if (this.wanted) {
      x.attempt = 0;
      this.ensure(x);
    } else {
      this.set(x, 'off');
    }
    this.emit('change');
    return true;
  }

  status(): DestStatus[] {
    return [...this.dests.values()].map((x) => ({
      id: x.d.id,
      name: x.d.name,
      target: redactUrl(x.d.url),
      enabled: x.enabled,
      state: x.state,
      since: x.since,
      kbps: Math.round(x.kbps),
      restarts: x.restarts,
      lastError: x.lastError,
    }));
  }

  private wantMode(): Mode {
    return this.inputReady ? 'copy' : 'shield';
  }

  private ensure(x: Dest): void {
    if (!this.wanted || !x.enabled || x.proc || x.retry) return;
    // Before the shield delay has passed, wait for the program instead of shielding instantly.
    if (!this.inputReady && this.shieldTimer) {
      this.set(x, 'connecting');
      return;
    }
    this.spawn(x, this.wantMode());
  }

  private restart(x: Dest): void {
    this.kill(x);
    x.attempt = 0;
    this.spawn(x, this.wantMode());
  }

  private spawn(x: Dest, mode: Mode): void {
    const args = mode === 'copy' ? copyArgs(this.o.inputUrl, x.d.url) : shieldArgs({ image: this.o.brbImage, fps: this.o.fps, width: this.o.width, height: this.o.height }, x.d.url);
    let child: ChildLike;
    try {
      child = this.spawnFn(this.o.ffmpeg ?? 'ffmpeg', args);
    } catch (e) {
      x.lastError = (e as Error).message;
      this.scheduleRetry(x);
      return;
    }
    x.proc = child;
    x.mode = mode;
    x.startedAt = this.now();
    x.bytes = null;
    x.kbps = 0;
    this.set(x, 'connecting');

    let buf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        this.progress(x, child, line);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim().split('\n').pop() ?? '';
      if (line) x.lastError = redactSecrets(line, x.d.url).slice(0, 200);
    });
    child.on('exit', (code) => {
      if (x.proc !== child) return; // replaced on purpose
      const was = x.mode;
      x.proc = null;
      x.mode = null;
      x.kbps = 0;
      if (!this.wanted || !x.enabled) return;
      if (code !== 0 && !x.lastError) x.lastError = `ffmpeg exited with code ${code}`;
      if (was === 'copy' && this.o.checkInput) {
        // The copy died. If the program is gone (OBS crashed), cover with the shield immediately
        // instead of waiting for the next poll; otherwise it is the platform, so retry.
        this.o.checkInput().then(
          (ok) => this.afterCopyExit(x, ok),
          () => this.afterCopyExit(x, true),
        );
        return;
      }
      this.scheduleRetry(x);
    });
  }

  private afterCopyExit(x: Dest, programOk: boolean): void {
    if (!this.wanted || !x.enabled || x.proc || x.retry) return;
    if (programOk) return this.scheduleRetry(x);
    this.inputReady = false;
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = null;
    if (this.shieldTimer) clearTimeout(this.shieldTimer);
    this.shieldTimer = null;
    this.spawn(x, 'shield');
    this.shieldNow();
  }

  private progress(x: Dest, child: ChildLike, line: string): void {
    if (x.proc !== child) return;
    const [k, v] = line.split('=');
    if (k === 'total_size') {
      const size = Number(v);
      const t = this.now();
      if (Number.isFinite(size)) {
        if (x.bytes && t > x.bytes.t) x.kbps = ((size - x.bytes.size) * 8) / (t - x.bytes.t);
        x.bytes = { t, size };
      }
    } else if (k === 'progress' && v === 'continue') {
      const want: DestState = x.mode === 'shield' ? 'shield' : 'live';
      if (x.state !== want) {
        const wasRetrying = x.restarts > 0 && x.state !== 'live';
        this.set(x, want);
        if (want === 'live' && wasRetrying) this.emit('recovered', x.d);
      }
      // A connection that has held for 10 s resets the backoff.
      if (this.now() - x.startedAt > 10_000) x.attempt = 0;
    }
  }

  private scheduleRetry(x: Dest): void {
    x.restarts++;
    const wait = this.backoff(x.attempt++);
    this.set(x, 'retrying');
    this.emit('retry', x.d, wait);
    x.retry = setTimeout(() => {
      x.retry = null;
      this.ensure(x);
    }, wait);
    x.retry.unref?.();
  }

  private kill(x: Dest): void {
    if (x.retry) clearTimeout(x.retry);
    x.retry = null;
    const p = x.proc;
    x.proc = null;
    x.mode = null;
    x.kbps = 0;
    if (p) p.kill('SIGTERM');
  }

  private set(x: Dest, s: DestState): void {
    if (x.state === s) return;
    x.state = s;
    x.since = this.now();
    this.emit('change');
  }
}

/** ffmpeg errors can echo the output URL. Never let the stream key reach logs or the dashboard. */
export function redactSecrets(line: string, url: string): string {
  return line.split(url).join(redactUrl(url));
}
