import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, FX_KINDS, Param, createDefaultState, fxKindToInt } from '@/audio/params';
import { midiLibrary } from '@/midi/library';
import { DEFAULT_PRESET } from './preset-model';
import { FACTORY_PRESETS } from './presets';
import { PresetsNotLoadedError, SynthStore, store } from './store';
import { findFxTemplate, fxTemplateEntries, isFxTemplateParam } from './fxtemplates';
import { decodePatch } from './share';
import { unwrap, wrap } from './persist';

describe('synth store', () => {
  beforeEach(async () => {
    await store.applyPresetById('init');
    for (const p of store.allPresets().filter((x) => x.user)) store.deletePreset(p.id);
  });

  it('applies factory presets and reports the current preset', async () => {
    await store.applyPresetById('pluck');
    expect(store.currentPreset()?.id).toBe('pluck');
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(5200);
    expect(store.getParam(Param.ENV_SUSTAIN)).toBe(0);
  });

  it('updates single parameters', () => {
    store.setParam(Param.FILTER_CUTOFF, 1234);
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(1234);
  });

  it('applies a batch of parameters as one change', () => {
    // A routing-graph rebuild writes 37 parameters at once; committing each on
    // its own redrew the whole interface 37 times (and wrote storage twice per
    // parameter), which was seconds of frozen UI on a slow engine.
    store.setParam(Param.FILTER_CUTOFF, 1000);
    let notified = 0;
    const stop = store.subscribe(() => {
      notified += 1;
    });
    const before = store.getParam(Param.FX_GRAPH);
    store.setParams(
      [
        [Param.FX_GRAPH, 1],
        [Param.FX_NODE1_IN1, 1],
        [Param.FX_NODE1_IN1_GAIN, 0.5],
        [Param.FILTER_CUTOFF, 4000],
      ],
      { immediate: true },
    );
    stop();
    expect(notified).toBe(1);
    expect(store.getParam(Param.FX_GRAPH)).toBe(1);
    expect(store.getParam(Param.FX_NODE1_IN1)).toBe(1);
    expect(store.getParam(Param.FX_NODE1_IN1_GAIN)).toBeCloseTo(0.5, 6);
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(4000);

    // A batch that changes nothing does not notify at all.
    let again = 0;
    const stop2 = store.subscribe(() => {
      again += 1;
    });
    store.setParams([[Param.FX_GRAPH, 1]]);
    stop2();
    expect(again).toBe(0);
    expect(before === 0 || before === 1).toBe(true);
  });

  it('steps through the preset list in both directions', async () => {
    const first = store.currentPreset()?.id;
    await store.stepPreset(1);
    const second = store.currentPreset()?.id;
    expect(second).not.toBe(first);
    await store.stepPreset(-1);
    expect(store.currentPreset()?.id).toBe(first);
  });

  it('keeps randomized patches inside the DSP ranges', () => {
    store.randomize();
    expect(store.getParam(Param.FILTER_CUTOFF)).toBeGreaterThanOrEqual(20);
    expect(store.getParam(Param.FILTER_CUTOFF)).toBeLessThanOrEqual(20000);
    expect(store.getParam(Param.OSC1_LEVEL)).toBeGreaterThanOrEqual(0);
    expect(store.getParam(Param.OSC1_LEVEL)).toBeLessThanOrEqual(1);
    expect(store.getParam(Param.ENV_ATTACK)).toBeGreaterThanOrEqual(0.0005);
    expect(store.getParam(Param.ENV_ATTACK)).toBeLessThanOrEqual(8);
  });

  it('saves and deletes user presets', async () => {
    store.setParam(Param.FILTER_CUTOFF, 777);
    const saved = store.savePreset('TEST PATCH');
    expect(saved.user).toBe(true);
    expect(store.allPresets().some((p) => p.id === saved.id)).toBe(true);
    expect(store.currentPreset()?.id).toBe(saved.id);

    await store.applyPresetById('init');
    await store.applyPresetById(saved.id);
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(777);

    store.deletePreset(saved.id);
    expect(store.allPresets().some((p) => p.id === saved.id)).toBe(false);
  });

  it('persists state to localStorage', () => {
    store.setParam(Param.FILTER_RES, 0.42);
    const raw = localStorage.getItem('gs1:state:v1');
    expect(raw).toBeTruthy();
    // Documents are stored in a schema envelope (`state/persist.ts`), so a test
    // that reads storage has to read it the same way the loader does.
    const stored = unwrap(JSON.parse(raw as string));
    expect((stored?.data as { params: Record<number, number> }).params[Param.FILTER_RES]).toBe(0.42);
  });

  it('toggles power without losing the patch', () => {
    store.setParam(Param.FILTER_CUTOFF, 4321);
    store.setPower(false);
    expect(store.getSnapshot().state.power).toBe(false);
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(4321);
    store.setPower(true);
  });

  it('collapses, reorders and toggles the keyboard', () => {
    store.resetLayout();
    expect(store.getSnapshot().layout.collapsed.osc1).toBeUndefined();
    store.toggleCollapsed('osc1');
    expect(store.getSnapshot().layout.collapsed.osc1).toBe(true);
    store.toggleCollapsed('osc1');
    expect(store.getSnapshot().layout.collapsed.osc1).toBeUndefined();

    store.moveModuleBefore('fx', 'osc1');
    expect(store.getSnapshot().layout.order[0]).toBe('fx');
    store.moveModuleBefore('fx', 'matrix');
    const order = store.getSnapshot().layout.order;
    expect(order.indexOf('fx') + 1).toBe(order.indexOf('matrix'));

    expect(store.getSnapshot().layout.keyboardVisible).toBe(true);
    store.toggleKeyboard();
    expect(store.getSnapshot().layout.keyboardVisible).toBe(false);
    store.toggleKeyboard();

    store.resetLayout();
    expect(store.getSnapshot().layout.order[0]).toBe('osc1');
  });

  it('expands the phone first-run collapse again on desktop', () => {
    store.resetLayout();
    store.applyPhoneDefaults();
    const layout = () => store.getSnapshot().layout;
    expect(layout().collapsed.lfo).toBe(true);
    expect(layout().autoCollapsed).toEqual(['lfo', 'matrix', 'fx', 'fx2']);

    // A manual collapse is the user's choice and survives the desktop reset.
    store.toggleCollapsed('osc1');
    expect(layout().autoCollapsed).not.toContain('osc1');

    store.expandAutoCollapsed();
    expect(layout().collapsed.lfo).toBeUndefined();
    expect(layout().collapsed.fx2).toBeUndefined();
    expect(layout().collapsed.osc1).toBe(true);
    expect(layout().autoCollapsed).toEqual([]);

    store.resetLayout();
    expect(layout().collapsed.osc1).toBeUndefined();
  });

  it('undoes and redoes preset changes', async () => {
    await store.applyPresetById('init');
    await store.applyPresetById('acid');
    expect(store.getSnapshot().canUndo).toBe(true);
    store.undo();
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(18000);
    expect(store.getSnapshot().canRedo).toBe(true);
    store.redo();
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(800);
  });

  it('stores and recalls A/B patches', async () => {
    await store.applyPresetById('init');
    store.selectSlot('b');
    expect(store.getSnapshot().activeSlot).toBe('b');
    store.setParam(Param.FILTER_CUTOFF, 4321);
    store.selectSlot('a');
    expect(store.getSnapshot().activeSlot).toBe('a');
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(18000);
    store.selectSlot('b');
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(4321);
  });

  it('toggles the language and persists it', () => {
    const before = store.getSnapshot().layout.lang;
    store.toggleLang();
    const after = store.getSnapshot().layout.lang;
    expect(after).not.toBe(before);
    const layout = unwrap(JSON.parse(localStorage.getItem('gs1:layout:v1') as string));
    expect((layout?.data as { lang: string }).lang).toBe(after);
    store.toggleLang();
  });

  it('adds and removes modulation routes', () => {
    const before = store.getSnapshot().state.routes.length;
    store.addRoute();
    expect(store.getSnapshot().state.routes.length).toBe(before + 1);
    store.removeRoute(0);
    expect(store.getSnapshot().state.routes.length).toBe(before);
  });
});

