import { beforeEach, describe, expect, it } from 'vitest';
import { Param } from '@/audio/params';
import { store } from './store';

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
    expect(JSON.parse(raw as string).params[Param.FILTER_RES]).toBe(0.42);
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

  it('adds and removes modulation routes', () => {
    const before = store.getSnapshot().state.routes.length;
    store.addRoute();
    expect(store.getSnapshot().state.routes.length).toBe(before + 1);
    store.removeRoute(0);
    expect(store.getSnapshot().state.routes.length).toBe(before);
  });
});
