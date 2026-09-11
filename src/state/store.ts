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
  DEFAULT_ROUTES,
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
  defaultLayout,
  moveModule,
  normalizeLayout,
  type LayoutState,
  type ModuleId,
  type Theme,
  type ViewMode,
} from './layout';
import {
  FACTORY_PRESETS,
  presetParams,
  presetRoutes,
  type Preset,
  type PresetCategory,
} from './presets';
import { midiLibrary, trackTitle, type Track } from '@/midi/library';
import { midiPlayer } from '@/midi/player';
import { parseMidi, writeMidi, type MidiSong } from '@/midi/smf';
import { midi } from '@/audio/midi';
import { midiOut } from '@/midi/output';
import { setMidiOutEnabled } from '@/audio/noteBus';
import { temperamentById, temperamentTable } from '@/audio/tuning';
import { scalaTable, type ScalaScale } from '@/audio/scala';
import { bindCc, unbindParam } from '@/audio/ccmap';
import {
  applyScene as applySceneToLayout,
  makeScene,
  normalizeScenes,
  SCENES_KEY,
  type Scene,
} from './scenes';
import {
  decodePatch,
  decodePatchAsync,
  downloadText,
  encodePatch,
  encodePatchAsync,
  shareUrl,
  type PatchPayload,
  type SharedSong,
} from './share';
import { setLang } from '@/i18n';
import { parsePatchFile } from './patchfile';
import { SCHEMA_VERSION, mergeKnown, unwrap, wrap } from './persist';

const STORAGE_KEY = 'gs1:state:v1';
const USER_KEY = 'gs1:user-presets:v1';
const LAYOUT_KEY = 'gs1:layout:v1';

interface Snapshot {
  state: SynthState;
  layout: LayoutState;
  currentPresetId: string;
  userPresets: Preset[];
  canUndo: boolean;
  canRedo: boolean;
  /** Parameter waiting for a MIDI CC while CC Learn is armed. */
  midiLearn: number | null;
  /** Saved workspace scenes. */
  scenes: Scene[];
  activeSlot: 'a' | 'b';
  slotFilled: { a: boolean; b: boolean };
  version: number;
}

function cloneState(state: SynthState): SynthState {
  return {
    params: { ...state.params },
    params2: { ...state.params2 },
    routes: state.routes.map((r) => ({ ...r })),
    power: state.power,
  };
}

function cloneLayout(layout: LayoutState): LayoutState {
  return {
    ...layout,
    order: [...layout.order],
    collapsed: { ...layout.collapsed },
    autoCollapsed: [...layout.autoCollapsed],
    flowPos: Object.fromEntries(Object.entries(layout.flowPos).map(([k, v]) => [k, [...v] as [number, number]])),
    fxGraphPos: Object.fromEntries(
      Object.entries(layout.fxGraphPos).map(([k, v]) => [k, [...v] as [number, number]]),
    ),
    flowHidden: [...layout.flowHidden],
  };
}

/**
 * One undoable step. It covers everything that makes up the *document*: the
 * patch, the workspace layout, the user's presets and their recorded/imported
 * tracks — not preferences such as language or theme, which are handled by the
 * layout mutators but are intentionally not part of undo.
 */
interface HistoryEntry {
  state: SynthState;
  layout: LayoutState;
  userPresets: Preset[];
  currentPresetId: string;
  clips: Track[];
  currentClipId: string;
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Validate stored presets. A preset is user data, so a broken one is dropped
 * rather than loaded into the drawer, and a preset that predates a field simply
 * uses the current default for it.
 */
function normalizeUserPresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  const out: Preset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const preset = entry as Partial<Preset>;
    if (typeof preset.id !== 'string' || !preset.params || typeof preset.params !== 'object') continue;
    if (out.some((existing) => existing.id === preset.id)) continue;
    out.push({ ...(entry as Preset) });
  }
  return out;
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode); the synth still works */
  }
}

/** Longest share URL a chat client is likely to keep intact. */
const MAX_SHARE_URL = 16_000;