describe('effect-graph templates', () => {
  it('applies a template and leaves every other parameter alone', async () => {
    const s = new SynthStore();
    s.resetLayout();
    await s.applyPresetById('init');
    // Values on both sides of the whitelist boundary.
    s.setParams([
      [Param.FILTER_CUTOFF, 1234],
      [Param.FX_DELAY_MIX, 0.42],
      [Param.FX_DELAY_ON, 0],
      [Param.OSC1_LEVEL, 0.31],
    ]);
    const before = { ...s.getSnapshot().state.params };

    let notified = 0;
    const stop = s.subscribe(() => {
      notified += 1;
    });
    expect(s.applyFxTemplate('fxg:dual-delay')).toBe(true);
    stop();
    // One commit for the whole routing, like a chain→graph rebuild.
    expect(notified).toBe(1);

    const after = s.getSnapshot().state.params;
    const template = findFxTemplate([], 'fxg:dual-delay')!;
    // The graph is exactly the template's, id for id.
    for (const [id, value] of fxTemplateEntries(template)) {
      expect(after[id], `id ${id}`).toBe(value);
    }
    // Everything outside the whitelist is bit for bit what it was.
    for (const id of Object.keys(before).map(Number)) {
      if (isFxTemplateParam(id)) continue;
      expect(after[id], `id ${id} must not move`).toBe(before[id]);
    }
    expect(after[Param.FX_CHAIN1]).toBe(fxKindToInt('delay'));
    expect(after[Param.FX_CHAIN2]).toBe(fxKindToInt('delay'));
    expect(after[Param.FX_DELAY_MIX]).toBe(0.42);
    expect(after[Param.FILTER_CUTOFF]).toBe(1234);
  });

  it('saves the current routing as a workspace template and recalls it', async () => {
    const s = new SynthStore();
    s.resetLayout();
    await s.applyPresetById('init');
    s.setParams(
      [
        [Param.FX_GRAPH, 1],
        [Param.FX_CHAIN2, fxKindToInt('crush')],
        [Param.FX_NODE3_IN1_GAIN, 0.5],
      ],
      { immediate: true },
    );
    const saved = s.saveFxTemplate('我的模板');
    expect(s.getSnapshot().layout.fxTemplates).toHaveLength(1);
    expect(saved.params[Param.FX_CHAIN2]).toBe(fxKindToInt('crush'));

    // The list is workspace data, so a fresh store reads it back.
    const reloaded = new SynthStore();
    const list = reloaded.getSnapshot().layout.fxTemplates;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(saved.id);
    expect(list[0].name).toBe('我的模板');
    expect(list[0].params[Param.FX_NODE3_IN1_GAIN]).toBeCloseTo(0.5, 6);

    // Change the graph, then recall the template.
    reloaded.setParam(Param.FX_CHAIN2, fxKindToInt('reverb'));
    expect(reloaded.applyFxTemplate(saved.id)).toBe(true);
    expect(reloaded.getParam(Param.FX_CHAIN2)).toBe(fxKindToInt('crush'));

    expect(reloaded.deleteFxTemplate(saved.id)).toBe(true);
    expect(reloaded.getSnapshot().layout.fxTemplates).toHaveLength(0);
    // Deleting what is not there, or applying an unknown id, is a no-op.
    expect(reloaded.deleteFxTemplate(saved.id)).toBe(false);
    expect(reloaded.applyFxTemplate('nope')).toBe(false);
  });

  it('repairs a corrupt stored template instead of loading it', () => {
    localStorage.setItem(
      'gs1:layout:v1',
      JSON.stringify(
        wrap({
          fxTemplates: [
            {
              id: 'bad',
              name: 'Bad',
              params: {
                [Param.FX_REVERB_MODE]: 1, // never in the whitelist
                [Param.FX_CHAIN1]: 99, // a kind past the end reads as none
                [Param.FX_NODE1_IN1]: 200, // clamped, then read as an illegal forward edge
                [Param.FX_NODE1_IN1_GAIN]: 50, // clamped to 4
              },
            },
            { id: 'empty', name: 'Empty', params: { [Param.FILTER_CUTOFF]: 1 } },
            'nope',
          ],
        }),
      ),
    );
    const s = new SynthStore();
    const list = s.getSnapshot().layout.fxTemplates;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('bad');
    expect(list[0].params[Param.FX_CHAIN1]).toBe(FX_KINDS.length - 1);
    expect(list[0].params[Param.FX_NODE1_IN1]).toBe(0);
    expect(list[0].params[Param.FX_NODE1_IN1_GAIN]).toBe(4);
    expect(Param.FX_REVERB_MODE in list[0].params).toBe(false);
  });

  it('keeps templates out of a share code while the graph travels as before', async () => {
    const s = new SynthStore();
    s.resetLayout();
    await s.applyPresetById('init');
    expect(s.applyFxTemplate('fxg:dual-delay')).toBe(true);
    const saved = s.saveFxTemplate('share test');
    const code = s.shareCode();
    const payload = decodePatch(code);
    expect(payload).toBeTruthy();
    // The graph is patch data, so it rides in the code exactly as it always has.
    expect(payload!.params[Param.FX_GRAPH]).toBe(1);
    expect(payload!.params[Param.FX_CHAIN1]).toBe(fxKindToInt('delay'));
    // The template list is workspace data: it is nowhere in the payload.
    expect(JSON.stringify(payload)).not.toContain(saved.id);

    const other = new SynthStore();
    other.resetLayout();
    expect(other.getSnapshot().layout.fxTemplates).toHaveLength(0);
    expect(other.importPatchCode(code)).toBe(true);
    expect(other.getParam(Param.FX_CHAIN1)).toBe(fxKindToInt('delay'));
    // Receiving a patch never imports the sender's template list.
    expect(other.getSnapshot().layout.fxTemplates).toHaveLength(0);
  });
});

