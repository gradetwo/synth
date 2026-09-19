/**
 * Projects (P10.4): several complete workspaces, kept side by side.
 *
 * A *project* is everything a player would otherwise lose when they load
 * somebody else's patch: the timbre, the arrangement (imported tracks and
 * recordings, with their takes and clips), the user's own presets, the saved
 * scenes and the *workspace* half of the layout — module order, what is
 * collapsed, the signal-flow and effect-graph positions, the saved templates.
 *
 * Preferences are deliberately not part of it, exactly like a scene
 * (`state/scenes.ts`): the language, the colour scheme, haptics, the MIDI CC
 * map (bound to *their* controller), the output device, MPE, the live-input
 * velocity curve and quantise grid, and which instance the panels edit all
 * belong to the person rather than to the piece. The layer/split routing and
 * the microtuning *are* included: a layered patch and a piece in a custom scale
 * do not survive without them. `PROJECT_LAYOUT_KEYS` below is the whole list.
 *
 * ## Storage, and the invariant that makes it safe
 *
 * The *live* document keeps living in the keys the app has always written
 * (`gs1:state:v1`, `gs1:layout:v1`, `gs1:library:v1`, `gs1:user-presets:v1`,
 * `gs1:scenes:v1`), so the boot path, the undo history and every existing test
 * are untouched, and the active project's document is not duplicated: it *is*
 * the live document. `gs1:projects:v1` carries the list — names, tags,
 * timestamps, the snapshots — plus the whole document of every project that is
 * *not* active (`doc` is `null` for the active one, which is what marks it).
 *
 * That is what makes a full disk survivable. A switch writes the list first and
 * only then replaces the live document, so a refused write aborts the switch
 * with the current work exactly as it was; if the list write lands but the live
 * write does not, the project keeps its document in the list as a recovery copy
 * and the caller is told the switch was *degraded* instead of being told a lie.
 *
 * ## Versions
 *
 * `gs1:projects:v1` is written in the shared schema envelope
 * (`state/persist.ts`), so a list written by a newer build is refused rather
 * than half-read and is kept aside as `gs1:projects:v1.newer`; while that copy
 * exists the list is read-only, because overwriting it would destroy whatever
 * the newer build knew. A `.gs1proj` *file* carries its own `format` /
 * `schema` pair: `format` is what tells it apart from a `.gs1.json` patch or a
 * `.gs1song` arrangement, and a `schema` above this build's is refused with a
 * reason the UI can show.
 */

import {
  MOD_DESTS,
  MOD_SOURCES,
  type ModDst,
  type ModRoute,
  type ModSrc,
  type SynthState,
} from '@/audio/params';
import { midiLibrary, type Track } from '@/midi/library';
import { normalizeLayout, type LayoutState } from './layout';
import type { Preset } from './presets';
import { normalizeScenes, type Scene } from './scenes';
import { unwrap, wrap } from './persist';
import { store } from './store';

export const PROJECTS_KEY = 'gs1:projects:v1';
/** Download extension of one project. */
export const PROJECT_EXTENSION = '.gs1proj';
/** `format` marker inside the file, so a patch or a song file is refused. */
export const PROJECT_FORMAT = 'gs1-proj';
/** Shape of the file the app writes today. */
export const PROJECT_SCHEMA = 1;
/** Most projects one browser keeps. A list is cheap; the songs in it are not. */
export const MAX_PROJECTS = 24;
/** Most snapshots one project keeps; the oldest is dropped at the cap. */
export const MAX_SNAPSHOTS = 8;

/**
 * The layout keys a project owns.
 *
 * Everything the *work* is made of is here; everything that is about the person
 * or their device is not (`theme`, `contrast`, `lang`, `haptics`,
 * `velocityMode`, `activeInstance`, `ccMap`, `midiOut`, `midiOutPort`,
 * `recordQuantise`, `mpe`, `phoneDefaults`, `polyphony`). The layer/split
 * routing travels because a layered patch is not the same sound without it, the
 * same rule `savePreset` follows.
 */
