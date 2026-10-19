// Pure logic. No React, no network. Tested with node --test.
export type Signal = 'live' | 'low' | 'offline';
export type Scene = 'live' | 'low' | 'brb';

export type Pin = 'auto' | 'primary' | 'backup';
export interface Link { rttMs: number | null; lossPct: number | null; dropPct: number | null; bufferMs?: number | null }
export interface Destination { id: string; name: string; state: string; enabled: boolean; kbps: number; restarts: number; lastError?: string }
export interface Source { id: 'primary' | 'backup'; label: string; state: Signal; ready: boolean; kbps: number; active: boolean; link?: Link | null }

export interface Status {
  role?: 'admin' | 'mod';
  mode: 'auto' | 'manual';
  obs: { connected: boolean; scene: string | null; streaming: boolean; reconnecting?: boolean; timecode?: string };
  ingest: { state: Signal; kbps: number; ready: boolean; reason?: string; link?: Link | null; active?: 'primary' | 'backup'; pin?: Pin };
  sources?: Source[];
  broadcast?: { output: 'relay' | 'direct'; wanted: boolean; onAir: boolean; shield: boolean; autoRestarts: number; destinations: Destination[] };
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

/** Link quality chips for the hero card. Levels: '' ok, 'warn', 'bad'. */
export function linkChips(l: Link | null | undefined): { label: string; value: string; level: '' | 'warn' | 'bad' }[] {
  if (!l) return [];
  const out: { label: string; value: string; level: '' | 'warn' | 'bad' }[] = [];
  if (l.rttMs != null) out.push({ label: 'RTT', value: Math.round(l.rttMs) + ' ms', level: l.rttMs > 600 ? 'bad' : l.rttMs > 250 ? 'warn' : '' });
  if (l.lossPct != null) out.push({ label: 'Loss', value: l.lossPct.toFixed(1) + '%', level: l.lossPct > 20 ? 'bad' : l.lossPct > 5 ? 'warn' : '' });
  if (l.dropPct != null) out.push({ label: 'Dropped', value: l.dropPct.toFixed(1) + '%', level: l.dropPct > 2 ? 'bad' : l.dropPct > 0.5 ? 'warn' : '' });
  return out;
}

/** Is the audience receiving video? Relay mode reports it directly; older servers only know OBS streaming. */
export function onAir(s: Pick<Status, 'obs' | 'broadcast'>): boolean {
  return s.broadcast ? s.broadcast.onAir : s.obs.streaming;
}

export const DEST_WORD: Record<string, string> = { live: 'Live', shield: 'Shield', retrying: 'Retrying', connecting: 'Connecting', off: 'Off', disabled: 'Paused' };

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
