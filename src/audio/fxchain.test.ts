/**
 * Effect chain model (A5).
 *
 * The chain is a permutation of the six effects, so the two things that can go
 * wrong silently are the mapping (a chip naming a different effect from the one
 * the DSP runs) and the defaults (a patch that never touched the chain must run
 * the effects in the order they always ran in).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  FX_KINDS,
  FX_SLOTS,
  Param,
  chainId,
  fxKindCanBeParallel,
  fxKindToInt,
  intToFxKind,
  parallelId,
  readChain,
} from './params';

describe('effect chain', () => {
  it('round-trips every kind', () => {
    for (const kind of FX_KINDS) {
      expect(intToFxKind(fxKindToInt(kind))).toBe(kind);
    }
    // Out-of-range values fall back to "nothing here" rather than to an effect.
    expect(intToFxKind(-1)).toBe('none');
    expect(intToFxKind(99)).toBe('none');
  });

  it('defaults to the order the effects have always run in', () => {
    const chain = readChain((id) => DEFAULT_PARAMS[id] ?? 0);
    expect(chain).toEqual(['delay', 'reverb', 'chorus', 'flanger', 'phaser', 'drive']);
    // A permutation: every effect exactly once.
    expect(new Set(chain).size).toBe(FX_SLOTS);
    // And every insert effect starts as an insert.
    for (let slot = 0; slot < FX_SLOTS; slot++) {
      expect(DEFAULT_PARAMS[parallelId(slot)]).toBe(0);
    }
  });

  it('keeps the parallel switch off the effects that have nothing to blend', () => {
    // A delay and a reverb already add their wet signal; offering the switch
    // there would be a control that does nothing.
    expect(fxKindCanBeParallel('delay')).toBe(false);
    expect(fxKindCanBeParallel('reverb')).toBe(false);
    expect(fxKindCanBeParallel('chorus')).toBe(true);
    expect(fxKindCanBeParallel('flanger')).toBe(true);
    expect(fxKindCanBeParallel('phaser')).toBe(true);
    expect(fxKindCanBeParallel('drive')).toBe(true);
    expect(fxKindCanBeParallel('none')).toBe(false);
  });

  it('addresses every position uniquely', () => {
    const chainIds = Array.from({ length: FX_SLOTS }, (_, slot) => chainId(slot));
    const parallelIds = Array.from({ length: FX_SLOTS }, (_, slot) => parallelId(slot));
    expect(new Set([...chainIds, ...parallelIds]).size).toBe(FX_SLOTS * 2);
    expect(chainIds[0]).toBe(Param.FX_CHAIN1);
    expect(parallelIds[FX_SLOTS - 1]).toBe(Param.FX_PARALLEL6);
  });
});
