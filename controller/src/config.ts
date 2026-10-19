// All configuration comes from environment variables so the same image runs anywhere.
// Every variable is documented in stack/.env.example.

export interface Config {
  obsUrl: string;
  obsPassword: string;

  mediamtxApi: string;
  ingestPath: string;
  /** URL OBS uses to pull the phone feed from the ingest server. */
  readUrl: string;
  pollMs: number;
  /** Output frame rate. Must match the OBS profile (KEEL_FPS is read by both). */
  fps: number;

  scenes: { live: string; low: string; brb: string };
  thresholds: {
    lowKbps: number;
    offlineKbps: number;
    degradeLowS: number;
    degradeOfflineS: number;
    recoverS: number;
    windowS: number;
  };

  rtmpUrl: string;
  streamKey: string;

  apiPort: number;
  apiToken: string;
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

  idle: { minutes: number; action: 'log' | 'exit' | 'webhook'; webhook: string };

  /** Public hostnames/ports, only used to print ingest URLs on the dashboard. */
  publicHost: string;
  publicRtmpPort: number;
  publicSrtPort: number;
  publicSrtlaPort: number;

  /** Local file paths *inside the OBS container* for the viewer-facing screens. */
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

function idleAction(v: string): 'log' | 'exit' | 'webhook' {
  if (v === 'log' || v === 'exit' || v === 'webhook') return v;
  throw new Error(`KEEL_IDLE_ACTION must be log, exit or webhook, got "${v}"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ingestPath = str(env, 'KEEL_INGEST_PATH', 'live/change-me');
  const readUrl = str(env, 'KEEL_READ_URL', `rtmp://mediamtx:1935/${ingestPath}`);
  const twitchToken = str(env, 'KEEL_TWITCH_TOKEN', '');
  const twitchChannel = str(env, 'KEEL_TWITCH_CHANNEL', '').toLowerCase().replace(/^#/, '');

  return {
    obsUrl: str(env, 'KEEL_OBS_URL', 'ws://obs:4455'),
    obsPassword: str(env, 'KEEL_OBS_PASSWORD', ''),

    mediamtxApi: str(env, 'KEEL_MEDIAMTX_API', 'http://mediamtx:9997'),
    ingestPath,
    readUrl,
    pollMs: num(env, 'KEEL_POLL_MS', 1000),
    fps: num(env, 'KEEL_FPS', 30),

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
    },

    rtmpUrl: str(env, 'KEEL_RTMP_URL', ''),
    streamKey: str(env, 'KEEL_STREAM_KEY', ''),

    apiPort: num(env, 'KEEL_API_PORT', 8080),
    apiToken: str(env, 'KEEL_API_TOKEN', ''),
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