describe('importing a patch file', () => {
  beforeEach(async () => {
    await store.applyPresetById('init');
  });

  it('applies a .gs1.json patch and reports success', () => {
    const text = JSON.stringify({
      format: 'gs1-preset',
      name: 'From a file',
      params: { [String(Param.FILTER_CUTOFF)]: 900, [String(Param.FILTER_RES)]: 0.42 },
      routes: [{ src: 'lfo1', dst: 'cutoff', amount: -0.4, enabled: true }],
    });
    expect(store.importPresetFile(text)).toBe(true);
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(900);
    expect(store.getParam(Param.FILTER_RES)).toBe(0.42);
    expect(store.currentPreset()?.name).toBe('From a file');
  });

  it('refuses anything else without touching the patch', () => {
    store.setParam(Param.FILTER_CUTOFF, 1234);
    for (const text of ['', 'nope', '{}', '{"format":"gs1-preset"}', '{"format":"gs1-preset","params":[]}']) {
      expect(store.importPresetFile(text)).toBe(false);
    }
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(1234);
  });

  it('treats a .gs1song file as a share code', () => {
    const code = store.shareCode();
    expect(store.importPresetFile(JSON.stringify({ format: 'gs1-song', schema: 2, code }))).toBe(true);
    // A file whose code does not decode is refused like any other share code.
    expect(store.importPresetFile(JSON.stringify({ format: 'gs1-song', code: 'gs1.1.not-a-patch' }))).toBe(
      false,
    );
  });
});