export class SynthStore {
  private state: SynthState;
  private layout: LayoutState;
  private userPresets: Preset[];
  private currentPresetId = FACTORY_PRESETS[0].id;
  private transientPreset: Preset | null = null;
  private history: HistoryEntry[] = [];
  /** Parameter waiting for a CC, or null (transient: not part of the document). */
  private midiLearn: number | null = null;
  private scenes: Scene[] = [];
  private historyIndex = -1;
  private historyTimer: number | undefined;
  private slots: { a: SynthState | null; b: SynthState | null } = { a: null, b: null };
  private slotFilled = { a: false, b: false };
  private activeSlot: 'a' | 'b' = 'a';
  private listeners = new Set<() => void>();
  private version = 0;
  private snapshot: Snapshot;

  constructor() {
    const rawState = loadJson<unknown>(STORAGE_KEY);
    const stored = unwrap(rawState);
    if (!stored && rawState) {
      // Written by a newer build. Keep the original aside rather than
      // overwriting it with defaults, so a later version can still recover it.
      try {
        localStorage.setItem(`${STORAGE_KEY}.newer`, JSON.stringify(rawState));
      } catch {
        /* storage may be unavailable; nothing else to do */
      }
    }
    const persisted = stored ? mergeKnown<SynthState & { presetId?: string }>(
      { ...createDefaultState(), presetId: '' },
      stored.data,
    ) : null;
    this.state =
      persisted && persisted.params ? persisted : { ...createDefaultState(), presetId: '' };
    this.layout = normalizeLayout(unwrap(loadJson<unknown>(LAYOUT_KEY))?.data ?? null);
    setLang(this.layout.lang);
    this.userPresets = normalizeUserPresets(unwrap(loadJson<unknown>(USER_KEY))?.data);
    // The patch is restored from storage, so the name shown for it has to be
    // restored too: opening the app used to display the first factory preset
    // while the engine held last session's patch, and playing straight away
    // sounded like neither.
    if (persisted?.presetId && this.allPresets().some((preset) => preset.id === persisted.presetId)) {
      this.currentPresetId = persisted.presetId;
    }
    this.scenes = normalizeScenes(unwrap(loadJson<unknown>(SCENES_KEY))?.data ?? null);
    this.snapshot = this.buildSnapshot();
    // Entry zero is the state the session started from, so the very first
    // action is undoable.
    this.recordHistory();
  }

  private buildSnapshot(): Snapshot {
    this.slotFilled.a = this.slots.a !== null;
    this.slotFilled.b = this.slots.b !== null;
    return {
      state: this.state,
      layout: this.layout,
      currentPresetId: this.currentPresetId,
      userPresets: this.userPresets,
      midiLearn: this.midiLearn,
      scenes: this.scenes,
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex >= 0 && this.historyIndex < this.history.length - 1,
      activeSlot: this.activeSlot,
      slotFilled: this.slotFilled,
      version: this.version,
    };
  }

