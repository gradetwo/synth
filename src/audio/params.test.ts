import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  DELAY_SYNCS,
  FILTER_TYPES,
  LFO_TARGETS,
  LFO_WAVES,
  MOD_DESTS,
  MOD_SOURCES,
  Param,
  PARAM_NAMES,
  SPEC_BY_ID,
  WAVES,
  clamp,
  createDefaultState,
  delaySyncToInt,
  filterToInt,
  fmt,
  intToDelaySync,
  intToFilter,
  intToLfoTarget,
  intToLfoWave,
  intToModDst,
  intToModSrc,
  intToWave,
  lfoTargetToInt,
  lfoWaveToInt,
  modDstToInt,
  modSrcToInt,
  waveToInt,
} from './params';

describe('parameter model', () => {
  it('has a unique AudioParam name for every id', () => {
    const names = Object.values(PARAM_NAMES);
    expect(new Set(names).size).toBe(names.length);
    for (const value of Object.values(Param)) {
      expect(PARAM_NAMES[value]).toBeTruthy();
    }
  });

  it('round-trips every enum', () => {
    for (const w of WAVES) expect(intToWave(waveToInt(w))).toBe(w);
    for (const f of FILTER_TYPES) expect(intToFilter(filterToInt(f))).toBe(f);
    for (const w of LFO_WAVES) expect(intToLfoWave(lfoWaveToInt(w))).toBe(w);
    for (const t of LFO_TARGETS) expect(intToLfoTarget(lfoTargetToInt(t))).toBe(t);
    for (const s of MOD_SOURCES) expect(intToModSrc(modSrcToInt(s))).toBe(s);
    for (const d of MOD_DESTS) expect(intToModDst(modDstToInt(d))).toBe(d);
    for (const s of DELAY_SYNCS) expect(intToDelaySync(delaySyncToInt(s))).toBe(s);
  });

  it('clamps out-of-range and non-finite input', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('formats values like the reference UI', () => {
    expect(fmt.hz(9000)).toBe('9.00 kHz');
    expect(fmt.hz(440)).toBe('440 Hz');
    expect(fmt.hz(4.5)).toBe('4.5 Hz');
    expect(fmt.pct(0.42)).toBe('42 %');
    expect(fmt.ms(0.003)).toBe('3 ms');
    expect(fmt.ms(1.5)).toBe('1.50 s');
    expect(fmt.st(7)).toBe('+7 st');
    expect(fmt.ct(-6)).toBe('-6 ct');
  });

  it('keeps every spec consistent with the default patch', () => {
    for (const spec of Object.values(SPEC_BY_ID)) {
      expect(spec.min).toBeLessThan(spec.max);
      expect(spec.def).toBeGreaterThanOrEqual(spec.min);
      expect(spec.def).toBeLessThanOrEqual(spec.max);
      expect(spec.format(spec.def)).toBeTruthy();
    }
  });

  it('creates a state containing every default parameter', () => {
    const state = createDefaultState();
    for (const id of Object.keys(DEFAULT_PARAMS).map(Number)) {
      expect(state.params[id]).toBe(DEFAULT_PARAMS[id]);
    }
    expect(state.routes.length).toBeGreaterThan(0);
    expect(state.power).toBe(true);
  });
});