describe('undo covers the whole document', () => {
  it('undoes a module collapse', async () => {
    await store.applyPresetById('init');
    const before = store.getSnapshot().layout.collapsed.filter;
    store.toggleCollapsed('filter' as never);
    expect(store.getSnapshot().layout.collapsed.filter).not.toBe(before);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().layout.collapsed.filter).toBe(before);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot().layout.collapsed.filter).not.toBe(before);
    store.undo();
  });

  it('undoes a view change', () => {
    store.setView('modules');
    store.setView('flow');
    expect(store.getSnapshot().layout.view).toBe('flow');
    store.undo();
    expect(store.getSnapshot().layout.view).toBe('modules');
  });

  it('undoes a deleted user preset', () => {
    const preset = store.savePreset('UNDO ME · 撤销测试');
    const count = store.getSnapshot().userPresets.length;
    store.deletePreset(preset.id);
    expect(store.getSnapshot().userPresets.length).toBe(count - 1);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().userPresets.length).toBe(count);
    expect(store.getSnapshot().userPresets.some((p) => p.id === preset.id)).toBe(true);
    // Clean up so the next test starts from the same place.
    store.deletePreset(preset.id);
  });

  it('undoes removing a recorded clip', () => {
    midiLibrary.put({
      id: 'clip:undo-test',
      title: ['撤销测试', 'undo test'],
      composer: 'test',
      group: 'clip',
      song: { name: 'undo test', bpm: 120, duration: 1, notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }] },
    });
    store.mark();
    const tracks = midiLibrary.getTracks().length;
    midiLibrary.remove('clip:undo-test');
    expect(midiLibrary.getTracks().length).toBe(tracks - 1);
    // The clip came back through the history, not by luck.
    store.mark();
    midiLibrary.remove('clip:undo-test');
    expect(store.undo()).toBe(true);
    expect(midiLibrary.getTracks().some((t) => t.id === 'clip:undo-test')).toBe(true);
    midiLibrary.remove('clip:undo-test');
  });
});

