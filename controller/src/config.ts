// All configuration comes from environment variables so the same image runs anywhere.
// Every variable is documented in stack/.env.example.

export interface Destination {
  /** Short stable id, used by the API and the dashboard. */
  id: string;
  /** Display name, e.g. "Twitch". */
  name: string;
  /** Full output URL including the stream key, e.g. rtmp://live.twitch.tv/app/live_123. */
  url: string;
}

export interface Thresholds {
  lowKbps: number;
  offlineKbps: number;
  degradeLowS: number;
  degradeOfflineS: number;
  recoverS: number;
  windowS: number;
  /** SRT only. Unrecoverable (dropped) packets above this percent count as a weak signal. 0 disables. */
  maxDropPct: number;
  /** SRT only. Lost packets (before retransmission) above this percent count as a weak signal. 0 disables. */
  maxLossPct: number;
}

export interface SourceConfig {
  id: 'primary' | 'backup';
  label: string;
  /** mediamtx path the encoder publishes to, e.g. live/abc... */
  path: string;
  /** URL OBS uses to pull this feed from the ingest server. */
  readUrl: string;
  /** OBS input name for this feed. */
  inputName: string;
}

export interface Config {
  obsUrl: string;
  obsPassword: string;

  mediamtxApi: string;
  /** Primary ingest path. Kept for compatibility, same as sources[0].path. */
  ingestPath: string;
  /** Primary read URL. Same as sources[0].readUrl. */
  readUrl: string;
  /** Primary and (optional) backup ingest. Keel fails over between them automatically. */
  sources: SourceConfig[];
  pollMs: number;

  /** Output canvas. Must match the OBS profile (KEEL_RESOLUTION and KEEL_FPS are read by both). */
  width: number;
  height: number;
  fps: number;
  /** OBS media source network buffer. Lower is lower latency, higher rides out more jitter. */
  inputBufferMb: number;

  scenes: { live: string; low: string; brb: string };
  thresholds: Thresholds;

  /**
   * relay (default): OBS sends to a local path, Keel's relay pushes it to every destination with its own
   * reconnects, and covers OBS crashes with the BRB screen. direct: OBS streams straight to one destination.
   */
  outputMode: 'relay' | 'direct';
  destinations: Destination[];
  /** Local mediamtx path OBS publishes the finished program to in relay mode. */
  outPath: string;
  /** Seconds the program feed may be missing before the relay switches destinations to the BRB screen. */
  shieldDelayS: number;
  ffmpegPath: string;
  /** Legacy single destination (direct mode). Derived from destinations[0] if not set. */
  rtmpUrl: string;
  streamKey: string;
  /** Try to restart a broadcast that stopped without anyone asking. */
  autoRestart: boolean;

  apiPort: number;
  apiToken: string;
  /** Optional second token for moderators: can switch scenes and sources, cannot stop the broadcast or change settings. */
  modToken: string;
  publicDir: string;
  dataDir: string;

  twitch: {
    enabled: boolean;
    wsUrl: string;
    channel: string;
    botName: string;
    token: string;
    allowedUsers: string[];
  };

  /** Discord or Slack compatible webhook for crew alerts. */
  notifyWebhook: string;

  idle: { minutes: number; action: 'log' | 'exit' | 'webhook'; webhook: string };

  /** Public hostnames/ports, only used to print ingest URLs on the dashboard. */
  publicHost: string;
  publicRtmpPort: number;
  publicSrtPort: number;
  publicSrtlaPort: number;

  /** Local file paths inside the OBS container (and the controller, for the crash shield). */
  brbImage: string;
  lowImage: string;
}

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${v}"`);
  return n;
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = (env[key] ?? '').toLowerCase();
  if (v === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new Error(`${key} must be true or false, got "${env[key]}"`);
}

function idleAction(v: string): 'log' | 'exit' | 'webhook' {
  if (v === 'log' || v === 'exit' || v === 'webhook') return v;
  throw new Error(`KEEL_IDLE_ACTION must be log, exit or webhook, got "${v}"`);
}

