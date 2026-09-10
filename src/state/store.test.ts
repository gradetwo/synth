import { beforeEach, describe, expect, it } from 'vitest';
import { Param } from '@/audio/params';
import { midiLibrary } from '@/midi/library';
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
