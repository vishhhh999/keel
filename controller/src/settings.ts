// Live-editable switching thresholds. Changed from the dashboard or API while
// streaming, applied immediately, and saved so a restart keeps them.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Thresholds } from './config.ts';

export type Editable = Omit<Thresholds, 'windowS'>;

const LIMITS: Record<keyof Editable, [number, number]> = {
  lowKbps: [50, 50_000],
  offlineKbps: [0, 5_000],
  degradeLowS: [0.5, 60],
  degradeOfflineS: [0.5, 60],
  recoverS: [1, 120],
  maxDropPct: [0, 100],
  maxLossPct: [0, 100],
};

export const EDITABLE_KEYS = Object.keys(LIMITS) as (keyof Editable)[];

/** Validate a partial update. Throws with a message fit for the dashboard. */
export function validate(input: Record<string, unknown>, current: Thresholds): Partial<Editable> {
  const out: Partial<Editable> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!(k in LIMITS)) throw new Error(`Unknown setting "${k}".`);
    const n = Number(v);
    const [lo, hi] = LIMITS[k as keyof Editable];
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${k} must be between ${lo} and ${hi}.`);
    out[k as keyof Editable] = n;
  }
  const low = out.lowKbps ?? current.lowKbps;
  const off = out.offlineKbps ?? current.offlineKbps;
  if (off >= low) throw new Error('The offline floor must be below the weak signal floor.');
  return out;
}

export class SettingsStore {
  private file: string | null;
  constructor(dataDir: string | null) {
    this.file = dataDir ? join(dataDir, 'settings.json') : null;
  }

  load(): Partial<Editable> {
    if (!this.file || !existsSync(this.file)) return {};
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      const out: Partial<Editable> = {};
      for (const k of EDITABLE_KEYS) if (typeof j[k] === 'number') out[k] = j[k] as number;
      return out;
    } catch {
      return {};
    }
  }

  save(t: Thresholds): void {
    if (!this.file) return;
    const dir = this.file.slice(0, this.file.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });
    const pick: Partial<Editable> = {};
    for (const k of EDITABLE_KEYS) pick[k] = t[k];
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(pick, null, 2));
    renameSync(tmp, this.file);
  }
}