const RESOLUTIONS: Record<string, [number, number]> = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
};

export function resolution(v: string): [number, number] {
  const r = RESOLUTIONS[v.toLowerCase()];
  if (!r) throw new Error(`KEEL_RESOLUTION must be one of ${Object.keys(RESOLUTIONS).join(', ')}, got "${v}"`);
  return r;
}

export function joinUrl(base: string, key: string): string {
  if (!key) return base;
  return base.replace(/\/+$/, '') + '/' + key.replace(/^\/+/, '');
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dest';

/**
 * KEEL_DESTINATIONS: entries separated by ";" or new lines, each "Name=url-with-key".
 *   Twitch=rtmp://live.twitch.tv/app/live_123;Kick=rtmps://fa723fc1b171.global-contribute.live-video.net/app/sk_456
 */
export function parseDestinations(raw: string): Destination[] {
  const out: Destination[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    const name = i > 0 && !/^[a-z]+:\/\//i.test(part) ? part.slice(0, i).trim() : `Destination ${out.length + 1}`;
    const url = i > 0 && !/^[a-z]+:\/\//i.test(part) ? part.slice(i + 1).trim() : part;
    if (!/^(rtmps?|srt):\/\/\S+$/i.test(url)) throw new Error(`KEEL_DESTINATIONS: "${name}" needs an rtmp://, rtmps:// or srt:// URL`);
    let id = slug(name);
    while (seen.has(id)) id += '-2';
    seen.add(id);
    out.push({ id, name, url });
  }
  return out;
}

/** Hide the stream key part of a destination URL for display. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'srt:') return `${u.protocol}//${u.host}${u.pathname}?…`;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 1) parts[parts.length - 1] = '••••' + parts[parts.length - 1]!.slice(-4);
    return `${u.protocol}//${u.host}/${parts.join('/')}`;
  } catch {
    return 'invalid url';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ingestPath = str(env, 'KEEL_INGEST_PATH', 'live/change-me');
  const readBase = str(env, 'KEEL_READ_BASE', 'rtmp://mediamtx:1935');
  const readUrl = str(env, 'KEEL_READ_URL', `${readBase}/${ingestPath}`);
  const backupSetting = str(env, 'KEEL_BACKUP_INGEST_PATH', `${ingestPath}-backup`);
  const sources: SourceConfig[] = [{ id: 'primary', label: 'Primary', path: ingestPath, readUrl, inputName: 'Keel Ingest' }];
  if (backupSetting !== 'off' && backupSetting !== ingestPath) {
    sources.push({ id: 'backup', label: 'Backup', path: backupSetting, readUrl: `${readBase}/${backupSetting}`, inputName: 'Keel Backup Ingest' });
  }

  const twitchToken = str(env, 'KEEL_TWITCH_TOKEN', '');
  const twitchChannel = str(env, 'KEEL_TWITCH_CHANNEL', '').toLowerCase().replace(/^#/, '');

  const legacyUrl = str(env, 'KEEL_RTMP_URL', '');
  const legacyKey = str(env, 'KEEL_STREAM_KEY', '');
  const destinations = parseDestinations(str(env, 'KEEL_DESTINATIONS', ''));
  if (!destinations.length && legacyUrl) {
    destinations.push({ id: 'main', name: str(env, 'KEEL_DESTINATION_NAME', 'Main'), url: joinUrl(legacyUrl, legacyKey) });
  }
  const outputMode = str(env, 'KEEL_OUTPUT_MODE', 'relay');
  if (outputMode !== 'relay' && outputMode !== 'direct') throw new Error(`KEEL_OUTPUT_MODE must be relay or direct, got "${outputMode}"`);

  const [width, height] = resolution(str(env, 'KEEL_RESOLUTION', '1080p'));

  return {
    obsUrl: str(env, 'KEEL_OBS_URL', 'ws://obs:4455'),
    obsPassword: str(env, 'KEEL_OBS_PASSWORD', ''),

    mediamtxApi: str(env, 'KEEL_MEDIAMTX_API', 'http://mediamtx:9997'),
    ingestPath,
    readUrl,
    sources,
    pollMs: num(env, 'KEEL_POLL_MS', 1000),

    width,
    height,
    fps: num(env, 'KEEL_FPS', 30),
    inputBufferMb: num(env, 'KEEL_INPUT_BUFFER_MB', 1),

    scenes: {
      live: str(env, 'KEEL_SCENE_LIVE', 'LIVE'),
      low: str(env, 'KEEL_SCENE_LOW', 'LOW SIGNAL'),
      brb: str(env, 'KEEL_SCENE_BRB', 'BRB'),
    },
    thresholds: {
      lowKbps: num(env, 'KEEL_LOW_KBPS', 800),
      offlineKbps: num(env, 'KEEL_OFFLINE_KBPS', 50),
      degradeLowS: num(env, 'KEEL_DEGRADE_LOW_S', 3),
      degradeOfflineS: num(env, 'KEEL_DEGRADE_OFFLINE_S', 2),
      recoverS: num(env, 'KEEL_RECOVER_S', 5),
      windowS: num(env, 'KEEL_WINDOW_S', 2),
      maxDropPct: num(env, 'KEEL_MAX_DROP_PCT', 2),
      maxLossPct: num(env, 'KEEL_MAX_LOSS_PCT', 20),
    },

    outputMode,
    destinations,
    outPath: str(env, 'KEEL_OUT_PATH', 'out/' + ingestPath.replace(/^live\//, '')),
    shieldDelayS: num(env, 'KEEL_SHIELD_DELAY_S', 3),
    ffmpegPath: str(env, 'KEEL_FFMPEG', 'ffmpeg'),
    rtmpUrl: legacyUrl || (destinations[0]?.url ?? ''),
    streamKey: legacyUrl ? legacyKey : '',
    autoRestart: bool(env, 'KEEL_AUTO_RESTART', true),

    apiPort: num(env, 'KEEL_API_PORT', 8080),
    apiToken: str(env, 'KEEL_API_TOKEN', ''),
    modToken: str(env, 'KEEL_MOD_TOKEN', ''),
    publicDir: str(env, 'KEEL_PUBLIC_DIR', new URL('../public', import.meta.url).pathname),
    dataDir: str(env, 'KEEL_DATA_DIR', './data'),

    twitch: {
      enabled: twitchToken !== '' && twitchChannel !== '',
      wsUrl: str(env, 'KEEL_TWITCH_WS', 'wss://irc-ws.chat.twitch.tv:443'),
      channel: twitchChannel,
      botName: str(env, 'KEEL_TWITCH_BOT_NAME', twitchChannel).toLowerCase(),
      token: twitchToken,
      allowedUsers: str(env, 'KEEL_TWITCH_ALLOWED', '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    },

    notifyWebhook: str(env, 'KEEL_NOTIFY_WEBHOOK', ''),

    idle: {
      minutes: num(env, 'KEEL_IDLE_MINUTES', 15),
      action: idleAction(str(env, 'KEEL_IDLE_ACTION', 'log')),
      webhook: str(env, 'KEEL_IDLE_WEBHOOK', ''),
    },

    publicHost: str(env, 'KEEL_PUBLIC_HOST', 'localhost'),
    publicRtmpPort: num(env, 'KEEL_PUBLIC_RTMP_PORT', 1935),
    publicSrtPort: num(env, 'KEEL_PUBLIC_SRT_PORT', 8890),
    publicSrtlaPort: num(env, 'KEEL_PUBLIC_SRTLA_PORT', 5000),

    brbImage: str(env, 'KEEL_BRB_IMAGE', '/assets/brb.png'),
    lowImage: str(env, 'KEEL_LOW_IMAGE', '/assets/low.png'),
  };
}