  private commit() {
    this.version += 1;
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn();
    saveJson(STORAGE_KEY, wrap({ ...this.state, presetId: this.currentPresetId }));
    saveJson(LAYOUT_KEY, wrap(this.layout));
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  // ------------------------------------------------------------- parameters

  /** The instance the panels are editing. */
  get activeInstance(): 1 | 2 {
    return this.layout.activeInstance;
  }

  /**
   * Parameters are read and written for the *active* instance, which is what
   * makes the whole panel instance-aware without a single component knowing
   * about instances: a knob reads this and gets whichever layer the player is
   * editing.
   */
  getParam(id: ParamId): number {
    const set = this.activeInstance === 2 ? this.state.params2 : this.state.params;
    return set[id] ?? DEFAULT_PARAMS[id] ?? 0;
  }

  setParam(id: ParamId, value: number, opts: { immediate?: boolean } = {}) {
    const key = this.activeInstance === 2 ? 'params2' : 'params';
    const set = this.state[key];
    if (set[id] === value) return;
    this.state = { ...this.state, [key]: { ...set, [id]: value } };
    if (this.activeInstance === 2) engine.setParamB(id, value);
    else engine.setParam(id, value, opts.immediate);
    this.scheduleHistory();
    this.commit();
  }

  /**
   * Apply a batch of parameters as one change.
   *
   * Rebuilding the routing graph writes 37 of them at once. Committing each
   * separately meant 37 rounds of notifications and 74 storage writes for one
   * user action — slow everywhere and seconds of frozen interface on a slow
   * WebKit, so a rebuild that touches many parameters lands as a single change.
   */
  setParams(entries: [ParamId, number][], opts: { immediate?: boolean } = {}) {
    const key = this.activeInstance === 2 ? 'params2' : 'params';
    let next = this.state[key];
    let changed = false;
    for (const [id, value] of entries) {
      if (next[id] === value) continue;
      if (!changed) {
        next = { ...next };
        changed = true;
      }
      next[id] = value;
      if (this.activeInstance === 2) engine.setParamB(id, value);
      else engine.setParam(id, value, opts.immediate);
    }
    if (!changed) return;
    this.state = { ...this.state, [key]: next };
    this.scheduleHistory();
    this.commit();
  }

  /** Switch which instance the panels edit. */
  setActiveInstance(instance: 1 | 2) {
    if (this.layout.activeInstance === instance) return;
    this.layout = { ...this.layout, activeInstance: instance };
    this.commit();
  }

  /** Layer / split routing for the two instances. */
  setInstanceRouting(patch: { mode?: 'single' | 'layer' | 'split'; splitNote?: number }) {
    const next = {
      instanceMode: patch.mode ?? this.layout.instanceMode,
      splitNote: patch.splitNote ?? this.layout.splitNote,
    };
    if (next.instanceMode === this.layout.instanceMode && next.splitNote === this.layout.splitNote) return;
    this.layout = { ...this.layout, ...next };
    this.syncInstanceRouting();
    this.commit();
  }

  /** Push the routing to the engine (start-up and after every change). */
  syncInstanceRouting() {
    engine.setInstanceRoute({
      mode: this.layout.instanceMode === 'layer' ? 1 : this.layout.instanceMode === 'split' ? 2 : 0,
      splitNote: this.layout.splitNote,
      aLo: 0,
      aHi: 1,
      bLo: 0,
      bHi: 1,
    });
  }

  setRoute(index: number, patch: Partial<ModRoute>) {
    const routes = this.state.routes.map((r, i) => (i === index ? { ...r, ...patch } : r));
    this.state = { ...this.state, routes };
    const route = routes[index];
    if (route) engine.setRoute(index, route);
    this.scheduleHistory();
    this.commit();
  }

  addRoute() {
    if (this.state.routes.length >= 8) return;
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
    return (
      this.allPresets().find((p) => p.id === this.currentPresetId) ??
      (this.transientPreset?.id === this.currentPresetId ? this.transientPreset : undefined)
    );
  }

  applyPreset(preset: Preset, opts: { immediate?: boolean } = {}) {
    if (preset.id !== this.transientPreset?.id) this.transientPreset = null;
    const params = presetParams(preset);
    const routes = presetRoutes(preset);
    // A patch with a layer brings it (and its routing); one without leaves the
    // player's own second timbre alone.
    // The merge fills every gap the saved layer left, so the cast is safe.
    const params2: Record<number, number> = preset.params2
      ? { ...DEFAULT_PARAMS, ...(preset.params2 as Record<number, number>) }
      : this.state.params2;
    this.state = { params, params2, routes, power: this.state.power };
    if (preset.params2 && preset.instanceMode) {
      this.layout = {
        ...this.layout,
        instanceMode: preset.instanceMode,
        splitNote: preset.splitNote ?? this.layout.splitNote,
      };
    }
    this.currentPresetId = preset.id;
    engine.applyState(this.state, opts.immediate ?? true);
    this.recordHistory();
    this.commit();
  }

  applyPresetById(id: string) {
    const preset = this.allPresets().find((p) => p.id === id);
    if (preset) this.applyPreset(preset);
  }

  // ----------------------------------------------------------- share / files

  /**
   * The arrangement as it would travel in a share code, or null when there is
   * nothing worth sharing: a built-in demo is not the user's own work.
   */
  private sharedSong(): SharedSong | null {
    const track = midiLibrary.getCurrent();
    if (!track || track.group === 'builtin') return null;
    const song = midiPlayer.getSong();
    if (!song || song.notes.length === 0) return null;
    const tracks = song.tracks && song.tracks.length > 1 ? song.tracks : undefined;
    const midi = writeMidi(song.notes, { bpm: song.bpm, name: track.title[0], tracks });
    return {
      name: trackTitle(track),
      midi,
      mix: midiPlayer.getLayers().map((layer) => [layer.muted, layer.volume, layer.pan, layer.offset]),
    };
  }

  /** Compact, URL-safe code for the current patch (and the song, if there is one). */
  shareCode(): string {
    const song = this.sharedSong();
    return encodePatch(this.state, song ? { song } : undefined);
  }

  /**
   * The same code, deflated when it carries an arrangement: a five-minute song
   * is megabytes of base64 otherwise, and no chat client keeps a link that long.
   * Falls back to the plain code wherever `CompressionStream` is missing.
   */
  async shareCodeAsync(): Promise<string> {
    const song = this.sharedSong();
    return encodePatchAsync(this.state, song ? { song } : undefined);
  }

  /** Full shareable URL. */
  shareLink(): string {
    return shareUrl(this.shareCode());
  }

  /**
   * A share link when the code fits in a URL, otherwise a `.gs1song` file: a
   * long arrangement is megabytes of base64 and every chat client would cut the
   * link. Returns which one happened so the caller can say so.
   */
  async shareOrDownload(): Promise<'link' | 'file'> {
    const code = await this.shareCodeAsync();
    const url = shareUrl(code);
    if (url.length <= MAX_SHARE_URL) {
      history.replaceState(null, '', url);
      return 'link';
    }
    const name = (this.sharedSong()?.name ?? 'gs1-song').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
    downloadText(
      `${name || 'gs1-song'}.gs1song`,
      JSON.stringify({ format: 'gs1-song', schema: SCHEMA_VERSION, code }, null, 2),
    );
    return 'file';
  }

  /**
   * Apply a `#p=...` share code of either form (plain or deflated). The async
   * path is what the app boots with; the sync one serves `.gs1song` files, which
   * are never compressed.
   */
  async importPatchCodeAsync(code: string): Promise<boolean> {
    const payload = await decodePatchAsync(code);
    return payload ? this.applySharedPayload(payload) : false;
  }

  /** Apply a `#p=...` share code. Returns false if it is malformed. */
  importPatchCode(code: string): boolean {
    const payload = decodePatch(code);
    return payload ? this.applySharedPayload(payload) : false;
  }

  private applySharedPayload(payload: PatchPayload): boolean {
    const preset: Preset = {
      id: `shared-${Date.now()}`,
      name: 'Shared Patch · 分享音色',
      tag: 'SHARED',
      cat: 'USER',
      wave: intToWave(payload.params[2] ?? 0),
      params: payload.params,
      routes: payload.routes.length ? payload.routes : DEFAULT_ROUTES.map((r) => ({ ...r })),
    };
    this.transientPreset = preset;
    this.applyPreset(preset);
    // A song in the code arrives as a MIDI file: the library already knows how
    // to hold one, so the arrangement shows up next to the imported tracks.
    if (payload.song) this.importSharedSong(payload.song);
    return true;
  }

  /** Put a song from a share code (or a `.gs1song` file) into the library. */
  importSharedSong(shared: SharedSong): boolean {
    let song: MidiSong;
    try {
      song = parseMidi(shared.midi, shared.name);
    } catch {
      return false;
    }
    if (!song.notes.length) return false;
    midiLibrary.put({
      id: `share:${shared.midi.length}:${shared.name}`,
      title: [shared.name, shared.name],
      composer: 'shared',
      group: 'imported',
      song,
    });
    shared.mix.forEach(([muted, volume, pan, offset], index) => {
      midiPlayer.setLayer(index, { muted, volume, pan, offset });
    });
    midiLibrary.saveMix();
    return true;
  }

  /** Download the current patch as a `.gs1.json` file. */
  exportCurrentPreset() {
    const preset = this.currentPreset();
    const name = (preset?.name ?? 'GS1 Patch').split(' · ')[0].replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
    const layered = this.usesLayer();
    const payload = {
      format: 'gs1-preset',
      version: 1,
      name: preset?.name ?? 'GS1 Patch',
      params: this.state.params,
      routes: this.state.routes,
      // Same rule as a saved preset: the layer travels only when it is used.
      ...(layered
        ? {
            params2: this.state.params2,
            instanceMode: this.layout.instanceMode,
            splitNote: this.layout.splitNote,
          }
        : {}),
    };
    downloadText(`${name || 'gs1-patch'}.gs1.json`, JSON.stringify(payload, null, 2));
  }

  /** Load a `.gs1.json` patch file, or a `.gs1song` arrangement file. */
  importPresetFile(text: string): boolean {
    const file = parsePatchFile(text);
    if (!file) return false;
    if (file.kind === 'song') return this.importPatchCode(file.code);
    this.transientPreset = file.preset;
    this.applyPreset(file.preset);
    return true;
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
  /** Whether the current patch actually uses the second layer. */
  private usesLayer(): boolean {
    if (this.layout.instanceMode !== 'single') return true;
    return Object.keys(DEFAULT_PARAMS).some(
      (key) => (this.state.params2[Number(key)] ?? DEFAULT_PARAMS[Number(key)]) !== this.state.params[Number(key)],
    );
  }

  savePreset(name?: string) {
    const n = this.userPresets.length + 1;
    const layered = this.usesLayer();
    const preset: Preset = {
      id: `user-${Date.now()}`,
      name: name?.trim() || `MY PRESET ${n} · 我的音色`,
      tag: 'USER',
      cat: 'USER',
      wave: intToWave(this.getParam(2)),
      params: { ...this.state.params },
      routes: this.state.routes.map((r) => ({ ...r })),
      // A layer is part of the sound, so a saved or shared patch carries it —
      // and the routing that decides which keys reach which layer.
      ...(layered
        ? {
            params2: { ...this.state.params2 },
            instanceMode: this.layout.instanceMode,
            splitNote: this.layout.splitNote,
          }
        : {}),
      user: true,
    };
    this.userPresets = [preset, ...this.userPresets];
    saveJson(USER_KEY, wrap(this.userPresets));
    this.currentPresetId = preset.id;
    this.mark();
    this.commit();
    return preset;
  }

  deletePreset(id: string) {
    this.userPresets = this.userPresets.filter((p) => p.id !== id);
    saveJson(USER_KEY, wrap(this.userPresets));
    if (this.currentPresetId === id) this.currentPresetId = FACTORY_PRESETS[0].id;
    this.mark();
    this.commit();
  }

  resetToInit() {
    this.applyPresetById('init');
  }

  // ---------------------------------------------------------- undo / redo

  private captureEntry(): HistoryEntry {
    const library = midiLibrary.snapshot();
    return {
      state: cloneState(this.state),
      layout: cloneLayout(this.layout),
      userPresets: this.userPresets.map((p) => ({ ...p })),
      currentPresetId: this.currentPresetId,
      clips: library.clips,
      currentClipId: library.currentId,
    };
  }

  /** Record the current document as an undo step. */
  mark() {
    this.recordHistory();
  }

  private recordHistory() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.captureEntry());
    if (this.history.length > 60) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  /** Coalesce a burst of knob movements into one history entry. */
  private scheduleHistory() {
    if (typeof window === 'undefined') {
      this.recordHistory();
      return;
    }
    window.clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => this.recordHistory(), 700);
  }

