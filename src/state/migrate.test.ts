/**
 * Document-level migration tests.
 *
 * Each case writes the shape an older build left in `localStorage` (or in a
 * share code) and asserts the current build reads the *content* back, not just
 * that it does not throw.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './persist';
import { SynthStore } from './store';
import { SCENES_KEY } from './scenes';
import { decodePatch, encodePatch } from './share';
import { DEFAULT_PARAMS, Param, createDefaultState } from '@/audio/params';

const STATE_KEY = 'gs1:state:v1';
const USER_KEY = 'gs1:user-presets:v1';
const LAYOUT_KEY = 'gs1:layout:v1';

/** A state document as version 1 wrote it: flat, no schema, no envelope. */
function legacyState(params: Record<number, number>, presetId?: string) {
  return { ...createDefaultState(), params: { ...DEFAULT_PARAMS, ...params }, ...(presetId ? { presetId } : {}) };
}

beforeEach(() => {
  localStorage.clear();
});

describe('document migration', () => {
  it('loads a patch stored before versioning existed', () => {
    localStorage.setItem(STATE_KEY, JSON.stringify(legacyState({ [Param.FILTER_CUTOFF]: 1234 })));
    const store = new SynthStore();
    expect(store.getParam(Param.FILTER_CUTOFF as never)).toBeCloseTo(1234, 6);
    // Everything the old document did not carry is the current default.
    expect(store.getSnapshot().state.routes.length).toBeGreaterThan(0);
  });

  it('ignores a patch written by a newer build', () => {
    // The envelope is *newer*, so the store falls back to defaults rather than
    // loading a document it may be misreading.
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ schema: SCHEMA_VERSION + 1, data: legacyState({ [Param.FILTER_CUTOFF]: 1234 }) }),
    );
    const store = new SynthStore();
    expect(store.getParam(Param.FILTER_CUTOFF as never)).not.toBeCloseTo(1234, 1);
  });

  it('loads a layout and scenes stored before versioning existed', () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ lang: 'en', polyphony: 8 }));
    localStorage.setItem(
      SCENES_KEY,
      JSON.stringify([{ id: 's1', name: 'Scene', workspace: { order: [] } }]),
    );
    const store = new SynthStore();
    expect(store.getSnapshot().layout.polyphony).toBe(8);
    expect(store.getSnapshot().scenes.map((scene) => scene.id)).toEqual(['s1']);
  });

  it('loads user presets from a bare array and drops broken entries', () => {
    localStorage.setItem(
      USER_KEY,
      JSON.stringify([
        { id: 'mine', name: ['我的', 'Mine'], params: { ...DEFAULT_PARAMS, [Param.OSC1_LEVEL]: 0.5 }, routes: [] },
        { id: 'broken' },
      ]),
    );
    const store = new SynthStore();
    expect(store.getSnapshot().userPresets.map((preset) => preset.id)).toEqual(['mine']);
  });
});

describe('share codes', () => {
  it('round-trips a patch through a code', () => {
    const state = { ...createDefaultState(), params: { ...DEFAULT_PARAMS, [Param.OSC1_LEVEL]: 0.42 } };
    const decoded = decodePatch(encodePatch(state));
    expect(decoded).not.toBeNull();
    expect(decoded!.params[Param.OSC1_LEVEL]).toBeCloseTo(0.42, 4);
  });

  it('reads a code written before codes carried a schema', () => {
    // Encode by hand the way version 1 did: no `s` field.
    const ids = Object.keys(DEFAULT_PARAMS).map(Number).sort((a, b) => a - b);
    const values = ids.map((id) => (id === Param.OSC1_LEVEL ? 0.31 : DEFAULT_PARAMS[id]));
    const json = JSON.stringify({ v: values, r: [] });
    const code = 'gs1.1.' + Buffer.from(json, 'utf8').toString('base64url');
    const decoded = decodePatch(code);
    expect(decoded!.params[Param.OSC1_LEVEL]).toBeCloseTo(0.31, 4);
  });

  it('maps a short code onto the parameters it carried, in id order', () => {
    // A code written before the newest parameters existed holds fewer values;
    // ids are append-only, so the prefix still lines up.
    const ids = Object.keys(DEFAULT_PARAMS).map(Number).sort((a, b) => a - b);
    const shortIds = ids.slice(0, 10);
    const values = shortIds.map((id) => (id === Param.OSC1_LEVEL ? 0.25 : DEFAULT_PARAMS[id]));
    const code = 'gs1.1.' + Buffer.from(JSON.stringify({ s: 1, v: values, r: [] }), 'utf8').toString('base64url');
    const decoded = decodePatch(code);
    expect(decoded!.params[Param.OSC1_LEVEL]).toBeCloseTo(0.25, 4);
    // Parameters that were not in the code keep their defaults.
    expect(decoded!.params[Param.FILTER_CUTOFF]).toBe(DEFAULT_PARAMS[Param.FILTER_CUTOFF]);
  });

  it('refuses a code from a newer build', () => {
    const code =
      'gs1.1.' + Buffer.from(JSON.stringify({ s: SCHEMA_VERSION + 1, v: [], r: [] }), 'utf8').toString('base64url');
    expect(decodePatch(code)).toBeNull();
  });
});