export const PROJECT_LAYOUT_KEYS = [
  'order',
  'collapsed',
  'keyboardVisible',
  'view',
  'flowPos',
  'fxGraphPos',
  'fxTemplates',
  'clipTemplates',
  'flowHidden',
  'displayExpanded',
  'autoCollapsed',
  'instanceMode',
  'splitNote',
  'temperament',
  'customTuning',
] as const;

export type ProjectLayout = Pick<LayoutState, (typeof PROJECT_LAYOUT_KEYS)[number]>;

/** One complete workspace, as it is stored and as it travels in a file. */
export interface ProjectDoc {
  state: SynthState;
  layout: ProjectLayout;
  userPresets: Preset[];
  currentPresetId: string;
  /**
   * The selected patch's display name/tag (P9.26).
   *
   * Optional and additive: the factory library is a lazy chunk, so a document
   * that carries the name can name its patch without fetching it. A document
   * written before this field existed falls back to the library, which
   * `loadDocument` fetches for exactly that case.
   */
  currentPresetName?: string;
  currentPresetTag?: string;
  scenes: Scene[];
  /** Imported tracks and recordings; built-in demos come from the build. */
  clips: Track[];
  currentClipId: string;
}

export interface ProjectSnapshot {
  id: string;
  name: string;
  createdAt: number;
  doc: ProjectDoc;
}

export interface StoredProject {
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /**
   * The whole workspace, or `null` for the active project — whose document is
   * the live one. A `null` document on an *inactive* project means the entry was
   * unreadable (or is a degraded switch's leftover); the UI calls it damaged and
   * refuses to switch to it.
   */
  doc: ProjectDoc | null;
  snapshots: ProjectSnapshot[];
}

export interface ProjectIndex {
  activeId: string | null;
  projects: StoredProject[];
}

export type ProjectFileError = 'truncated' | 'format' | 'version' | 'missing';
export type ProjectWriteError = 'quota' | 'unavailable' | 'limit' | 'missing' | 'active' | 'same' | 'damaged' | 'readonly';

export type ProjectResult = { ok: true } | { ok: false; reason: ProjectWriteError };
export type SwitchResult = { ok: true; degraded: boolean } | { ok: false; reason: ProjectWriteError };
export type ImportResult = { ok: true; degraded: boolean } | { ok: false; reason: ProjectWriteError | ProjectFileError };

/** The workspace as it is right now, and how to put one back. */
export interface ProjectHost {
  capture(): ProjectDoc;
  /** Replace the live workspace; false when storage refused to keep it. */
  load(doc: ProjectDoc): boolean;
}

/**
 * The slice of `Storage` the list needs.
 *
 * Narrow on purpose: a unit test hands it a fake that throws
 * `QuotaExceededError`, and `Storage` itself (with its index signature) is not
 * something a test double can implement.
 */
export interface ProjectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProjectSnapshotInfo {
  id: string;
  name: string;
  createdAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  active: boolean;
  /** An inactive project whose stored document could not be read. */
  damaged: boolean;
  snapshots: ProjectSnapshotInfo[];
}

/** Whether an exception from `setItem` is the storage being full. */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { name?: unknown; code?: unknown };
  return (
    failure.name === 'QuotaExceededError' ||
    failure.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    failure.code === 22 ||
    failure.code === 1014
  );
}

/** Value in a parameter map: finite numbers only, ids as numbers. */
function readNumbers(raw: unknown): Record<number, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isFinite(id) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[id] = value;
  }
  return out;
}

/** The modulation matrix, repaired row by row; a row naming nothing is dropped. */
function readRoutes(raw: unknown): ModRoute[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ModRoute[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Partial<ModRoute>;
    if (!MOD_SOURCES.includes(row.src as ModSrc)) continue;
    if (!MOD_DESTS.includes(row.dst as ModDst)) continue;
    const amount =
      typeof row.amount === 'number' && Number.isFinite(row.amount)
        ? Math.max(-1, Math.min(1, row.amount))
        : 0;
    out.push({ src: row.src as ModSrc, dst: row.dst as ModDst, amount, enabled: row.enabled === true });
  }
  return out;
}