  /** Patch-only restore, used by the A/B slots. */
  private restore(state: SynthState) {
    this.state = cloneState(state);
    engine.applyState(this.state, true);
    this.commit();
  }

  /** Full document restore, used by undo/redo. */
  private restoreEntry(entry: HistoryEntry) {
    this.state = cloneState(entry.state);
    this.layout = cloneLayout(entry.layout);
    setLang(this.layout.lang);
    this.userPresets = entry.userPresets.map((p) => ({ ...p }));
    this.currentPresetId = entry.currentPresetId;
    saveJson(USER_KEY, wrap(this.userPresets));
    saveJson(LAYOUT_KEY, this.layout);
    midiLibrary.restore(entry.clips, entry.currentClipId);
    engine.applyState(this.state, true);
    this.commit();
  }

  undo(): boolean {
    window.clearTimeout(this.historyTimer);
    if (this.historyIndex <= 0) return false;
    this.historyIndex -= 1;
    this.restoreEntry(this.history[this.historyIndex]);
    return true;
  }

  redo(): boolean {
    window.clearTimeout(this.historyTimer);
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex += 1;
    this.restoreEntry(this.history[this.historyIndex]);
    return true;
  }

  // --------------------------------------------------------------- A/B slots

  /** Save the current patch into the active slot and switch to `slot`. */
  selectSlot(slot: 'a' | 'b') {
    if (slot === this.activeSlot) return;
    this.slots[this.activeSlot] = cloneState(this.state);
    const target = this.slots[slot];
    this.activeSlot = slot;
    if (target) {
      this.restore(target);
    } else {
      this.slots[slot] = cloneState(this.state);
      this.recordHistory();
      this.commit();
    }
  }