describe('the session starts consistent', () => {
  it('restores the preset name together with the patch', async () => {
    // The patch is persisted; the displayed name used to be a hard default, so
    // opening the app showed one preset and played another.
    // Not the first factory preset: with the default the mismatch would be
    // invisible.
    await store.applyPresetById('wurli');
    const id = store.getSnapshot().currentPresetId;
    const params = { ...store.getSnapshot().state.params };

    // Simulate a reload: a fresh store instance reading the same storage.
    const reloaded = new SynthStore();
    expect(reloaded.getSnapshot().currentPresetId).toBe(id);
    expect(reloaded.getParam(Param.FILTER_CUTOFF)).toBeCloseTo(params[Param.FILTER_CUTOFF], 6);
  });
});

describe('two instances', () => {
  it('edits the active instance and leaves the other alone', () => {
    const s = new SynthStore();
    s.setActiveInstance(1);
    s.setParam(Param.FILTER_CUTOFF, 1234);
    expect(s.getSnapshot().state.params[Param.FILTER_CUTOFF]).toBeCloseTo(1234, 6);

    s.setActiveInstance(2);
    expect(s.getParam(Param.FILTER_CUTOFF)).not.toBeCloseTo(1234, 1);
    s.setParam(Param.FILTER_CUTOFF, 4321);
    expect(s.getSnapshot().state.params2[Param.FILTER_CUTOFF]).toBeCloseTo(4321, 6);
    // Instance 1 still has its own value: the panels are per instance.
    expect(s.getSnapshot().state.params[Param.FILTER_CUTOFF]).toBeCloseTo(1234, 6);

    s.setActiveInstance(1);
    expect(s.getParam(Param.FILTER_CUTOFF)).toBeCloseTo(1234, 6);
  });

  it('hands a whole-patch view the active instance, not always instance 1', () => {
    // §一.8: the effect graph renders many parameters as one picture, so it
    // cannot ask `getParam` per id. It used to read `state.params` directly and
    // so always drew instance 1 while its edits went to the active layer.
    const s = new SynthStore();
    s.setActiveInstance(1);
    s.setParam(Param.FX_CHAIN1, 0);
    s.setActiveInstance(2);
    s.setParam(Param.FX_CHAIN1, 3);
    expect(s.getActiveParams()[Param.FX_CHAIN1]).toBe(3);

    s.setActiveInstance(1);
    expect(s.getActiveParams()[Param.FX_CHAIN1]).toBe(0);
    // The set is the live layer object, so a selector can bail out on it.
    expect(s.getActiveParams()).toBe(s.getSnapshot().state.params);
  });

  it('starts instance 2 from a usable patch and keeps it across a reload', () => {
    const s = new SynthStore();
    const second = s.getSnapshot().state.params2;
    expect(second[Param.OSC1_ON]).toBe(DEFAULT_PARAMS[Param.OSC1_ON]);

    s.setActiveInstance(2);
    s.setParam(Param.OSC1_LEVEL, 0.123);
    // A fresh store reads the persisted document, like a page reload.
    const reloaded = new SynthStore();
    expect(reloaded.getSnapshot().state.params2[Param.OSC1_LEVEL]).toBeCloseTo(0.123, 6);
    expect(reloaded.getSnapshot().layout.activeInstance).toBe(2);
  });

  it('remembers the layer/split routing', () => {
    const s = new SynthStore();
    s.setInstanceRouting({ mode: 'split', splitNote: 64 });
    const reloaded = new SynthStore();
    expect(reloaded.getSnapshot().layout.instanceMode).toBe('split');
    expect(reloaded.getSnapshot().layout.splitNote).toBe(64);
    s.setInstanceRouting({ mode: 'single' });
    expect(s.getSnapshot().layout.instanceMode).toBe('single');
  });
});