/** A playable song: the same test `midi/library.ts` applies to stored tracks. */
function validSong(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const song = value as { notes?: unknown; bpm?: unknown };
  if (!Array.isArray(song.notes) || typeof song.bpm !== 'number' || !Number.isFinite(song.bpm)) return false;
  return song.notes.every(
    (note) =>
      !!note &&
      typeof note === 'object' &&
      Number.isFinite((note as { note?: number }).note) &&
      Number.isFinite((note as { start?: number }).start) &&
      Number.isFinite((note as { duration?: number }).duration) &&
      Number.isFinite((note as { velocity?: number }).velocity),
  );
}

/** Tracks, validated exactly like the library's own storage reader. */
function readTracks(raw: unknown): Track[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: Track[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const track = entry as Track;
    // Built-ins come from the build, never from a document.
    if (typeof track.id !== 'string' || !track.id || track.id.startsWith('demo:')) continue;
    if (!Array.isArray(track.title) || track.title.length < 2) continue;
    if (!validSong(track.song)) continue;
    if (out.some((existing) => existing.id === track.id)) continue;
    out.push(track);
  }
  return out;
}

/** User presets, validated the way the store validates them. */
function readPresets(raw: unknown): Preset[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
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

/** The project half of a layout, normalised by the layout's own reader. */
export function projectLayout(layout: LayoutState): ProjectLayout {
  const out = {} as Record<string, unknown>;
  for (const key of PROJECT_LAYOUT_KEYS) out[key] = layout[key];
  return out as ProjectLayout;
}

function readLayout(raw: unknown): ProjectLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return projectLayout(normalizeLayout(raw));
}

/**
 * Read a document without trusting it.
 *
 * Returns `null` when a section the workspace cannot exist without is missing or
 * the wrong shape — the timbre and the layout — and repairs everything else the
 * way the rest of the app repairs stored data: unknown ids are dropped, known
 * ones are clamped, and an absent optional section (presets, tracks, scenes)
 * becomes empty rather than failing the whole document.
 */
export function normalizeProjectDoc(raw: unknown): ProjectDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Partial<ProjectDoc>;
  const state = doc.state as Partial<SynthState> | undefined;
  const params = readNumbers(state?.params);
  const routes = readRoutes(state?.routes);
  const layout = readLayout(doc.layout);
  if (!params || !routes || !layout) return null;
  const userPresets = readPresets(doc.userPresets);
  const clips = readTracks(doc.clips);
  if (!userPresets || !clips) return null;
  return {
    state: {
      params,
      params2: readNumbers(state?.params2) ?? {},
      routes,
      power: state?.power !== false,
    },
    layout,
    userPresets,
    // Scenes are validated by their own reader; junk becomes an empty list.
    scenes: doc.scenes === undefined ? [] : normalizeScenes(doc.scenes),
    currentPresetId: typeof doc.currentPresetId === 'string' ? doc.currentPresetId : '',
    ...(typeof doc.currentPresetName === 'string' && doc.currentPresetName
      ? { currentPresetName: doc.currentPresetName }
      : {}),
    ...(typeof doc.currentPresetTag === 'string' && doc.currentPresetTag
      ? { currentPresetTag: doc.currentPresetTag }
      : {}),
    clips,
    currentClipId: typeof doc.currentClipId === 'string' ? doc.currentClipId : '',
  };
}

/** The file text a `.gs1proj` download contains. */
export function serializeProject(doc: ProjectDoc): string {
  return JSON.stringify({ format: PROJECT_FORMAT, schema: PROJECT_SCHEMA, doc }, null, 2);
}

/**
 * Parse a `.gs1proj` file.
 *
 * Never throws: every way a file can be wrong has a reason the UI can name.
 * `truncated` is JSON that does not parse, `format` is a file this app did not
 * write (a `.gs1.json` patch, a `.gs1song`, anything else), `version` is a file
 * from a newer build, `missing` is a file whose document has no usable timbre or
 * layout.
 */
