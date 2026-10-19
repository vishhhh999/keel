import { loadConfig } from './config.ts';
import { ObsClient } from './obs.ts';
import { IngestMonitor } from './ingest.ts';
import { Stats } from './stats.ts';
import { Keel } from './keel.ts';
import { createApi } from './api.ts';
import { TwitchBot } from './twitch.ts';
import { Relay } from './relay.ts';
import { Notifier } from './notify.ts';
import { SettingsStore } from './settings.ts';

const cfg = loadConfig();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

if (!cfg.apiToken) log('WARNING: KEEL_API_TOKEN is empty, the dashboard and API are open to anyone who can reach the port.');
if (cfg.idle.action === 'webhook' && !cfg.idle.webhook) log('WARNING: KEEL_IDLE_ACTION=webhook but KEEL_IDLE_WEBHOOK is empty, idle shutdown will only log.');
if (cfg.ingestPath === 'live/change-me') log('WARNING: KEEL_INGEST_PATH is the default. Set a long random value so strangers cannot publish to your stream.');
if (!cfg.destinations.length) log('WARNING: no destination set (KEEL_DESTINATIONS or KEEL_RTMP_URL). Go live will be refused.');
if (cfg.outputMode === 'direct' && cfg.destinations.length > 1) log('WARNING: KEEL_OUTPUT_MODE=direct sends to the first destination only. Use relay to multistream.');

const stats = new Stats(cfg.dataDir);
const obs = new ObsClient(cfg.obsUrl, cfg.obsPassword);
const monitor = (path: string) => new IngestMonitor({ apiUrl: cfg.mediamtxApi, path, intervalMs: cfg.pollMs, windowS: cfg.thresholds.windowS });
const ingests = cfg.sources.map((s) => monitor(s.path));

const relayMode = cfg.outputMode === 'relay' && cfg.destinations.length > 0;
const program = relayMode ? monitor(cfg.outPath) : null;
const relay = relayMode
  ? new Relay(
      {
        inputUrl: `rtmp://mediamtx:1935/${cfg.outPath}`,
        brbImage: cfg.brbImage,
        fps: cfg.fps,
        width: cfg.width,
        height: cfg.height,
        shieldDelayS: cfg.shieldDelayS,
        ffmpeg: cfg.ffmpegPath,
        checkInput: () => program!.poll().then((s) => s.ready || s.apiError),
      },
      cfg.destinations,
    )
  : null;
const notifier = new Notifier(cfg.notifyWebhook);

const keel = new Keel(cfg, obs, ingests, stats, Date.now, { relay, program, notifier, settings: new SettingsStore(cfg.dataDir || null) });

keel.on('log', log);
obs.on('connected', () => log('OBS connected'));
obs.on('disconnected', () => log('OBS disconnected, retrying'));
log(`sources: ${cfg.sources.map((s) => `${s.id}=${s.path}`).join(', ')}`);
log(`output: ${relayMode ? `relay to ${cfg.destinations.map((d) => d.name).join(', ')}` : 'direct'}${notifier.enabled ? ', crew alerts on' : ''}`);

let bot: TwitchBot | null = null;
if (cfg.twitch.enabled) {
  bot = new TwitchBot(
    {
      wsUrl: cfg.twitch.wsUrl,
      channel: cfg.twitch.channel,
      botName: cfg.twitch.botName,
      token: cfg.twitch.token,
      allowedUsers: cfg.twitch.allowedUsers,
    },
    {
      status: () => keel.statusLine(),
      setScene: (k) => keel.setScene(k),
      setAuto: () => keel.setAuto(),
      setSource: (p) => keel.setSource(p),
      startStream: () => keel.startStream(),
      stopStream: () => keel.stopStream(),
    },
  );
  keel.on('signal', (d: { state: string; previous: string; reason: string }) => {
    if (d.state === 'offline') bot?.say('Keel: signal lost, holding the stream on BRB.');
    else if (d.state === 'low') bot?.say('Keel: signal is weak.');
    else if (d.state === 'live' && d.previous !== 'live') bot?.say('Keel: signal restored, back on air.');
  });
  keel.on('failover', (src: string) => bot?.say(src === 'backup' ? 'Keel: primary feed failed, switched to backup.' : 'Keel: back on the primary feed.'));
  bot.connect();
  log(`Twitch bot joining #${cfg.twitch.channel}`);
}

keel.on('idle', async (minutes: number) => {
  log(`idle for ${minutes} minutes (no feed, not broadcasting, no dashboard activity)`);
  if (cfg.idle.action === 'webhook' && cfg.idle.webhook) {
    try {
      await fetch(cfg.idle.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'idle', minutes }), signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      log(`idle webhook failed: ${(e as Error).message}`);
    }
  } else if (cfg.idle.action === 'exit') {
    process.exit(0);
  }
});

const server = createApi(keel, { token: cfg.apiToken, modToken: cfg.modToken, publicDir: cfg.publicDir });
server.listen(cfg.apiPort, () => log(`Keel controller listening on :${cfg.apiPort}`));

obs.connect();
for (const m of ingests) m.start();
program?.start();
keel.start();

const shutdown = () => {
  log('shutting down');
  bot?.close();
  relay?.stop();
  obs.close();
  for (const m of ingests) m.stop();
  program?.stop();
  keel.stop();
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
