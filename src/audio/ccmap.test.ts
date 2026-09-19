import { describe, expect, it } from 'vitest';
import { Param } from './params';
import { bindCc, ccForParam, ccToParamValue, normalizeBindings, paramForCc, unbindParam } from './ccmap';

describe('MIDI CC mapping', () => {
  it('binds one controller per parameter and per CC', () => {
    let map = bindCc([], Param.FILTER_CUTOFF, 74);
    expect(paramForCc(map, 74)).toBe(Param.FILTER_CUTOFF);
    // Rebinding the same parameter to another controller moves it.
    map = bindCc(map, Param.FILTER_CUTOFF, 75);
    expect(paramForCc(map, 75)).toBe(Param.FILTER_CUTOFF);
    expect(paramForCc(map, 74)).toBeNull();
    // A controller already in use takes the parameter away from its old owner.
    map = bindCc(map, Param.FILTER_RES, 75);
    expect(map).toHaveLength(1);
    expect(paramForCc(map, 75)).toBe(Param.FILTER_RES);
  });

  it('removes a binding', () => {
    const map = bindCc(bindCc([], Param.FILTER_CUTOFF, 74), Param.LFO_RATE, 76);
    const trimmed = unbindParam(map, Param.FILTER_CUTOFF);
    expect(trimmed).toHaveLength(1);
    expect(ccForParam(trimmed, Param.FILTER_CUTOFF)).toBeNull();
  });

  it('scales a controller position onto the parameter range', () => {
    const low = ccToParamValue(Param.FILTER_CUTOFF, 0);
    const high = ccToParamValue(Param.FILTER_CUTOFF, 1);
    const mid = ccToParamValue(Param.FILTER_CUTOFF, 0.5);
    expect(low).toBe(40);
    expect(high).toBe(18000);
    // Logarithmic parameters must land in the geometric middle, not the middle.
    expect(mid).toBeCloseTo(Math.sqrt(40 * 18000), 0);
    expect(mid).toBeGreaterThan(600);
  });

  it('rounds discrete parameters to whole steps', () => {
    // Unison is a stepped control: a controller must not leave it on 3.4 voices.
    const values = [0, 0.2, 0.5, 0.9, 1].map((t) => ccToParamValue(Param.OSC1_UNISON, t));
    for (const value of values) expect(Number.isInteger(value)).toBe(true);
    expect(values[0]).toBeLessThan(values[values.length - 1]!);
  });

  it('only maps parameters the UI actually exposes', () => {
    // The filter type is a segmented control with no knob spec, so a CC has
    // nothing to scale: it must be refused rather than guess a range.
    expect(ccToParamValue(Param.FILTER_TYPE, 0.5)).toBeNull();
    expect(normalizeBindings([{ param: Param.FILTER_TYPE, cc: 20 }])).toEqual([]);
  });

  it('ignores junk from persisted storage', () => {
    expect(normalizeBindings(null)).toEqual([]);
    expect(normalizeBindings([{ param: 1, cc: 200 }, { param: 9999, cc: 5 }])).toEqual([]);
    expect(normalizeBindings([{ param: Param.FILTER_CUTOFF, cc: 74 }, { param: 5, cc: 74 }])).toEqual([
      { param: Param.FILTER_CUTOFF, cc: 74 },
    ]);
    expect(ccToParamValue(99999, 0.5)).toBeNull();
  });
});
