// Pure logic. No React, no network. Tested with node --test.
export type Signal = 'live' | 'low' | 'offline';
export type Scene = 'live' | 'low' | 'brb';

export interface Status {
  mode: 'auto' | 'manual';
  obs: { connected: boolean; scene: string | null; streaming: boolean; reconnecting?: boolean; timecode?: string };
  ingest: { state: Signal; kbps: number; ready: boolean; reason?: string };
  summary?: Record<string, unknown>;
  events?: Array<{ t: number; type?: string; kind?: string; msg?: string; message?: string }>;
}

export const COLORS = { hull: '#0E2A2F', bone: '#F3EEE4', buoy: '#FF5B1F', mint: '#7BDDB0', lamp: '#F5B83D', card: '#FBF8F1', line: '#D9D1C0', muted: '#5B6E70', onDark: '#9FB3B0' };

export const WORDS: Record<Signal, { word: string; color: string; tilt: number }> = {
  live: { word: 'Live.', color: COLORS.mint, tilt: 6 },
  low: { word: 'Weak signal.', color: COLORS.lamp, tilt: 12 },
  offline: { word: 'Holding on.', color: COLORS.buoy, tilt: 18 },
};

export function describe(s: Pick<Status, 'ingest'>) {
  const w = WORDS[s.ingest.state] ?? WORDS.offline;
  return { ...w, kbps: Math.max(0, Math.round(s.ingest.kbps || 0)) };
}

export function formatKbps(k: number): string {
  if (k >= 1000) return (k / 1000).toFixed(1) + ' Mbps';
  return Math.round(k) + ' kbps';
}

export function normalizeUrl(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    return u.origin;
  } catch {
    return null;
  }
}

/** Parse a keel:// share link: keel://connect?url=...&token=... */
export function parseShareLink(link: string): { url: string; token: string } | null {
  const m = /^keel:\/\/connect\?(.*)$/i.exec(link.trim());
  if (!m) return null;
  const p = new URLSearchParams(m[1]);
  const url = normalizeUrl(p.get('url') ?? '');
  const token = p.get('token') ?? '';
  return url && token ? { url, token } : null;
}

/** Backoff for reconnects: 1s, 2s, 4s ... capped at 15s. */
export function backoffMs(attempt: number): number {
  return Math.min(15000, 1000 * 2 ** Math.max(0, attempt));
}
