/**
 * Single source of truth for the UI.
 *
 * A tiny external store (no dependency) consumed through `useSyncExternalStore`.
 * Every mutation pushes the affected parameter to the AudioEngine's AudioParam,
 * so the DSP never has to poll the UI.
 */

import { engine } from '@/audio/engine';
import {
  createDefaultState,
  DEFAULT_PARAMS,
  clamp,
  intToFilter,
  intToWave,
  type ModDst,
  type ModRoute,
  type ModSrc,
  type ParamId,
  type SynthState,
  WAVES,
} from '@/audio/params';
import {
  FACTORY_PRESETS,
  presetParams,
  presetRoutes,
  type Preset,
  type PresetCategory,
} from './presets';

const STORAGE_KEY = 'gs1:state:v1';
const USER_KEY = 'gs1:user-presets:v1';

interface Snapshot {
  state: SynthState;
  currentPresetId: string;
  userPresets: Preset[];
  version: number;
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode); the synth still works */
  }
}

class SynthStore {
  private state: SynthState;
  private userPresets: Preset[];
  private currentPresetId = FACTORY_PRESETS[0].id;
  private listeners = new Set<() => void>();
  private version = 0;
  private snapshot: Snapshot;

  constructor() {
    const persisted = loadJson<SynthState>(STORAGE_KEY);
    this.state = persisted && persisted.params ? { ...createDefaultState(), ...persisted } : createDefaultState();
    this.userPresets = loadJson<Preset[]>(USER_KEY) ?? [];
    this.snapshot = this.buildSnapshot();
  }

  private buildSnapshot(): Snapshot {
    return {
      state: this.state,
      currentPresetId: this.currentPresetId,
      userPresets: this.userPresets,
      version: this.version,
    };
  }

