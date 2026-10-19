import { loadConfig } from './config.ts';
import { ObsClient } from './obs.ts';
import { IngestMonitor } from './ingest.ts';
import { Stats } from './stats.ts';
import { Keel } from './keel.ts';
import { createApi } from './api.ts';
import { TwitchBot } from './twitch.ts';

const cfg = loadConfig();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

if (!cfg.apiToken) log('WARNING: KEEL_API_TOKEN is empty, the dashboard and API are open to anyone who can reach the port.');
if (cfg.ingestPath === 'live/change-me') log('WARNING: KEEL_INGEST_PATH is the default. Set a long random value so strangers cannot publish to your stream.');

const stats = new Stats(cfg.dataDir);
const obs = new ObsClient(cfg.obsUrl, cfg.obsPassword);
const ingest = new IngestMonitor({
  apiUrl: cfg.mediamtxApi,
  path: cfg.ingestPath,
  intervalMs: cfg.pollMs,
  windowS: cfg.thresholds.windowS,
});
const keel = new Keel(cfg, obs, ingest, stats);

keel.on('log', log);
obs.on('connected', () => log('OBS connected'));
obs.on('disconnected', () => log('OBS disconnected, retrying'));

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
      startStream: () => keel.startStream(),
      stopStream: () => keel.stopStream(),
    },
  );
  keel.on('signal', (d: { state: string; previous: string; reason: string }) => {
    if (d.state === 'offline') bot?.say('Keel: signal lost, holding the stream on BRB.');
    else if (d.state === 'low') bot?.say('Keel: signal is weak.');
    else if (d.state === 'live' && d.previous !== 'live') bot?.say('Keel: signal restored, back on air.');
  });
  bot.connect();
  log(`Twitch bot joining #${cfg.twitch.channel}`);
}

keel.on('idle', async (minutes: number) => {
  log(`idle for ${minutes} minutes (no feed, not broadcasting, no dashboard activity)`);
  if (cfg.idle.action === 'webhook' && cfg.idle.webhook) {
    try {
      await fetch(cfg.idle.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'idle', minutes }) });
    } catch (e) {
      log(`idle webhook failed: ${(e as Error).message}`);
    }
  } else if (cfg.idle.action === 'exit') {
    process.exit(0);
  }
});

const server = createApi(keel, { token: cfg.apiToken, publicDir: cfg.publicDir });
server.listen(cfg.apiPort, () => log(`Keel controller listening on :${cfg.apiPort}`));

obs.connect();
ingest.start();
keel.start();

const shutdown = () => {
  log('shutting down');
  bot?.close();
  obs.close();
  ingest.stop();
  keel.stop();
  server.close();
  setTimeout(() => process.exit(0), 200).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
