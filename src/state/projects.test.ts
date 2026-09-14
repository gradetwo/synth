/**
 * Projects (P10.4).
 *
 * Three things are pinned here, in the order they can hurt:
 *
 *   * the document round-trips *field by field* and carries nothing that belongs
 *     to the person rather than to the piece (`activeInstance`, `theme`, `lang`);
 *   * every way a `.gs1proj` can be wrong is refused with a reason, and a
 *     malformed *part* of an otherwise good file is repaired rather than
 *     believed;
 *   * a full `localStorage` cannot lose the work in progress: the write order
 *     and the rollback are asserted against a storage that throws
 *     `QuotaExceededError` on demand.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, Param } from '@/audio/params';
import { hasCopy, hasCoreCopy, loadAllStrings } from '@/i18n';
import { PROJECT_STRINGS } from '@/i18n-panels';
import type { Track } from '@/midi/library';
import { defaultLayout } from './layout';
import type { Preset } from './presets';
import {
  captureLiveDocument,
  isQuotaError,
  loadLiveDocument,
  MAX_PROJECTS,
  MAX_SNAPSHOTS,
  normalizeProjectDoc,
  parseProjectFile,
  ProjectManager,
  PROJECT_FORMAT,
  PROJECT_SCHEMA,
  PROJECTS_KEY,
  projectLayout,
  serializeProject,
  type ProjectDoc,
  type ProjectFileError,
  type ProjectHost,
  type ProjectStorage,
  type ProjectWriteError,
} from './projects';
import { store } from './store';
import { unwrap } from './persist';

/** A `ProjectStorage` whose writes can be made to fail like a full disk. */
class FakeStorage implements ProjectStorage {
  private map = new Map<string, string>();
  /** `quota` throws a real `QuotaExceededError`; `off` throws anything else. */
  fail: 'quota' | 'off' | null = null;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.fail === 'quota') throw new DOMException('storage full', 'QuotaExceededError');
    if (this.fail === 'off') throw new Error('storage is not available');
    this.map.set(key, value);
  }
}

/** A stand-in for the running app: one workspace in memory. */
class FakeHost implements ProjectHost {
  loads = 0;
  refuseLoad = false;
  constructor(public doc: ProjectDoc) {}
  capture(): ProjectDoc {
    return clone(this.doc);
  }
  load(doc: ProjectDoc): boolean {
    this.loads += 1;
    if (this.refuseLoad) return false;
    this.doc = clone(doc);
    return true;
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function docWith(cutoff: number): ProjectDoc {
  const doc = baseDoc();
  doc.state.params[Param.FILTER_CUTOFF] = cutoff;
  return doc;
}

function baseDoc(): ProjectDoc {
  return {
    state: {
      params: { ...DEFAULT_PARAMS, [Param.FILTER_CUTOFF]: 1200, [Param.FILTER_RES]: 0.4 },
      params2: { ...DEFAULT_PARAMS, [Param.OSC1_WAVE]: 3 },
      routes: [{ src: 'lfo', dst: 'cutoff', amount: 0.5, enabled: true }],
      power: true,
    },
    layout: projectLayout({
      ...defaultLayout(),
      // These two are *not* project data: they must not reach the file.
      activeInstance: 2,
      theme: 'light',
      order: [...defaultLayout().order].reverse(),
      collapsed: { osc1: true },
      flowPos: { osc1: [12, 34] },
      fxGraphPos: { node1: [5, 6] },
      fxTemplates: [{ id: 'fxt-1', name: 'Wide', params: { [Param.FX_GRAPH]: 1 } }],
      clipTemplates: [
        { id: 'clt-1', name: 'Figure', notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }] },
      ],
      instanceMode: 'layer',
      splitNote: 62,
    }),
    userPresets: [
      {
        id: 'user-1',
        name: 'Mine',
        tag: 'USER',
        cat: 'USER',
        wave: 'sine',
        params: { [Param.FILTER_CUTOFF]: 900 },
        user: true,
      } satisfies Preset,
    ],
    currentPresetId: 'user-1',
    scenes: [
      { id: 'scene-1', name: 'Live', workspace: { order: [...defaultLayout().order], collapsed: {}, keyboardVisible: true, view: 'modules', flowPos: {}, flowHidden: [], displayExpanded: null, autoCollapsed: [] } },
    ],
    clips: [track('clip:1', 60)],
    currentClipId: 'clip:1',
  };
}

