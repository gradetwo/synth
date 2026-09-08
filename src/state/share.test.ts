import { describe, expect, it } from 'vitest';
import { createDefaultState, Param } from '@/audio/params';
import { decodePatch, encodePatch } from './share';

describe('patch share codec', () => {
  it('round-trips every parameter and route', () => {
    const state = createDefaultState();
    state.params[Param.FILTER_CUTOFF] = 1234.5;
    state.params[Param.OSC1_PAN] = -0.42;
    state.routes = [{ src: 'velocity', dst: 'pwm', amount: -0.75, enabled: true }];

    const code = encodePatch(state);
    expect(code.startsWith('gs1.1.')).toBe(true);
    const decoded = decodePatch(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.params[Param.FILTER_CUTOFF]).toBeCloseTo(1234.5, 3);
    expect(decoded!.params[Param.OSC1_PAN]).toBeCloseTo(-0.42, 3);
    expect(decoded!.routes).toEqual([{ src: 'velocity', dst: 'pwm', amount: -0.75, enabled: true }]);
  });

  it('rejects malformed codes', () => {
    expect(decodePatch('nope')).toBeNull();
    expect(decodePatch('gs1.1.%%%')).toBeNull();
    expect(decodePatch('gs1.1.' + btoa('{"v":"nope"}'))).toBeNull();
  });

  it('fills missing parameters from the defaults', () => {
    const state = createDefaultState();
    const decoded = decodePatch(encodePatch(state));
    expect(decoded!.params[Param.MASTER_VOLUME]).toBe(state.params[Param.MASTER_VOLUME]);
    expect(decoded!.params[Param.VOICE_MODE]).toBe(0);
  });
});
