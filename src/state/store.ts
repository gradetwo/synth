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
import { midiLibrary, type Track } from '@/midi/library';
import { midi } from '@/audio/midi';
import { temperamentById, temperamentTable } from '@/audio/tuning';
import { scalaTable, type ScalaScale } from '@/audio/scala';
import { bindCc, unbindParam } from '@/audio/ccmap';
import { decodePatch, downloadText, encodePatch, shareUrl } from './share';
import { setLang } from '@/i18n';

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
  activeSlot: 'a' | 'b';
  slotFilled: { a: boolean; b: boolean };
  version: number;
}

function cloneState(state: SynthState): SynthState {
  return {
    params: { ...state.params },
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

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode); the synth still works */
  }
}

class SynthStore {
  private state: SynthState;
  private layout: LayoutState;
  private userPresets: Preset[];
  private currentPresetId = FACTORY_PRESETS[0].id;
  private transientPreset: Preset | null = null;
  private history: HistoryEntry[] = [];
  /** Parameter waiting for a CC, or null (transient: not part of the document). */
  private midiLearn: number | null = null;
  private historyIndex = -1;
  private historyTimer: number | undefined;
  private slots: { a: SynthState | null; b: SynthState | null } = { a: null, b: null };
  private slotFilled = { a: false, b: false };
  private activeSlot: 'a' | 'b' = 'a';
  private listeners = new Set<() => void>();
  private version = 0;
  private snapshot: Snapshot;

  constructor() {
    const persisted = loadJson<SynthState>(STORAGE_KEY);
    this.state = persisted && persisted.params ? { ...createDefaultState(), ...persisted } : createDefaultState();
    this.layout = normalizeLayout(loadJson<LayoutState>(LAYOUT_KEY));
    setLang(this.layout.lang);
    this.userPresets = loadJson<Preset[]>(USER_KEY) ?? [];
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
    saveJson(STORAGE_KEY, this.state);
    saveJson(LAYOUT_KEY, this.layout);
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
    this.scheduleHistory();
    this.commit();
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
    this.state = { params, routes, power: this.state.power };
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

  /** Compact, URL-safe code for the current patch. */
  shareCode(): string {
    return encodePatch(this.state);
  }

  /** Full shareable URL (updates the hash). */
  shareLink(): string {
    return shareUrl(this.shareCode());
  }

  /** Apply a `#p=...` share code. Returns false if it is malformed. */
  importPatchCode(code: string): boolean {
    const payload = decodePatch(code);
    if (!payload) return false;
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
    return true;
  }

  /** Download the current patch as a `.gs1.json` file. */
  exportCurrentPreset() {
    const preset = this.currentPreset();
    const name = (preset?.name ?? 'GS1 Patch').split(' · ')[0].replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
    const payload = {
      format: 'gs1-preset',
      version: 1,
      name: preset?.name ?? 'GS1 Patch',
      params: this.state.params,
      routes: this.state.routes,
    };
    downloadText(`${name || 'gs1-patch'}.gs1.json`, JSON.stringify(payload, null, 2));
  }

  /** Load a `.gs1.json` file exported by `exportCurrentPreset`. */
  importPresetFile(text: string): boolean {
    let parsed: {
      format?: string;
      name?: unknown;
      params?: Record<string, unknown>;
      routes?: { src?: unknown; dst?: unknown; amount?: unknown; enabled?: unknown }[];
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (parsed?.format !== 'gs1-preset' || !parsed.params || typeof parsed.params !== 'object') {
      return false;
    }
    const params: Record<number, number> = { ...DEFAULT_PARAMS };
    for (const [key, value] of Object.entries(parsed.params)) {
      const id = Number(key);
      if (Number.isFinite(id) && typeof value === 'number' && Number.isFinite(value)) {
        params[id] = value;
      }
    }
    const routes: ModRoute[] = Array.isArray(parsed.routes)
      ? parsed.routes
          .filter((r) => r && typeof r.src === 'string' && typeof r.dst === 'string')
          .map((r) => ({
            src: r.src as ModRoute['src'],
            dst: r.dst as ModRoute['dst'],
            amount: clamp(Number(r.amount) || 0, -1, 1),
            enabled: Boolean(r.enabled),
          }))
      : DEFAULT_ROUTES.map((r) => ({ ...r }));
    const preset: Preset = {
      id: `file-${Date.now()}`,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Imported Patch · 导入音色',
      tag: 'IMPORTED',
      cat: 'USER',
      wave: intToWave(params[2] ?? 0),
      params,
      routes: routes.length ? routes : DEFAULT_ROUTES.map((r) => ({ ...r })),
    };
    this.transientPreset = preset;
    this.applyPreset(preset);
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
    this.mark();
    this.commit();
    return preset;
  }

  deletePreset(id: string) {
    this.userPresets = this.userPresets.filter((p) => p.id !== id);
    saveJson(USER_KEY, this.userPresets);
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
    saveJson(USER_KEY, this.userPresets);
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