  /** Copy the current patch into the other slot without switching. */
  copySlot() {
    const other = this.activeSlot === 'a' ? 'b' : 'a';
    this.slots[other] = cloneState(this.state);
    this.commit();
  }

  // ------------------------------------------------------------------ layout

  toggleCollapsed(id: ModuleId) {
    const collapsed = { ...this.layout.collapsed };
    if (collapsed[id]) delete collapsed[id];
    else collapsed[id] = true;
    this.layout = {
      ...this.layout,
      collapsed,
      // A manual toggle is the user's choice, so it stops being automatic.
      autoCollapsed: this.layout.autoCollapsed.filter((m) => m !== id),
    };
    this.mark();
    this.commit();
  }

  setKeyboardVisible(visible: boolean) {
    if (this.layout.keyboardVisible === visible) return;
    this.layout = { ...this.layout, keyboardVisible: visible };
    this.commit();
  }

  toggleKeyboard() {
    this.setKeyboardVisible(!this.layout.keyboardVisible);
  }

  toggleLang() {
    this.layout = { ...this.layout, lang: this.layout.lang === 'zh' ? 'en' : 'zh' };
    setLang(this.layout.lang);
    this.commit();
  }

  setTheme(theme: Theme) {
    if (this.layout.theme === theme) return;
    this.layout = { ...this.layout, theme };
    this.commit();
  }

