import type { Scene, Status } from './model';

export class KeelClient {
  readonly base: string;
  private readonly token: string;
  private readonly f: typeof fetch;
  constructor(base: string, token: string, f: typeof fetch = fetch) { this.base = base; this.token = token; this.f = f; }

  private async call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await this.f(this.base + path, {
      method: init?.method ?? 'GET',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 401) throw new Error('Wrong token.');
    if (!res.ok) throw new Error(`Server said ${res.status}.`);
    return (await res.json()) as T;
  }

  status() { return this.call<Status>('/api/status'); }
  history() { return this.call<Array<{ t: number; kbps: number; state: string }>>('/api/history'); }
  setScene(scene: Scene) { return this.call<{ message: string }>('/api/scene', { method: 'POST', body: { scene } }); }
  setMode(mode: 'auto' | 'manual') { return this.call<{ message: string }>('/api/mode', { method: 'POST', body: { mode } }); }
  startStream() { return this.call<{ message: string }>('/api/stream/start', { method: 'POST', body: {} }); }
  stopStream() { return this.call<{ message: string }>('/api/stream/stop', { method: 'POST', body: {} }); }
}
