// Builds the OBS scene collection through obs-websocket so nobody has to click
// anything. Idempotent: safe to run on every start, it only creates what is missing.

import type { Config } from './config.ts';
import { ObsRequestError } from './obs.ts';

export interface ObsLike {
  request<T = any>(type: string, data?: object): Promise<T>;
}

const RESOURCE_EXISTS = 601;
const W = 1920;
const H = 1080;
const INGEST_INPUT = 'Keel Ingest';

async function tolerant<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ObsRequestError && e.code === RESOURCE_EXISTS) return undefined;
    throw e;
  }
}

async function fitToCanvas(obs: ObsLike, sceneName: string, sceneItemId: number): Promise<void> {
  await obs.request('SetSceneItemTransform', {
    sceneName,
    sceneItemId,
    sceneItemTransform: {
      positionX: W / 2,
      positionY: H / 2,
      alignment: 0,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsAlignment: 0,
      boundsWidth: W,
      boundsHeight: H,
    },
  });
}

export async function bootstrapObs(obs: ObsLike, cfg: Config): Promise<void> {
  const { live, low, brb } = cfg.scenes;

  // Canvas and frame rate. Fails harmlessly if OBS is already outputting.
  try {
    await obs.request('SetVideoSettings', {
      baseWidth: W,
      baseHeight: H,
      outputWidth: W,
      outputHeight: H,
      fpsNumerator: 30,
      fpsDenominator: 1,
    });
  } catch {
    /* output active, keep whatever is configured */
  }

  const existing: string[] = ((await obs.request('GetSceneList')).scenes as { sceneName: string }[]).map(
    (s) => s.sceneName,
  );
  for (const name of [live, low, brb]) {
    if (!existing.includes(name)) await obs.request('CreateScene', { sceneName: name });
  }

  // LIVE: the phone feed, scaled to fit the canvas.
  const ingest = await tolerant(
    obs.request('CreateInput', {
      sceneName: live,
      inputName: INGEST_INPUT,
      inputKind: 'ffmpeg_source',
      inputSettings: {
        input: cfg.readUrl,
        is_local_file: false,
        buffering_mb: 2,
        reconnect_delay_sec: 1,
        restart_on_activate: true,
        close_when_inactive: false,
        hw_decode: false,
        clear_on_media_end: true,
      },
      sceneItemEnabled: true,
    }),
  );
  if (ingest) await fitToCanvas(obs, live, ingest.sceneItemId);

  // LOW SIGNAL: the same feed with a warning banner on top.
  const itemInLow = await tolerant(
    obs.request('CreateSceneItem', { sceneName: low, sourceName: INGEST_INPUT, sceneItemEnabled: true }),
  );
  if (itemInLow) await fitToCanvas(obs, low, itemInLow.sceneItemId);
  const banner = await tolerant(
    obs.request('CreateInput', {
      sceneName: low,
      inputName: 'Keel Low Signal Banner',
      inputKind: 'image_source',
      inputSettings: { file: cfg.lowImage },
      sceneItemEnabled: true,
    }),
  );
  if (banner) await fitToCanvas(obs, low, banner.sceneItemId);

  // BRB: a full-screen holding image.
  const holding = await tolerant(
    obs.request('CreateInput', {
      sceneName: brb,
      inputName: 'Keel BRB Screen',
      inputKind: 'image_source',
      inputSettings: { file: cfg.brbImage },
      sceneItemEnabled: true,
    }),
  );
  if (holding) await fitToCanvas(obs, brb, holding.sceneItemId);

  // Where the finished broadcast goes.
  if (cfg.rtmpUrl) {
    await obs.request('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: cfg.rtmpUrl, key: cfg.streamKey, use_auth: false },
    });
  }

  // Start safe: never put an unverified feed on air.
  await obs.request('SetCurrentProgramScene', { sceneName: brb });
}
