import { describe, expect, it } from 'vitest';
import { TEMPERAMENTS, temperamentById, temperamentTable } from './tuning';

describe('microtuning', () => {
  it('keeps equal temperament as a pure no-op', () => {
    const table = temperamentTable(temperamentById('equal').cents);
    expect(table).toHaveLength(128);
    expect([...table].every((v) => v === 0)).toBe(true);
  });

  it('matches the known just-intonation offsets', () => {
    const table = temperamentTable(temperamentById('just').cents);
    // Major third (E, key 4) is 386.3 cents instead of 400 — 13.7 cents flat.
    expect(table[64]).toBeCloseTo(-13.686, 2);
    // Perfect fifth (G, key 7) is 702.0 cents — 2 cents sharp.
    expect(table[67]).toBeCloseTo(1.955, 2);
    // The octave itself must stay exact.
    expect(table[72]).toBeCloseTo(0, 6);
    expect(table[60]).toBeCloseTo(0, 6);
  });

  it('wraps every offset into the smallest correction', () => {
    for (const temperament of TEMPERAMENTS) {
      const table = temperamentTable(temperament.cents);
      for (const cents of table) {
        expect(Math.abs(cents)).toBeLessThanOrEqual(50);
      }
    }
  });

  it('falls back to equal temperament for an unknown id', () => {
    expect(temperamentById('nope').id).toBe('equal');
    expect(TEMPERAMENTS.length).toBeGreaterThanOrEqual(3);
  });
});