  /** Cycle dark → light → auto, used by the quick toggle. */
  cycleTheme() {
    const order: Theme[] = ['dark', 'light', 'auto'];
    const next = order[(order.indexOf(this.layout.theme) + 1) % order.length];
    this.setTheme(next);
  }

  toggleContrast() {
    this.layout = { ...this.layout, contrast: !this.layout.contrast };
    this.commit();
  }

  toggleVelocityMode() {
    this.layout = {
      ...this.layout,
      velocityMode: this.layout.velocityMode === 'touch' ? 'fixed' : 'touch',
    };
    this.commit();
  }

  setHaptics(on: boolean) {
    if (this.layout.haptics === on) return;
    this.layout = { ...this.layout, haptics: on };
    this.commit();
  }

  toggleHaptics() {
    this.setHaptics(!this.layout.haptics);
  }

  moveModuleTo(id: ModuleId, index: number) {
    const order = moveModule(this.layout.order, id, index);
    if (order === this.layout.order) return;
    this.layout = { ...this.layout, order };
    this.commit();
  }

  /** Place `id` immediately before `target` in the order. */
  moveModuleBefore(id: ModuleId, target: ModuleId) {
    if (id === target) return;
    const rest = this.layout.order.filter((m) => m !== id);
    const index = rest.indexOf(target);
    if (index === -1) return;
    this.moveModuleTo(id, index);
  }

