/**
 * The preset model, without the catalogue.
 *
 * `state/presets.ts` is 45 KB of patch data and 10.2 KB of it is gzip, so it is a
 * chunk of its own, fetched when the drawer opens or when a stored id has to be
 * looked up (`store.ensurePresets()`). Three things are needed *before* that:
 *
 *   * the category chips, which the drawer shell renders while the list is still
 *     arriving — importing them from `presets.ts` would drag the whole table in
 *     with the (idle-warmed) drawer chunk;
 *   * the merge helpers a preset is applied through, which are ten lines over
 *     `DEFAULT_PARAMS`/`DEFAULT_ROUTES` and already in the first screen;
 *   * the identity of the patch the app boots into. The first frame has to name
 *     the current sound, and on a fresh install that name is the first factory
 *     patch — a constant here beats "the name is blank until you open a drawer".
 *
 * `presets.test.ts` pins `FACTORY_PRESETS[0]` against `DEFAULT_PRESET` and
 * checks that this module and the table agree on categories, so the two cannot
 * drift apart.
 */

import {
  DEFAULT_PARAMS,
  DEFAULT_ROUTES,
  type ModRoute,
  type Wave,
} from '@/audio/params';

export type PresetCategory =
  | 'ALL'
  | 'LEAD'
  | 'BASS'
  | 'PAD'
  | 'PLUCK'
  | 'KEYS'
  | 'FX'
  | 'BASIC'
  | 'USER';

export const PRESET_CATEGORIES: PresetCategory[] = [
  'ALL',
  'LEAD',
  'BASS',
  'PAD',
  'PLUCK',
  'KEYS',
  'FX',
  'BASIC',
  'USER',
];

export interface Preset {
  id: string;
  name: string;
  tag: string;
  cat: Exclude<PresetCategory, 'ALL'>;
  wave: Wave;
  params: Partial<Record<number, number>>;
  routes?: ModRoute[];
  /**
   * The second layer, when the patch uses one. Optional and additive: a preset
   * without it leaves the player's own layer alone.
   */
  params2?: Partial<Record<number, number>>;
  /** How notes reached the two instances when the patch was saved. */
  instanceMode?: 'single' | 'layer' | 'split';
  splitNote?: number;
  user?: boolean;
}

/** Merge a preset's sparse overlay over the default patch. */
export function presetParams(preset: Preset): Record<number, number> {
  const merged: Record<number, number> = { ...DEFAULT_PARAMS };
  for (const [id, value] of Object.entries(preset.params)) {
    if (typeof value === 'number') merged[Number(id)] = value;
  }
  return merged;
}

/** A preset's routing, or the default matrix when it carries none. */
export function presetRoutes(preset: Preset): ModRoute[] {
  return (preset.routes ?? DEFAULT_ROUTES).map((r) => ({ ...r }));
}

/**
 * The patch the app boots into, spelled out so the first screen does not need
 * the library to name it.
 *
 * `presetName`/`presetTag` in the stored document carry the name of whatever
 * patch was last selected, so a returning player sees their own patch's name
 * rather than this one; this is the fallback for a first visit and for a
 * document written before the name was stored.
 */
export const DEFAULT_PRESET = {
  id: 'pluck',
  name: 'Crystal Pluck · 晶体拨弦',
  tag: 'FUTURE BASS',
} as const;