export function parseProjectFile(
  text: string,
): { ok: true; doc: ProjectDoc } | { ok: false; reason: ProjectFileError } {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'truncated' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'truncated' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'format' };
  const file = raw as { format?: unknown; schema?: unknown; doc?: unknown };
  if (file.format !== PROJECT_FORMAT) return { ok: false, reason: 'format' };
  if (typeof file.schema !== 'number' || !Number.isFinite(file.schema)) return { ok: false, reason: 'version' };
  if (file.schema > PROJECT_SCHEMA) return { ok: false, reason: 'version' };
  const doc = normalizeProjectDoc(file.doc);
  if (!doc) return { ok: false, reason: 'missing' };
  return { ok: true, doc };
}

function readName(raw: unknown, max = 80): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text.slice(0, max) || 'Project';
}

function readTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim().slice(0, 24);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

function readSnapshots(raw: unknown): ProjectSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectSnapshot[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const snapshot = entry as Partial<ProjectSnapshot>;
    if (typeof snapshot.id !== 'string' || !snapshot.id) continue;
    const doc = normalizeProjectDoc(snapshot.doc);
    if (!doc) continue;
    if (out.some((existing) => existing.id === snapshot.id)) continue;
    out.push({
      id: snapshot.id,
      name: readName(snapshot.name),
      createdAt: typeof snapshot.createdAt === 'number' ? snapshot.createdAt : 0,
      doc,
    });
    if (out.length >= MAX_SNAPSHOTS) break;
  }
  return out;
}

