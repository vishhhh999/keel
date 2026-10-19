// Crew alerts. Posts short messages to a Discord or Slack compatible webhook
// (both accept JSON; Discord reads `content`, Slack reads `text`).
// Each alert kind is throttled so a flapping link cannot flood the channel.

export class Notifier {
  private url: string;
  private f: typeof fetch;
  private now: () => number;
  private last = new Map<string, number>();
  private throttleMs: number;
  sent: string[] = [];

  constructor(url: string, opts: { fetchImpl?: typeof fetch; now?: () => number; throttleMs?: number } = {}) {
    this.url = url;
    this.f = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.throttleMs = opts.throttleMs ?? 30_000;
  }

  get enabled(): boolean {
    return this.url !== '';
  }

  /** Returns true if the message was sent (not throttled, webhook configured). */
  send(kind: string, text: string): boolean {
    if (!this.url) return false;
    const t = this.now();
    const prev = this.last.get(kind);
    if (prev !== undefined && t - prev < this.throttleMs) return false;
    this.last.set(kind, t);
    this.sent.push(text);
    if (this.sent.length > 50) this.sent.shift();
    this.f(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text, text, username: 'Keel' }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      /* alerts are best effort, never break the stream for them */
    });
    return true;
  }
}