  private commit() {
    this.version += 1;
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn();
    saveJson(STORAGE_KEY, this.state);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  // ------------------------------------------------------------- parameters

  getParam(id: ParamId): number {
    return this.state.params[id] ?? DEFAULT_PARAMS[id] ?? 0;
  }

  setParam(id: ParamId, value: number, opts: { immediate?: boolean } = {}) {
    if (this.state.params[id] === value) return;
    this.state = { ...this.state, params: { ...this.state.params, [id]: value } };
    engine.setParam(id, value, opts.immediate);
    this.commit();
  }

  setRoute(index: number, patch: Partial<ModRoute>) {
    const routes = this.state.routes.map((r, i) => (i === index ? { ...r, ...patch } : r));
    this.state = { ...this.state, routes };
    const route = routes[index];
    if (route) engine.setRoute(index, route);
    this.commit();
  }

  addRoute() {
    if (this.state.routes.length >= 6) return;
    const routes = [...this.state.routes, { src: 'lfo' as ModSrc, dst: 'cutoff' as ModDst, amount: 0.5, enabled: false }];
    this.state = { ...this.state, routes };
    engine.setRoute(routes.length - 1, routes[routes.length - 1]);
    this.commit();
  }

  removeRoute(index: number) {
    if (this.state.routes.length <= 1) return;
    const routes = this.state.routes.filter((_, i) => i !== index);
    this.state = { ...this.state, routes };
    routes.forEach((r, i) => engine.setRoute(i, r));
    this.commit();
  }

  // ----------------------------------------------------------------- presets

  allPresets(): Preset[] {
    return [...this.userPresets, ...FACTORY_PRESETS];
  }

  currentPreset(): Preset | undefined {
    return this.allPresets().find((p) => p.id === this.currentPresetId);
  }

  applyPreset(preset: Preset, opts: { immediate?: boolean } = {}) {
    const params = presetParams(preset);
    const routes = presetRoutes(preset);
    this.state = { params, routes, power: this.state.power };
    this.currentPresetId = preset.id;
    engine.applyState(this.state, opts.immediate ?? true);
    this.commit();
  }

  applyPresetById(id: string) {
    const preset = this.allPresets().find((p) => p.id === id);
    if (preset) this.applyPreset(preset);
  }

  stepPreset(dir: 1 | -1) {
    const list = this.allPresets();
    const index = list.findIndex((p) => p.id === this.currentPresetId);
    const next = list[(index + dir + list.length) % list.length];
    if (next) this.applyPreset(next);
  }

  /** Random patch generator (mirrors the reference UI's "随机" button). */
  randomize() {
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = <T,>(arr: T[]): T => arr[(Math.random() * arr.length) | 0];
    const wave = () => WAVES.indexOf(pick(WAVES));
    const params: Record<number, number> = {
      ...DEFAULT_PARAMS,
      1: 1, 2: wave(), 3: pick([0, 0, 0, -12, 12]), 4: r(-20, 20), 5: r(0.4, 0.8),
      7: Math.random() > 0.25 ? 1 : 0, 8: wave(), 9: pick([0, 0, 0, -12, 7]), 10: r(-30, 30), 11: r(0.2, 0.6),
      13: pick([0, 0, 0, 1, 2]), 14: 10 ** r(2.1, 4.2), 15: r(0, 0.9), 16: r(0, 0.6), 17: r(0, 0.8),
      18: Math.random() > 0.5 ? 1 : 0,
      19: 10 ** r(-3, -0.5), 20: 10 ** r(-2, 0.2), 21: r(0, 0.9), 22: 10 ** r(-2, 0.5),
      23: Math.random() > 0.4 ? 1 : 0, 24: pick([0, 1, 2, 3]), 25: r(0.2, 12), 26: r(0.1, 0.8),
      27: pick([0, 0, 1, 2]),
      29: Math.random() > 0.4 ? 1 : 0, 30: r(0.2, 0.9), 31: r(0.1, 0.5),
      32: Math.random() > 0.5 ? 1 : 0, 33: pick([0, 1, 2, 3]), 34: r(0.2, 0.6), 35: r(0.1, 0.35),
    };
    const preset: Preset = {
      id: `rnd-${Date.now()}`,
      name: 'Random Gen · 随机生成',
      tag: 'RANDOM',
      cat: 'USER',
      wave: intToWave(params[2]),
      params,
      user: false,
    };
    this.applyPreset(preset);
  }

  /** Persist the current patch as a user preset. */
  savePreset(name?: string) {
    const n = this.userPresets.length + 1;
    const preset: Preset = {
      id: `user-${Date.now()}`,
      name: name?.trim() || `MY PRESET ${n} · 我的音色`,
      tag: 'USER',
      cat: 'USER',
      wave: intToWave(this.getParam(2)),
      params: { ...this.state.params },
      routes: this.state.routes.map((r) => ({ ...r })),
      user: true,
    };
    this.userPresets = [preset, ...this.userPresets];
    saveJson(USER_KEY, this.userPresets);
    this.currentPresetId = preset.id;
    this.commit();
    return preset;
  }

  deletePreset(id: string) {
    this.userPresets = this.userPresets.filter((p) => p.id !== id);
    saveJson(USER_KEY, this.userPresets);
    if (this.currentPresetId === id) this.currentPresetId = FACTORY_PRESETS[0].id;
    this.commit();
  }

  resetToInit() {
    this.applyPresetById('init');
  }

  // --------------------------------------------------------------- power etc.

  setPower(on: boolean) {
    if (this.state.power === on) return;
    this.state = { ...this.state, power: on };
    engine.setMuted(!on);
    if (!on) engine.allNotesOff();
    this.commit();
  }

  setPolyphony(n: number) {
    engine.setPolyphony(n);
  }

  filterTypeLabel(): string {
    return intToFilter(this.getParam(13)).toUpperCase();
  }

  waveLabel(): string {
    return intToWave(this.getParam(2)).toUpperCase();
  }

  /** Clamp helper used by controls. */
  static clamp = clamp;
}

export const store = new SynthStore();
export type { Snapshot, PresetCategory };
