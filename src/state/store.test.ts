import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, Param } from '@/audio/params';
import { midiLibrary } from '@/midi/library';
import { FACTORY_PRESETS } from './presets';
import { SynthStore, store } from './store';
import { unwrap } from './persist';

describe('synth store', () => {
  beforeEach(() => {
    store.applyPresetById('init');
    for (const p of store.allPresets().filter((x) => x.user)) store.deletePreset(p.id);
  });

  it('applies factory presets and reports the current preset', () => {
    store.applyPresetById('pluck');
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

  it('steps through the preset list in both directions', () => {
    const first = store.currentPreset()?.id;
    store.stepPreset(1);
    const second = store.currentPreset()?.id;
    expect(second).not.toBe(first);
    store.stepPreset(-1);
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

  it('saves and deletes user presets', () => {
    store.setParam(Param.FILTER_CUTOFF, 777);
    const saved = store.savePreset('TEST PATCH');
    expect(saved.user).toBe(true);
    expect(store.allPresets().some((p) => p.id === saved.id)).toBe(true);
    expect(store.currentPreset()?.id).toBe(saved.id);

    store.applyPresetById('init');
    store.applyPresetById(saved.id);
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

  it('undoes and redoes preset changes', () => {
    store.applyPresetById('init');
    store.applyPresetById('acid');
    expect(store.getSnapshot().canUndo).toBe(true);
    store.undo();
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(18000);
    expect(store.getSnapshot().canRedo).toBe(true);
    store.redo();
    expect(store.getParam(Param.FILTER_CUTOFF)).toBe(800);
  });

  it('stores and recalls A/B patches', () => {
    store.applyPresetById('init');
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

describe('undo covers the whole document', () => {
  it('undoes a module collapse', () => {
    store.applyPresetById('init');
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
  it('restores the preset name together with the patch', () => {
    // The patch is persisted; the displayed name used to be a hard default, so
    // opening the app showed one preset and played another.
    // Not the first factory preset: with the default the mismatch would be
    // invisible.
    store.applyPresetById('wurli');
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