/** Read the stored list, dropping entries that name no project. */
export function normalizeIndex(raw: unknown): ProjectIndex {
  const empty: ProjectIndex = { activeId: null, projects: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const input = raw as Partial<ProjectIndex>;
  if (!Array.isArray(input.projects)) return empty;
  const projects: StoredProject[] = [];
  for (const entry of input.projects) {
    if (!entry || typeof entry !== 'object') continue;
    const project = entry as Partial<StoredProject>;
    if (typeof project.id !== 'string' || !project.id) continue;
    if (typeof project.name !== 'string') continue;
    if (projects.some((existing) => existing.id === project.id)) continue;
    projects.push({
      id: project.id,
      name: readName(project.name),
      tags: readTags(project.tags),
      createdAt: typeof project.createdAt === 'number' ? project.createdAt : 0,
      updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : 0,
      doc: normalizeProjectDoc(project.doc),
      snapshots: readSnapshots(project.snapshots),
    });
    if (projects.length >= MAX_PROJECTS) break;
  }
  const activeId =
    typeof input.activeId === 'string' && projects.some((project) => project.id === input.activeId)
      ? input.activeId
      : null;
  return { activeId, projects };
}

/**
 * The project list, over an injectable storage and workspace (the tests build
 * one over fakes; the app builds one over `localStorage` and the live store).
 */
export class ProjectManager {
  private index: ProjectIndex;
  /** A list from a newer build: readable enough to say so, never overwritten. */
  private readOnly = false;
  private seq = 0;

  constructor(
    private storage: ProjectStorage,
    private host: ProjectHost,
    private clock: () => number = Date.now,
  ) {
    this.index = this.read();
  }

  private read(): ProjectIndex {
    let raw: string | null;
    try {
      raw = this.storage.getItem(PROJECTS_KEY);
    } catch {
      this.readOnly = true;
      return { activeId: null, projects: [] };
    }
    if (!raw) return { activeId: null, projects: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { activeId: null, projects: [] };
    }
    const stored = unwrap(parsed);
    if (!stored) {
      // Written by a newer build. Keep the original aside and refuse to write
      // over it: this build cannot see what it would be throwing away.
      this.readOnly = true;
      try {
        this.storage.setItem(`${PROJECTS_KEY}.newer`, raw);
      } catch {
        /* nothing else to do */
      }
      return { activeId: null, projects: [] };
    }
    return normalizeIndex(stored.data);
  }

  private write(index: ProjectIndex): ProjectWriteError | null {
    if (this.readOnly) return 'readonly';
    try {
      this.storage.setItem(PROJECTS_KEY, JSON.stringify(wrap(index)));
      return null;
    } catch (error) {
      return isQuotaError(error) ? 'quota' : 'unavailable';
    }
  }

  /** Write, and adopt the new list only if the write landed. */
  private apply(index: ProjectIndex): ProjectWriteError | null {
    const failure = this.write(index);
    if (!failure) this.index = index;
    return failure;
  }

  private nextId(prefix: string): string {
    let id = '';
    do {
      id = `${prefix}-${this.clock().toString(36)}-${(this.seq++).toString(36)}${Math.random()
        .toString(36)
        .slice(2, 6)}`;
    } while (this.index.projects.some((project) => project.id === id));
    return id;
  }

  private nextSnapshotId(project: StoredProject): string {
    let id = '';
    do {
      id = `snap-${this.clock().toString(36)}-${(this.seq++).toString(36)}`;
    } while (project.snapshots.some((snapshot) => snapshot.id === id));
    return id;
  }

  /** The list with the active project's document replaced by the live one. */
  private withLiveDoc(projects: StoredProject[], updatedAt: number): StoredProject[] {
    const live = this.host.capture();
    return projects.map((project) =>
      project.id === this.index.activeId ? { ...project, doc: live, updatedAt } : project,
    );
  }

  // --------------------------------------------------------------- read side

  list(): ProjectSummary[] {
    return this.index.projects.map((project) => ({
      id: project.id,
      name: project.name,
      tags: [...project.tags],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      active: project.id === this.index.activeId,
      damaged: project.id !== this.index.activeId && project.doc === null,
      snapshots: project.snapshots.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    }));
  }

  get activeId(): string | null {
    return this.index.activeId;
  }

  /** True when a newer build's list is present and this one may not write. */
  get locked(): boolean {
    return this.readOnly;
  }

  /** The file text for one project, or `null` when it holds no document. */
  exportText(id: string): string | null {
    const project = this.index.projects.find((entry) => entry.id === id);
    if (!project) return null;
    const doc = id === this.index.activeId ? this.host.capture() : project.doc;
    return doc ? serializeProject(doc) : null;
  }

  // -------------------------------------------------------------- write side

  /**
   * Start a new project from the workspace as it is, and make it the active one.
   *
   * The current project keeps the document it had a moment ago: creating is
   * "fork what I am looking at", not "lose it".
   */
  create(name: string, tags: string[] = []): ProjectResult {
    if (this.index.projects.length >= MAX_PROJECTS) return { ok: false, reason: 'limit' };
    const now = this.clock();
    const projects = this.withLiveDoc(this.index.projects, now);
    const id = this.nextId('proj');
    projects.push({
      id,
      name: readName(name),
      tags: readTags(tags),
      createdAt: now,
      updatedAt: now,
      doc: null,
      snapshots: [],
    });
    const failure = this.apply({ activeId: id, projects });
    return failure ? { ok: false, reason: failure } : { ok: true };
  }

  /**
   * Make another project the live workspace.
   *
   * The order is the whole safety story: the list (with the current document
   * captured and the target's document still attached) is written *before* the
   * live workspace is replaced. A refused write returns `quota` with the current
   * work untouched; a live write that fails afterwards leaves the target's
   * document in the list and reports `degraded`.
   */
  switchTo(id: string): SwitchResult {
    if (id === this.index.activeId) return { ok: false, reason: 'same' };
    const target = this.index.projects.find((project) => project.id === id);
    if (!target) return { ok: false, reason: 'missing' };
    if (!target.doc) return { ok: false, reason: 'damaged' };
    const doc = target.doc;
    const now = this.clock();
    const projects = this.withLiveDoc(this.index.projects, now).map((project) =>
      project.id === id ? { ...project, doc: null, updatedAt: now } : project,
    );
    const failure = this.apply({ activeId: id, projects });
    if (failure) return { ok: false, reason: failure };
    if (this.host.load(doc)) return { ok: true, degraded: false };
    // The live document could not be written: keep the copy in the list so the
    // work exists somewhere the user can export it from.
    this.apply({
      activeId: id,
      projects: this.index.projects.map((project) => (project.id === id ? { ...project, doc } : project)),
    });
    return { ok: true, degraded: true };
  }

  rename(id: string, name: string): ProjectResult {
    if (!this.index.projects.some((project) => project.id === id)) return { ok: false, reason: 'missing' };
    const projects = this.index.projects.map((project) =>
      project.id === id ? { ...project, name: readName(name), updatedAt: this.clock() } : project,
    );
    const failure = this.apply({ ...this.index, projects });
    return failure ? { ok: false, reason: failure } : { ok: true };
  }

  setTags(id: string, tags: string[]): ProjectResult {
    if (!this.index.projects.some((project) => project.id === id)) return { ok: false, reason: 'missing' };
    const projects = this.index.projects.map((project) =>
      project.id === id ? { ...project, tags: readTags(tags), updatedAt: this.clock() } : project,
    );
    const failure = this.apply({ ...this.index, projects });
    return failure ? { ok: false, reason: failure } : { ok: true };
  }

  /** Copy a project, document and all, without switching to it. */
  duplicate(id: string): ProjectResult {
    if (this.index.projects.length >= MAX_PROJECTS) return { ok: false, reason: 'limit' };
    const source = this.index.projects.find((project) => project.id === id);
    if (!source) return { ok: false, reason: 'missing' };
    const doc = id === this.index.activeId ? this.host.capture() : source.doc;
    if (!doc) return { ok: false, reason: 'damaged' };
    const now = this.clock();
    const projects = this.index.projects.map((project) =>
      project.id === this.index.activeId ? { ...project, updatedAt: now } : project,
    );
    projects.push({
      ...source,
      id: this.nextId('proj'),
      name: `${source.name} · 2`,
      createdAt: now,
      updatedAt: now,
      doc,
      snapshots: [],
    });
    const failure = this.apply({ ...this.index, projects });
    return failure ? { ok: false, reason: failure } : { ok: true };
  }

  /**
   * Delete a project, never the live one: deleting what is currently open would
   * have to invent a new home for the live document mid-operation. The UI asks
   * the player to switch first, which is one deliberate step rather than a
   * surprise.
   */
  remove(id: string): ProjectResult {
    if (id === this.index.activeId) return { ok: false, reason: 'active' };
    if (!this.index.projects.some((project) => project.id === id)) return { ok: false, reason: 'missing' };
    const projects = this.index.projects.filter((project) => project.id !== id);
    const failure = this.apply({ ...this.index, projects });
    return failure ? { ok: false, reason: failure } : { ok: true };
  }

  /** Save the project's current workspace as a named point in time. */
  saveSnapshot(projectId: string, name: string): ProjectResult {
    const project = this.index.projects.find((entry) => entry.id === projectId);
    if (!project) return { ok: false, reason: 'missing' };
    const doc = projectId === this.index.activeId ? this.host.capture() : project.doc;
    if (!doc) return { ok: false, reason: 'damaged' };
    const list = [...project.snapshots, { id: this.nextSnapshotId(project), name: readName(name), createdAt: this.clock(), doc }];
    const snapshots = list.length > MAX_SNAPSHOTS ? list.slice(list.length - MAX_SNAPSHOTS) : list;
    const projects = this.index.projects.map((entry) =>
      entry.id === projectId ? { ...entry, snapshots, updatedAt: this.clock() } : entry,
    );
    const failure = this.apply({ ...this.index, projects });
    return failure ? { ok: false, reason: failure } : { ok: true };
  }

  /**
   * Put a snapshot back. The store records it as one undo step, so the workspace
   * that was replaced is one `Ctrl+Z` away — that is the whole reason a snapshot
   * does not need its own confirmation step.
   */
  restoreSnapshot(projectId: string, snapshotId: string): SwitchResult {
    const project = this.index.projects.find((entry) => entry.id === projectId);
    const snapshot = project?.snapshots.find((entry) => entry.id === snapshotId);
    if (!project || !snapshot) return { ok: false, reason: 'missing' };
    if (projectId !== this.index.activeId) {
      const switched = this.switchTo(projectId);
      if (!switched.ok) return switched;
    }
    return { ok: true, degraded: !this.host.load(snapshot.doc) };
  }

  deleteSnapshot(projectId: string, snapshotId: string): ProjectResult {
    const project = this.index.projects.find((entry) => entry.id === projectId);
    if (!project) return { ok: false, reason: 'missing' };
    const snapshots = project.snapshots.filter((entry) => entry.id !== snapshotId);
    if (snapshots.length === project.snapshots.length) return { ok: false, reason: 'missing' };
    const projects = this.index.projects.map((entry) =>
      entry.id === projectId ? { ...entry, snapshots, updatedAt: this.clock() } : entry,
    );
    const failure = this.apply({ ...this.index, projects });
    return failure ? { ok: false, reason: failure } : { ok: true };
  }

  /** Import a `.gs1proj` file and open it, refusing anything unreadable. */
  importText(text: string, name: string): ImportResult {
    const parsed = parseProjectFile(text);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    if (this.index.projects.length >= MAX_PROJECTS) return { ok: false, reason: 'limit' };
    const now = this.clock();
    const projects = this.withLiveDoc(this.index.projects, now);
    const id = this.nextId('proj');
    projects.push({
      id,
      name: readName(name),
      tags: [],
      createdAt: now,
      updatedAt: now,
      doc: null,
      snapshots: [],
    });
    const failure = this.apply({ activeId: id, projects });
    if (failure) return { ok: false, reason: failure };
    if (this.host.load(parsed.doc)) return { ok: true, degraded: false };
    this.apply({
      activeId: id,
      projects: this.index.projects.map((project) => (project.id === id ? { ...project, doc: parsed.doc } : project)),
    });
    return { ok: true, degraded: true };
  }
}

/** The workspace of the running app, as a project document. */
export function captureLiveDocument(): ProjectDoc {
  const snapshot = store.getSnapshot();
  const library = midiLibrary.snapshot();
  return {
    state: {
      params: { ...snapshot.state.params },
      params2: { ...snapshot.state.params2 },
      routes: snapshot.state.routes.map((route) => ({ ...route })),
      power: snapshot.state.power,
    },
    layout: projectLayout(snapshot.layout),
    userPresets: snapshot.userPresets.map((preset) => ({ ...preset })),
    currentPresetId: snapshot.currentPresetId,
    // Travels with the document so opening it does not have to fetch the factory
    // library to say which sound is selected (P9.26).
    currentPresetName: snapshot.currentPresetName,
    currentPresetTag: snapshot.currentPresetTag,
    scenes: snapshot.scenes.map((scene) => ({ ...scene, workspace: { ...scene.workspace } })),
    clips: library.clips,
    currentClipId: library.currentId,
  };
}

/**
 * Put a project document back on the running app.
 *
 * The project's own layout keys replace the live ones; everything a project
 * does not own (theme, language, CC map, the instance being edited) stays
 * exactly as the player left it.
 */
export function loadLiveDocument(doc: ProjectDoc): boolean {
  return store.loadDocument({
    state: doc.state,
    layout: { ...store.getSnapshot().layout, ...doc.layout },
    userPresets: doc.userPresets,
    currentPresetId: doc.currentPresetId,
    currentPresetName: doc.currentPresetName,
    currentPresetTag: doc.currentPresetTag,
    clips: doc.clips,
    currentClipId: doc.currentClipId,
  });
}

/** The one manager the app uses. */
export const projectManager = new ProjectManager(localStorage, {
  capture: captureLiveDocument,
  load: loadLiveDocument,
});
