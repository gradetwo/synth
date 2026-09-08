import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, Param } from '@/audio/params';
import { FACTORY_PRESETS, presetParams, presetRoutes } from './presets';

describe('preset library', () => {
  it('ships a substantial library (40+ presets)', () => {
    expect(FACTORY_PRESETS.length).toBeGreaterThanOrEqual(40);
    for (const cat of ['LEAD', 'BASS', 'PAD', 'PLUCK', 'KEYS', 'FX', 'BASIC']) {
      const count = FACTORY_PRESETS.filter((p) => p.cat === cat).length;
      expect(count, cat).toBeGreaterThanOrEqual(3);
    }
  });

  it('has unique ids and non-empty metadata', () => {
    const ids = FACTORY_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of FACTORY_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.tag.length).toBeGreaterThan(0);
      expect(p.cat).toBeTruthy();
    }
  });

  it('merges each preset over the default patch', () => {
    for (const p of FACTORY_PRESETS) {
      const merged = presetParams(p);
      expect(merged[Param.MASTER_VOLUME]).toBe(DEFAULT_PARAMS[Param.MASTER_VOLUME]);
      for (const [id, value] of Object.entries(p.params)) {
        expect(merged[Number(id)]).toBe(value);
      }
    }
  });

  it('keeps every preset parameter inside the DSP range', () => {
    // Mirrors the clamps in crates/synth-core/src/params.rs.
    const ranges: Record<number, [number, number]> = {
      [Param.OSC1_PITCH]: [-48, 48],
      [Param.OSC2_PITCH]: [-48, 48],
      [Param.OSC1_DETUNE]: [-100, 100],
      [Param.OSC2_DETUNE]: [-100, 100],
      [Param.OSC1_LEVEL]: [0, 1],
      [Param.OSC2_LEVEL]: [0, 1],
      [Param.FILTER_CUTOFF]: [20, 20000],
      [Param.FILTER_RES]: [0, 1],
      [Param.FILTER_DRIVE]: [0, 1],
      [Param.FILTER_ENV_AMT]: [0, 1],
      [Param.ENV_ATTACK]: [0.0005, 8],
      [Param.ENV_DECAY]: [0.001, 12],
      [Param.ENV_SUSTAIN]: [0, 1],
      [Param.ENV_RELEASE]: [0.005, 16],
      [Param.LFO_RATE]: [0.02, 40],
      [Param.LFO_DEPTH]: [0, 1],
      [Param.FX_REVERB_SIZE]: [0, 1],
      [Param.FX_REVERB_MIX]: [0, 1],
      [Param.FX_DELAY_FB]: [0, 0.95],
      [Param.FX_DELAY_MIX]: [0, 1],
    };
    for (const preset of FACTORY_PRESETS) {
      for (const [id, value] of Object.entries(preset.params)) {
        const range = ranges[Number(id)];
        if (!range) continue;
        expect(value, `${preset.id} param ${id}`).toBeGreaterThanOrEqual(range[0]);
        expect(value, `${preset.id} param ${id}`).toBeLessThanOrEqual(range[1]);
      }
    }
  });

  it('provides at least one preset per major category', () => {
    const cats = new Set(FACTORY_PRESETS.map((p) => p.cat));
    for (const required of ['LEAD', 'BASS', 'PAD', 'PLUCK', 'KEYS', 'FX', 'BASIC']) {
      expect(cats.has(required as never), required).toBe(true);
    }
  });

  it('returns a fresh route array', () => {
    const a = presetRoutes(FACTORY_PRESETS[0]);
    const b = presetRoutes(FACTORY_PRESETS[0]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