  /** Place `id` immediately after `target` in the order. */
  moveModuleAfter(id: ModuleId, target: ModuleId) {
    if (id === target) return;
    const rest = this.layout.order.filter((m) => m !== id);
    const index = rest.indexOf(target);
    if (index === -1) return;
    this.moveModuleTo(id, index + 1);
  }

  resetLayout() {
    this.layout = defaultLayout();
    setLang(this.layout.lang);
    this.commit();
  }

  // ------------------------------------------------------------ signal flow

  setView(view: ViewMode) {
    if (this.layout.view === view) return;
    this.layout = { ...this.layout, view };
    this.mark();
    this.commit();
  }

  setFlowPosition(id: string, pos: [number, number]) {
    // Dragging a node fires continuously: coalesce like a knob sweep.
    this.scheduleHistory();
    this.layout = { ...this.layout, flowPos: { ...this.layout.flowPos, [id]: pos } };
    this.commit();
  }

  /** Move one card of the effect routing graph (coalesced like a node drag). */
  setFxGraphPosition(id: string, pos: [number, number]) {
    this.scheduleHistory();
    this.layout = { ...this.layout, fxGraphPos: { ...this.layout.fxGraphPos, [id]: pos } };
    this.commit();
  }

  resetFxGraphLayout() {
    this.layout = { ...this.layout, fxGraphPos: {} };
    this.mark();
    this.commit();
  }

  toggleFlowHidden(id: string) {
    const hidden = this.layout.flowHidden.includes(id)
      ? this.layout.flowHidden.filter((x) => x !== id)
      : [...this.layout.flowHidden, id];
    this.layout = { ...this.layout, flowHidden: hidden };
    this.mark();
    this.commit();
  }

  resetFlow() {
    this.layout = { ...this.layout, flowPos: {}, flowHidden: [] };
    this.mark();
    this.commit();
  }

  setDisplayExpanded(expanded: boolean | null) {
    this.layout = { ...this.layout, displayExpanded: expanded };
    this.mark();
    this.commit();
  }

  /**
   * First-run defaults for phones: keep the essential modules open, collapse the
   * rest and shrink the scope/spectrum row to a single strip.
   */
  applyPhoneDefaults() {
    if (this.layout.phoneDefaults) return;
    const collapsed = { ...this.layout.collapsed };
    const auto: ModuleId[] = ['lfo', 'matrix', 'fx', 'fx2'];
    for (const id of auto) collapsed[id] = true;
    this.layout = {
      ...this.layout,
      collapsed,
      displayExpanded: this.layout.displayExpanded ?? false,
      phoneDefaults: true,
      autoCollapsed: auto,
    };
    this.commit();
  }

  /**
   * Undo the phone first-run collapse when the same browser is used on a
   * desktop-sized screen. Modules the user collapsed by hand are left alone.
   */
  expandAutoCollapsed() {
    if (this.layout.autoCollapsed.length === 0) return;
    const collapsed = { ...this.layout.collapsed };
    for (const id of this.layout.autoCollapsed) delete collapsed[id];
    this.layout = { ...this.layout, collapsed, autoCollapsed: [] };
    this.commit();
  }

  // --------------------------------------------------------------- power etc.

  setPower(on: boolean) {
    if (this.state.power === on) return;
    this.state = { ...this.state, power: on };
    engine.setMuted(!on);
    if (!on) engine.allNotesOff();
    this.commit();
  }

  /** Arm CC Learn for a parameter (null clears it). Not persisted. */
  armMidiLearn(param: number | null) {
    this.midiLearn = param;
    this.commit();
  }

