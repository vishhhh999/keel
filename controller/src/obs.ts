// Minimal obs-websocket v5 client. OBS Studio 28+ ships the server built in.
// Protocol reference: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 } as const;

// EventSubscription bitmask: General (1) | Scenes (4) | Outputs (64)
const EVENT_SUBSCRIPTIONS = 1 | 4 | 64;

export class ObsRequestError extends Error {
  code: number;
  constructor(type: string, code: number, comment: string) {
    super(`OBS request ${type} failed (${code}): ${comment}`);
    this.code = code;
  }
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export function obsAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(secret + challenge).digest('base64');
}

export class ObsClient extends EventEmitter {
  connected = false;
  private url: string;
  private password: string;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private retryMs = 1000;
  private closing = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(url: string, password: string) {
    super();
    this.url = url;
    this.password = password;
  }

  connect(): void {
    this.closing = false;
    this.open();
  }

  close(): void {
    this.closing = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  private open(): void {
    const ws = new WebSocket(this.url, 'obswebsocket.json');
    this.ws = ws;

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.onMessage(ws, msg);
    });
    ws.on('error', (err) => this.emit('error-soft', err));
    ws.on('close', () => {
      const was = this.connected;
      this.connected = false;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('OBS connection closed'));
        this.pending.delete(id);
      }
      if (was) this.emit('disconnected');
      if (!this.closing) {
        this.retryTimer = setTimeout(() => this.open(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 5000);
      }
    });
  }

  private onMessage(ws: WebSocket, msg: any): void {
    switch (msg.op) {
      case OP.Hello: {
        const identify: any = { rpcVersion: 1, eventSubscriptions: EVENT_SUBSCRIPTIONS };
        const a = msg.d?.authentication;
        if (a) identify.authentication = obsAuth(this.password, a.salt, a.challenge);
        ws.send(JSON.stringify({ op: OP.Identify, d: identify }));
        break;
      }
      case OP.Identified:
        this.connected = true;
        this.retryMs = 1000;
        this.emit('connected');
        break;
      case OP.Event:
        this.emit('obs-event', msg.d?.eventType as string, msg.d?.eventData ?? {});
        break;
      case OP.RequestResponse: {
        const p = this.pending.get(msg.d?.requestId);
        if (!p) return;
        this.pending.delete(msg.d.requestId);
        clearTimeout(p.timer);
        const st = msg.d.requestStatus;
        if (st?.result) p.resolve(msg.d.responseData ?? {});
        else p.reject(new ObsRequestError(msg.d.requestType, st?.code ?? 0, st?.comment ?? ''));
        break;
      }
    }
  }

  request<T = any>(requestType: string, requestData?: object, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.connected) {
        reject(new Error('OBS is not connected'));
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS request ${requestType} timed out`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, requestData } }));
    });
  }

  // Convenience wrappers for the handful of calls Keel needs.
  async getScene(): Promise<string> {
    return (await this.request('GetCurrentProgramScene')).currentProgramSceneName;
  }
  setScene(sceneName: string): Promise<unknown> {
    return this.request('SetCurrentProgramScene', { sceneName });
  }
  async getStreamStatus(): Promise<{ active: boolean; reconnecting: boolean; timecode: string; bytes: number; skippedFrames: number; totalFrames: number }> {
    const r = await this.request('GetStreamStatus');
    return {
      active: r.outputActive,
      reconnecting: r.outputReconnecting,
      timecode: r.outputTimecode,
      bytes: r.outputBytes,
      skippedFrames: r.outputSkippedFrames,
      totalFrames: r.outputTotalFrames,
    };
  }
  startStream(): Promise<unknown> {
    return this.request('StartStream');
  }
  stopStream(): Promise<unknown> {
    return this.request('StopStream');
  }
}