describe('layered patches', () => {
  it('saves and recalls the second layer with the patch', () => {
    const s = new SynthStore();
    // Build a layered patch: instance 2 a square, routed as a layer.
    s.setActiveInstance(2);
    s.setParam(Param.OSC1_WAVE, 3);
    s.setActiveInstance(1);
    s.setInstanceRouting({ mode: 'layer', splitNote: 60 });
    const saved = s.savePreset('Layer Test');

    // Change everything, then recall: layer and routing come back with it.
    s.setActiveInstance(2);
    s.setParam(Param.OSC1_WAVE, 0);
    s.setInstanceRouting({ mode: 'single' });
    s.setActiveInstance(1);

    s.applyPreset(saved);
    expect(s.getSnapshot().state.params2[Param.OSC1_WAVE]).toBe(3);
    expect(s.getSnapshot().layout.instanceMode).toBe('layer');
  });

  it('leaves the player’s own layer alone for a patch without one', () => {
    const s = new SynthStore();
    s.setActiveInstance(2);
    s.setParam(Param.OSC1_WAVE, 3);
    s.setActiveInstance(1);
    s.setInstanceRouting({ mode: 'single' });

    // A factory preset has no layer, so instance 2 keeps what the player set.
    s.applyPreset(FACTORY_PRESETS[0]);
    expect(s.getSnapshot().state.params2[Param.OSC1_WAVE]).toBe(3);
    void DEFAULT_PARAMS;
  });
});

/**
 * The factory table is a lazy chunk (P9.26). These pin the *timing* rules: what
 * a first frame can say without it, which paths are allowed to fetch it, and how
 * a stored id behaves while it is missing.
 *
 * Every case builds its own `SynthStore` over a cleared `localStorage`, because
 * the shared `store` singleton has had its table fetched by the suite above.
 */
