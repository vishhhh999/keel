// Builds the OBS scene collection through obs-websocket so nobody has to click
// anything. Idempotent: safe to run on every start, it only creates what is missing.

import type { Config } from './config.ts';
import { ObsRequestError } from './obs.ts';

export interface ObsLike {
  request<T = any>(type: string, data?: object): Promise<T>;
}

/** Scene item ids of each ingest source inside the LIVE and LOW SIGNAL scenes, used for failover. */
export type SourceItems = Record<string, { live: number | null; low: number | null }>;

const RESOURCE_EXISTS = 601;

async function tolerant<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ObsRequestError && e.code === RESOURCE_EXISTS) return undefined;
    throw e;
  }
}

async function fitToCanvas(obs: ObsLike, cfg: Config, sceneName: string, sceneItemId: number): Promise<void> {
  await obs.request('SetSceneItemTransform', {
    sceneName,
    sceneItemId,
    sceneItemTransform: {
      positionX: cfg.width / 2,
      positionY: cfg.height / 2,
      alignment: 0,
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      boundsAlignment: 0,
      boundsWidth: cfg.width,
      boundsHeight: cfg.height,
    },
  });
}

async function itemId(obs: ObsLike, sceneName: string, sourceName: string): Promise<number | null> {
  try {
    return (await obs.request('GetSceneItemId', { sceneName, sourceName })).sceneItemId ?? null;
  } catch {
    return null;
  }
}

/** The stream service OBS should use: the local relay path, or the destination directly. */
export function streamService(cfg: Config): { server: string; key: string } | null {
  if (cfg.outputMode === 'relay') {
    const i = cfg.outPath.indexOf('/');
    return { server: `rtmp://mediamtx:1935/${cfg.outPath.slice(0, i)}`, key: cfg.outPath.slice(i + 1) };
  }
  if (cfg.streamKey) return { server: cfg.rtmpUrl, key: cfg.streamKey };
  const url = cfg.destinations[0]?.url;
  if (!url) return null;
  const j = url.lastIndexOf('/');
  return { server: url.slice(0, j), key: url.slice(j + 1) };
}

export async function bootstrapObs(obs: ObsLike, cfg: Config): Promise<SourceItems> {
  const { live, low, brb } = cfg.scenes;

  // Canvas and frame rate. Fails harmlessly if OBS is already outputting.
  try {
    await obs.request('SetVideoSettings', {
      baseWidth: cfg.width,
      baseHeight: cfg.height,
      outputWidth: cfg.width,
      outputHeight: cfg.height,
      fpsNumerator: cfg.fps,
      fpsDenominator: 1,
    });
  } catch {
    /* output active, keep whatever is configured */
  }

  const existing: string[] = ((await obs.request('GetSceneList')).scenes as { sceneName: string }[]).map((s) => s.sceneName);
  for (const name of [live, low, brb]) {
    if (!existing.includes(name)) await obs.request('CreateScene', { sceneName: name });
  }

  // LIVE and LOW SIGNAL: one media source per ingest (primary, backup). Only the active one is visible.
  for (const [i, src] of cfg.sources.entries()) {
    const input = await tolerant(
      obs.request('CreateInput', {
        sceneName: live,
        inputName: src.inputName,
        inputKind: 'ffmpeg_source',
        inputSettings: {
          input: src.readUrl,
          is_local_file: false,
          buffering_mb: cfg.inputBufferMb,
          reconnect_delay_sec: 1,
          restart_on_activate: false,
          close_when_inactive: false,
          hw_decode: false,
          clear_on_media_end: true,
        },
        sceneItemEnabled: i === 0,
      }),
    );
    if (input) await fitToCanvas(obs, cfg, live, input.sceneItemId);
    const inLow = await tolerant(obs.request('CreateSceneItem', { sceneName: low, sourceName: src.inputName, sceneItemEnabled: i === 0 }));
    if (inLow) await fitToCanvas(obs, cfg, low, inLow.sceneItemId);
  }

  // LOW SIGNAL banner on top of the feed.
  const banner = await tolerant(
    obs.request('CreateInput', {
      sceneName: low,
      inputName: 'Keel Low Signal Banner',
      inputKind: 'image_source',
      inputSettings: { file: cfg.lowImage },
      sceneItemEnabled: true,
    }),
  );
  if (banner) await fitToCanvas(obs, cfg, low, banner.sceneItemId);

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
  if (holding) await fitToCanvas(obs, cfg, brb, holding.sceneItemId);

  // Where the finished program goes.
  const svc = streamService(cfg);
  if (svc) {
    await obs.request('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: svc.server, key: svc.key, use_auth: false },
    });
  }

  const items: SourceItems = {};
  for (const src of cfg.sources) items[src.id] = { live: await itemId(obs, live, src.inputName), low: await itemId(obs, low, src.inputName) };

  // Start safe: never put an unverified feed on air.
  await obs.request('SetCurrentProgramScene', { sceneName: brb });
  return items;
}