  /** Bind the controller that just arrived to the armed parameter. */
  bindMidiCc(param: number, cc: number) {
    this.layout = { ...this.layout, ccMap: bindCc(this.layout.ccMap, param, cc) };
    saveJson(LAYOUT_KEY, this.layout);
    this.midiLearn = null;
    this.mark();
    this.commit();
    return this.layout.ccMap;
  }

  clearMidiCc(param: number) {
    this.layout = { ...this.layout, ccMap: unbindParam(this.layout.ccMap, param) };
    saveJson(LAYOUT_KEY, this.layout);
    this.mark();
    this.commit();
  }

  clearAllMidiCc() {
    this.layout = { ...this.layout, ccMap: [] };
    saveJson(LAYOUT_KEY, this.layout);
    this.mark();
    this.commit();
  }

  /** Change the microtuning temperament and push it to the engine. */
  setTemperament(id: string) {
    this.layout = { ...this.layout, temperament: id };
    saveJson(LAYOUT_KEY, this.layout);
    engine.setTuning(this.tuningTableFor(id));
    this.mark();
    this.commit();
  }

  /** Save the current workspace as a named scene. */
  saveScene(name: string) {
    const scene = makeScene(`scene-${Date.now()}`, name, this.layout);
    this.scenes = [...this.scenes, scene];
    saveJson(SCENES_KEY, wrap(this.scenes));
    this.mark();
    this.commit();
    return scene;
  }

  /** Recall a scene's workspace, leaving preferences alone. */
  applyScene(id: string) {
    const scene = this.scenes.find((entry) => entry.id === id);
    if (!scene) return;
    this.layout = applySceneToLayout(this.layout, scene);
    saveJson(LAYOUT_KEY, this.layout);
    this.mark();
    this.commit();
  }

  deleteScene(id: string) {
    this.scenes = this.scenes.filter((entry) => entry.id !== id);
    saveJson(SCENES_KEY, wrap(this.scenes));
    this.mark();
    this.commit();
  }

  /** Send played notes to an external MIDI device. */
  setMidiOut(enabled: boolean, port?: string) {
    this.layout = {
      ...this.layout,
      midiOut: enabled,
      midiOutPort: port ?? this.layout.midiOutPort,
    };
    saveJson(LAYOUT_KEY, this.layout);
    setMidiOutEnabled(enabled);
    if (enabled) midiOut.selectPort(this.layout.midiOutPort);
    this.mark();
    this.commit();
  }

  /** Quantise grid for recordings. */
  setRecordQuantise(id: string) {
    this.layout = { ...this.layout, recordQuantise: id };
    saveJson(LAYOUT_KEY, this.layout);
    this.mark();
    this.commit();
  }

  /** Live-input velocity curve. */
  setVelocityCurve(id: string) {
    this.layout = { ...this.layout, velocityCurve: id };
    saveJson(LAYOUT_KEY, this.layout);
    this.mark();
    this.commit();
  }

  /** MPE input mode. */
  setMpe(enabled: boolean) {
    this.layout = { ...this.layout, mpe: enabled };
    saveJson(LAYOUT_KEY, this.layout);
    midi.setMpe(enabled);
    this.mark();
    this.commit();
  }

  /** Install an imported Scala scale and switch to it. */
  importTuning(scale: ScalaScale) {
    this.layout = { ...this.layout, temperament: 'custom', customTuning: scale };
    saveJson(LAYOUT_KEY, this.layout);
    engine.setTuning(scalaTable(scale));
    this.mark();
    this.commit();
  }

  /** The cent table a temperament id currently stands for. */
  tuningTableFor(id: string): Float32Array {
    const custom = this.layout.customTuning;
    if (id === 'custom' && custom) return scalaTable(custom);
    return temperamentTable(temperamentById(id).cents);
  }

  setPolyphony(n: number) {
    this.layout = { ...this.layout, polyphony: n };
    saveJson(LAYOUT_KEY, this.layout);
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