describe('the lazy factory library', () => {
  /** A stored document, as `commit()` writes one. */
  const storedDoc = (presetId: string, presetName?: string) =>
    JSON.stringify({
      schema: 4,
      data: {
        ...createDefaultState(),
        params: { ...DEFAULT_PARAMS },
        presetId,
        ...(presetName ? { presetName, presetTag: 'FUTURE BASS' } : {}),
      },
    });

  it('names the boot patch and refuses a list until the table is fetched', () => {
    localStorage.clear();
    const s = new SynthStore();
    expect(s.presetsLoaded).toBe(false);
    // The first frame has something true to show (the boot patch) even though
    // the table that names it has not been fetched.
    expect(s.getSnapshot().currentPresetId).toBe(DEFAULT_PRESET.id);
    expect(s.currentPresetLabel()).toEqual({ name: DEFAULT_PRESET.name, tag: DEFAULT_PRESET.tag });
    // A caller that forgot to await gets a named error, not a short list.
    expect(() => s.allPresets()).toThrow(PresetsNotLoadedError);
  });

  it('resolves a stored presetId and name before the table arrives, then agrees with it', async () => {
    localStorage.clear();
    const first = new SynthStore();
    await first.ensurePresets();
    // Not the boot patch: with the default the mismatch would be invisible.
    const target = first.allPresets().find((preset) => preset.id === 'wurli')!;
    first.applyPreset(target);

    // A page reload: a fresh instance reading the same storage, with the table
    // *not* fetched. The name has to come from the document.
    const reloaded = new SynthStore();
    expect(reloaded.presetsLoaded).toBe(false);
    expect(reloaded.getSnapshot().currentPresetId).toBe(target.id);
    expect(reloaded.currentPresetLabel().name).toBe(target.name);
    expect(reloaded.getParam(Param.FILTER_CUTOFF)).toBeCloseTo(target.params[Param.FILTER_CUTOFF]!, 6);

    // And the id still resolves to the same patch once the library is readable.
    await reloaded.ensurePresets();
    expect(reloaded.currentPreset()?.id).toBe('wurli');
    expect(reloaded.currentPresetLabel().name).toBe(target.name);
  });

  it('falls back to the first factory patch when a stored id names nothing', async () => {
    localStorage.clear();
    localStorage.setItem('gs1:state:v1', storedDoc('no-such-preset', 'Ghost Patch'));
    const s = new SynthStore();
    // Taken on trust until the table can contradict it…
    expect(s.getSnapshot().currentPresetId).toBe('no-such-preset');
    expect(s.currentPresetLabel().name).toBe('Ghost Patch');
    // …and then the rule `deletePreset` has always followed.
    await s.ensurePresets();
    expect(s.getSnapshot().currentPresetId).toBe(DEFAULT_PRESET.id);
    expect(s.currentPresetLabel().name).toBe(DEFAULT_PRESET.name);
  });

  it('names a legacy stored id from the document when it was written without one', () => {
    localStorage.clear();
    localStorage.setItem('gs1:state:v1', storedDoc('init'));
    const s = new SynthStore();
    // No `presetName` in the document (a build before P9.26), so the boot
    // constant stands in until something fetches the table.
    expect(s.getSnapshot().currentPresetId).toBe('init');
    expect(s.currentPresetLabel().name).toBe(DEFAULT_PRESET.name);
  });

  it('imports a patch file without fetching the factory library', () => {
    localStorage.clear();
    const s = new SynthStore();
    const text = JSON.stringify({
      format: 'gs1-preset',
      name: 'From a file',
      params: { [String(Param.FILTER_CUTOFF)]: 900 },
    });
    expect(s.importPresetFile(text)).toBe(true);
    // A file patch is self-contained: it is applied, not looked up.
    expect(s.presetsLoaded).toBe(false);
    expect(s.getParam(Param.FILTER_CUTOFF)).toBe(900);
    expect(s.currentPresetLabel().name).toBe('From a file');
    expect(s.currentPreset()?.name).toBe('From a file');
  });

  it('steps through the list by fetching it, once, on the first press', async () => {
    localStorage.clear();
    const s = new SynthStore();
    const before = s.getSnapshot().currentPresetId;
    await s.stepPreset(1);
    expect(s.presetsLoaded).toBe(true);
    expect(s.getSnapshot().currentPresetId).not.toBe(before);
    // The user's own presets come first, so stepping wraps into them too.
    await s.stepPreset(-1);
    expect(s.getSnapshot().currentPresetId).toBe(before);
  });

  /** The document half of a restore, as `loadLiveDocument` builds it. */
  const doc = (s: SynthStore, currentPresetId: string, name?: string) => ({
    state: createDefaultState(),
    layout: s.getSnapshot().layout,
    userPresets: [],
    currentPresetId,
    ...(name ? { currentPresetName: name, currentPresetTag: 'ACID HOUSE' } : {}),
    clips: [],
    currentClipId: '',
  });

  it('opens a project that names its patch without fetching the library', () => {
    localStorage.clear();
    const s = new SynthStore();
    s.loadDocument(doc(s, 'acid', 'Acid 303 · 酸性贝斯'));
    expect(s.presetsLoaded).toBe(false);
    expect(s.getSnapshot().currentPresetId).toBe('acid');
    expect(s.currentPresetLabel().name).toBe('Acid 303 · 酸性贝斯');
  });

  it('fetches the library for a project whose patch it cannot name', async () => {
    localStorage.clear();
    const s = new SynthStore();
    // An older `.gs1proj`: the id travelled, the name did not.
    s.loadDocument(doc(s, 'acid'));
    // The switch itself does not wait for the chunk; the boot constant shows
    // until it lands.
    expect(s.currentPresetLabel().name).toBe(DEFAULT_PRESET.name);
    await s.ensurePresets();
    expect(s.presetsLoaded).toBe(true);
    expect(s.currentPresetLabel().name).toBe(FACTORY_PRESETS.find((p) => p.id === 'acid')!.name);
    // And an id the table does not have falls back to the first patch.
    s.loadDocument(doc(s, 'gone'));
    await s.ensurePresets();
    expect(s.getSnapshot().currentPresetId).toBe(DEFAULT_PRESET.id);
  });
});