function track(id: string, note: number): Track {
  return {
    id,
    title: ['测试', 'test'],
    composer: 'test',
    group: 'clip',
    song: { name: id, bpm: 120, duration: 1, notes: [{ note, velocity: 0.8, start: 0, duration: 0.5 }] },
  };
}

describe('project document', () => {
  it('round-trips field by field', () => {
    const doc = baseDoc();
    const parsed = parseProjectFile(serializeProject(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc).toEqual(doc);
  });

  it('writes a marked, versioned file and keeps runtime state out of it', () => {
    const text = serializeProject(baseDoc());
    const file = JSON.parse(text) as { format: string; schema: number; doc: ProjectDoc };
    expect(file.format).toBe(PROJECT_FORMAT);
    expect(file.schema).toBe(PROJECT_SCHEMA);
    // The workspace half is the *project's* half: which instance the panels were
    // editing and which colour scheme the player likes are not the piece.
    expect('activeInstance' in file.doc.layout).toBe(false);
    expect('theme' in file.doc.layout).toBe(false);
    expect('ccMap' in file.doc.layout).toBe(false);
    expect(text).not.toContain('activeInstance');
    // The parts that *are* the piece survive.
    expect(file.doc.layout.instanceMode).toBe('layer');
    expect(file.doc.layout.fxTemplates).toHaveLength(1);
    expect(file.doc.clips).toHaveLength(1);
  });

  it('refuses a truncated file and says so', () => {
    const text = serializeProject(baseDoc());
    expect(parseProjectFile(text.slice(0, text.length - 40))).toEqual({ ok: false, reason: 'truncated' });
    expect(parseProjectFile('')).toEqual({ ok: false, reason: 'truncated' });
    expect(parseProjectFile('not json at all')).toEqual({ ok: false, reason: 'truncated' });
  });

  it('refuses a file this app did not write', () => {
    expect(parseProjectFile('[1,2,3]')).toEqual({ ok: false, reason: 'format' });
    expect(parseProjectFile(JSON.stringify({ format: 'gs1-preset', params: {} }))).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(parseProjectFile(JSON.stringify({ format: 'gs1-song', code: 'gs1.1.x' }))).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(parseProjectFile(JSON.stringify({ doc: baseDoc() }))).toEqual({ ok: false, reason: 'format' });
  });

  it('refuses a file from a newer build instead of half-reading it', () => {
    const file = { format: PROJECT_FORMAT, schema: PROJECT_SCHEMA + 1, doc: baseDoc() };
    expect(parseProjectFile(JSON.stringify(file))).toEqual({ ok: false, reason: 'version' });
    // A schema this build cannot name is a file it cannot trust either.
    expect(parseProjectFile(JSON.stringify({ format: PROJECT_FORMAT, doc: baseDoc() }))).toEqual({
      ok: false,
      reason: 'version',
    });
  });

  it('refuses a file missing the timbre or the layout', () => {
    const doc = baseDoc();
    const without = (patch: (copy: ProjectDoc) => void) => {
      const copy = clone(doc);
      patch(copy);
      return parseProjectFile(JSON.stringify({ format: PROJECT_FORMAT, schema: PROJECT_SCHEMA, doc: copy }));
    };
    expect(parseProjectFile(JSON.stringify({ format: PROJECT_FORMAT, schema: PROJECT_SCHEMA }))).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(without((copy) => delete (copy as Partial<ProjectDoc>).state)).toEqual({ ok: false, reason: 'missing' });
    expect(without((copy) => delete (copy.state as Partial<ProjectDoc['state']>).params)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(without((copy) => delete (copy.state as Partial<ProjectDoc['state']>).routes)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(without((copy) => delete (copy as Partial<ProjectDoc>).layout)).toEqual({ ok: false, reason: 'missing' });
  });

  it('repairs a malformed part instead of believing it', () => {
    const raw = clone(baseDoc()) as unknown as Record<string, unknown>;
    const state = raw.state as Record<string, unknown>;
    state.routes = [
      { src: 'nope', dst: 'cutoff', amount: 0.5, enabled: true },
      { src: 'lfo', dst: 'nope', amount: 0.5, enabled: true },
      { src: 'lfo', dst: 'cutoff', amount: 9, enabled: 1 },
    ];
    state.params = { [Param.FILTER_CUTOFF]: 900, bad: 1, [Param.FILTER_RES]: 'nope' };
    raw.userPresets = [{ name: 'no id' }, { id: 'user-2', name: 'Kept', tag: 'U', cat: 'USER', wave: 'sine', params: { 1: 1 } }];
    raw.scenes = [{ name: 'no id' }];
    raw.clips = [track('clip:keep', 60), { id: 'clip:broken', title: ['x', 'x'], song: { bpm: 'no' } }];
    const doc = normalizeProjectDoc(raw);
    expect(doc).not.toBeNull();
    expect(doc!.state.params[Param.FILTER_CUTOFF]).toBe(900);
    expect(Param.FILTER_RES in doc!.state.params).toBe(false);
    // Two junk routing rows dropped, the remaining one clamped; `enabled` is
    // only true when it is literally true, like every other stored flag.
    expect(doc!.state.routes).toEqual([{ src: 'lfo', dst: 'cutoff', amount: 1, enabled: false }]);
    expect(doc!.userPresets.map((preset) => preset.id)).toEqual(['user-2']);
    expect(doc!.scenes).toEqual([]);
    expect(doc!.clips.map((entry) => entry.id)).toEqual(['clip:keep']);
  });

  it('recognises the exception a full disk throws and nothing else', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError(new Error('full'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe('project list', () => {
  let storage: FakeStorage;
  let host: FakeHost;
  let manager: ProjectManager;

  beforeEach(() => {
    storage = new FakeStorage();
    host = new FakeHost(docWith(1000));
    manager = new ProjectManager(storage, host, () => 1_700_000_000_000);
  });

  const ids = () => manager.list().map((project) => project.id);

  it('keeps each project’s work and brings it back on a switch', () => {
    expect(manager.create('A').ok).toBe(true);
    host.doc = docWith(2000);
    expect(manager.create('B').ok).toBe(true);
    host.doc = docWith(3000);

    const [first, second] = ids();
    const back = manager.switchTo(first);
    expect(back).toEqual({ ok: true, degraded: false });
    expect(host.doc.state.params[Param.FILTER_CUTOFF]).toBe(2000);
    expect(manager.switchTo(second)).toEqual({ ok: true, degraded: false });
    expect(host.doc.state.params[Param.FILTER_CUTOFF]).toBe(3000);
    // Switching to what is already open is refused, not a no-op that reports
    // success it did not do.
    expect(manager.switchTo(second)).toEqual({ ok: false, reason: 'same' });
    expect(manager.switchTo('nope')).toEqual({ ok: false, reason: 'missing' });
  });

  it('comes back after a reload: a fresh manager over the same storage', () => {
    manager.create('A');
    host.doc = docWith(2000);
    manager.create('B');
    host.doc = docWith(3000);
    const [first, second] = ids();

    const reloaded = new ProjectManager(storage, new FakeHost(docWith(3000)), () => 1);
    expect(reloaded.list().map((project) => project.name)).toEqual(['A', 'B']);
    expect(reloaded.activeId).toBe(second);
    expect(reloaded.switchTo(first)).toEqual({ ok: true, degraded: false });
    // The document came off the disk, not out of the air.
    expect(storage.getItem(PROJECTS_KEY)).toContain('proj-');
  });

  it('renames, tags, duplicates and deletes', () => {
    manager.create('A');
    const [first] = ids();
    expect(manager.rename(first, 'Renamed').ok).toBe(true);
    expect(manager.setTags(first, ['live', 'set one', 'live']).ok).toBe(true);
    const renamed = manager.list()[0];
    expect(renamed.name).toBe('Renamed');
    expect(renamed.tags).toEqual(['live', 'set one']);

    host.doc = docWith(4242);
    expect(manager.duplicate(first).ok).toBe(true);
    const copy = manager.list().find((project) => !project.active && project.name.startsWith('Renamed'))!;
    expect(manager.switchTo(copy.id)).toEqual({ ok: true, degraded: false });
    expect(host.doc.state.params[Param.FILTER_CUTOFF]).toBe(4242);

    // The live project cannot be deleted; the other one can.
    expect(manager.remove(copy.id)).toEqual({ ok: false, reason: 'active' });
    expect(manager.remove(first).ok).toBe(true);
    expect(manager.list()).toHaveLength(1);
  });

  it('refuses a switch to a project whose document did not survive the round trip', () => {
    manager.create('A');
    host.doc = docWith(2000);
    manager.create('B');
    const [first] = ids();
    // Corrupt the stored document of the *inactive* project by hand: on the next
    // read it is unusable and has to be reported as such, not loaded as empty.
    const envelope = JSON.parse(storage.getItem(PROJECTS_KEY) as string) as {
      schema: number;
      data: { activeId: string; projects: Array<{ id: string; doc: unknown }> };
    };
    envelope.data.projects.find((project) => project.id === first)!.doc = {
      state: { params: 'nope' },
      layout: {},
    };
    storage.setItem(PROJECTS_KEY, JSON.stringify(envelope));

    const reloaded = new ProjectManager(storage, new FakeHost(docWith(1000)));
    expect(reloaded.list().find((project) => project.id === first)!.damaged).toBe(true);
    expect(reloaded.switchTo(first)).toEqual({ ok: false, reason: 'damaged' });
  });

  it('stops at the project cap instead of growing without bound', () => {
    for (let index = 0; index < MAX_PROJECTS; index++) expect(manager.create(`P${index}`).ok).toBe(true);
    expect(manager.create('one too many')).toEqual({ ok: false, reason: 'limit' });
    expect(manager.list()).toHaveLength(MAX_PROJECTS);
  });

  it('keeps every reason a caller can see covered by copy', async () => {
    await loadAllStrings();
    const writes: ProjectWriteError[] = [
      'quota',
      'unavailable',
      'limit',
      'missing',
      'active',
      'same',
      'damaged',
      'readonly',
    ];
    const files: ProjectFileError[] = ['truncated', 'format', 'version', 'missing'];
    for (const reason of writes) expect(hasCopy(`project.fail.${reason}`), reason).toBe(true);
    for (const reason of files) expect(hasCopy(`project.bad.${reason}`), reason).toBe(true);
  });
});

describe('projects on a full disk', () => {
  let storage: FakeStorage;
  let host: FakeHost;
  let manager: ProjectManager;

  beforeEach(() => {
    storage = new FakeStorage();
    host = new FakeHost(docWith(1000));
    manager = new ProjectManager(storage, host, () => 1_700_000_000_000);
  });

  it('cancels the switch, keeps the current work and can still export', () => {
    manager.create('A');
    host.doc = docWith(2000);
    manager.create('B');
    host.doc = docWith(3000);
    const [first] = manager.list().map((project) => project.id);
    const before = clone(host.doc);
    const activeBefore = manager.activeId;

    storage.fail = 'quota';
    expect(manager.switchTo(first)).toEqual({ ok: false, reason: 'quota' });
    // Nothing moved: not the live workspace, not the list, not the active id.
    expect(host.loads).toBe(0);
    expect(host.doc).toEqual(before);
    expect(manager.activeId).toBe(activeBefore);
    expect(manager.list()).toHaveLength(2);
    // The escape hatch still works when storage does not: the file is built in
    // memory and never touches `setItem`.
    const text = manager.exportText(manager.activeId as string);
    expect(text).toContain(PROJECT_FORMAT);
    expect(parseProjectFile(text as string).ok).toBe(true);
  });

  it('reports quota for every write, and never claims success', () => {
    manager.create('A');
    const [first] = manager.list().map((project) => project.id);
    storage.fail = 'quota';
    expect(manager.create('C')).toEqual({ ok: false, reason: 'quota' });
    expect(manager.rename(first, 'x')).toEqual({ ok: false, reason: 'quota' });
    expect(manager.setTags(first, ['x'])).toEqual({ ok: false, reason: 'quota' });
    expect(manager.duplicate(first)).toEqual({ ok: false, reason: 'quota' });
    expect(manager.saveSnapshot(first, 'snap')).toEqual({ ok: false, reason: 'quota' });
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0].name).toBe('A');

    // A different failure is reported as itself, not as a full disk.
    storage.fail = 'off';
    expect(manager.create('D')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('says the switch was degraded when only the live write fails', () => {
    manager.create('A');
    host.doc = docWith(2000);
    manager.create('B');
    const [first] = manager.list().map((project) => project.id);

    // A fresh manager, as a page load would build, over the same storage.
    const reloaded = new ProjectManager(storage, host, () => 2);
    host.refuseLoad = true;
    expect(reloaded.switchTo(first)).toEqual({ ok: true, degraded: true });
    // The document stayed in the list as the recovery copy the toast tells the
    // player to export.
    const envelope = unwrap(JSON.parse(storage.getItem(PROJECTS_KEY) as string)) as unknown as {
      data: { projects: Array<{ id: string; doc: unknown }> };
    };
    expect(envelope.data.projects.find((project) => project.id === first)!.doc).toBeTruthy();
  });

  it('goes read-only rather than overwrite a list from a newer build', () => {
    storage.setItem(PROJECTS_KEY, JSON.stringify({ schema: 99, data: { activeId: 'x', projects: [] } }));
    const locked = new ProjectManager(storage, new FakeHost(docWith(1000)), () => 1);
    expect(locked.locked).toBe(true);
    expect(locked.list()).toEqual([]);
    expect(locked.create('A')).toEqual({ ok: false, reason: 'readonly' });
    // The newer list is kept aside and the original is still there.
    expect(storage.getItem(`${PROJECTS_KEY}.newer`)).toBeTruthy();
    expect(storage.getItem(PROJECTS_KEY)).toContain('"schema":99');
  });
});

describe('snapshots', () => {
  it('restores a point in time and keeps the newest at the cap', () => {
    const storage = new FakeStorage();
    const host = new FakeHost(docWith(1000));
    const manager = new ProjectManager(storage, host, () => 1_700_000_000_000);
    manager.create('A');
    const id = manager.activeId as string;

    host.doc = docWith(1111);
    expect(manager.saveSnapshot(id, 'first').ok).toBe(true);
    host.doc = docWith(2222);
    expect(manager.saveSnapshot(id, 'second').ok).toBe(true);
    host.doc = docWith(3333);

    const snapshots = manager.list()[0].snapshots;
    expect(snapshots.map((snapshot) => snapshot.name)).toEqual(['first', 'second']);
    expect(manager.restoreSnapshot(id, snapshots[0].id)).toEqual({ ok: true, degraded: false });
    expect(host.doc.state.params[Param.FILTER_CUTOFF]).toBe(1111);
    expect(host.loads).toBe(1);

    for (let index = 0; index < MAX_SNAPSHOTS + 3; index++) manager.saveSnapshot(id, `s${index}`);
    expect(manager.list()[0].snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(manager.list()[0].snapshots[MAX_SNAPSHOTS - 1].name).toBe(`s${MAX_SNAPSHOTS + 2}`);
  });
});

describe('importing a project file', () => {
  it('opens it as a new active project, or refuses it with a reason', () => {
    const storage = new FakeStorage();
    const host = new FakeHost(docWith(1000));
    const manager = new ProjectManager(storage, host, () => 1_700_000_000_000);
    manager.create('A');
    host.doc = docWith(2000);

    const text = serializeProject(docWith(7777));
    const imported = manager.importText(text, 'From a friend');
    expect(imported).toEqual({ ok: true, degraded: false });
    expect(host.doc.state.params[Param.FILTER_CUTOFF]).toBe(7777);
    expect(manager.list().map((project) => project.name)).toEqual(['A', 'From a friend']);
    // The project that was open kept what it had: importing forks the workspace.
    const previous = manager.list().find((project) => project.name === 'A')!;
    manager.switchTo(previous.id);
    expect(host.doc.state.params[Param.FILTER_CUTOFF]).toBe(2000);

    expect(manager.importText('{"format":"gs1-proj"', 'x')).toEqual({ ok: false, reason: 'truncated' });
    expect(manager.importText('{}', 'x')).toEqual({ ok: false, reason: 'format' });
    expect(
      manager.importText(JSON.stringify({ format: PROJECT_FORMAT, schema: 9, doc: docWith(1) }), 'x'),
    ).toEqual({ ok: false, reason: 'version' });
    expect(
      manager.importText(JSON.stringify({ format: PROJECT_FORMAT, schema: PROJECT_SCHEMA, doc: {} }), 'x'),
    ).toEqual({ ok: false, reason: 'missing' });
    // A refused import changes nothing.
    expect(manager.list()).toHaveLength(2);

    storage.fail = 'quota';
    expect(manager.importText(text, 'full disk')).toEqual({ ok: false, reason: 'quota' });
    expect(manager.list()).toHaveLength(2);
  });
});

describe('the panel’s copy', () => {
  beforeAll(async () => {
    await loadAllStrings();
  });

  it('has both languages and does not shadow the core table', () => {
    for (const [key, value] of Object.entries(PROJECT_STRINGS)) {
      expect(value, key).toHaveLength(2);
      expect(value[0].length, `${key} zh`).toBeGreaterThan(0);
      expect(value[1].length, `${key} en`).toBeGreaterThan(0);
      expect(hasCoreCopy(key), key).toBe(false);
    }
  });
});

describe('projects over the live store', () => {
  beforeEach(() => {
    localStorage.clear();
    store.applyPresetById('init');
  });

  it('switches the real workspace and restores a snapshot as one undo step', () => {
    const manager = new ProjectManager(localStorage, {
      capture: captureLiveDocument,
      load: loadLiveDocument,
    });
    manager.create('A');
    store.setParam(Param.FILTER_CUTOFF, 1111);
    manager.create('B');
    store.setParam(Param.FILTER_CUTOFF, 2222);
    const [first] = manager.list().map((project) => project.id);

    expect(manager.switchTo(first)).toEqual({ ok: true, degraded: false });
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(1111);

    // A snapshot of the project that is open: restoring it is one undo step, so
    // the workspace it replaced is one Ctrl+Z away.
    const id = manager.activeId as string;
    store.setParam(Param.FILTER_CUTOFF, 3333);
    expect(manager.saveSnapshot(id, 'point').ok).toBe(true);
    store.setParam(Param.FILTER_CUTOFF, 4444);
    // `setParam` coalesces history on a timer; pin the state being left so the
    // undo below has a definite entry to land on.
    store.mark();
    const point = manager.list().find((project) => project.active)!.snapshots[0];
    expect(manager.restoreSnapshot(id, point.id)).toEqual({ ok: true, degraded: false });
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(3333);
    expect(store.undo()).toBe(true);
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(4444);
  });
});
