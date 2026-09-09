import { describe, expect, it } from 'vitest';
import { scopeGain, spectrumDisplay, vuDisplay } from './meter';

describe('meter display shaping', () => {
  it('lifts spectrum mid values and stays bounded', () => {
    expect(spectrumDisplay(0)).toBe(0);
    expect(spectrumDisplay(0.1)).toBeGreaterThan(0.3);
    expect(spectrumDisplay(0.5)).toBeGreaterThan(0.7);
    expect(spectrumDisplay(1)).toBeLessThanOrEqual(1);
    // Monotonic.
    expect(spectrumDisplay(0.4)).toBeGreaterThan(spectrumDisplay(0.2));
  });

  it('maps VU peaks onto a dBFS scale', () => {
    expect(vuDisplay(0)).toBe(0);
    expect(vuDisplay(1)).toBeCloseTo(1, 2);
    // −24 dBFS should light roughly half the meter, not one segment.
    expect(vuDisplay(0.063)).toBeGreaterThan(0.45);
    expect(vuDisplay(0.063)).toBeLessThan(0.6);
  });

  it('auto-gains the scope with a fast attack and slow release', () => {
    // A quiet signal is amplified.
    const boosted = scopeGain(0.02, 1);
    expect(boosted).toBeGreaterThan(1);
    // A loud signal pulls the gain down immediately.
    const pulled = scopeGain(4, 1);
    expect(pulled).toBeLessThan(0.3);
    // Recovery towards more gain is gradual, not instant.
    const rising = scopeGain(0.02, 0.3);
    expect(rising).toBeGreaterThan(0.3);
    expect(rising).toBeLessThan(2);
    // Never explodes on silence.
    expect(scopeGain(0, 1)).toBe(1);
    // Gain is capped.
    expect(scopeGain(1e-6, 1)).toBeLessThanOrEqual(24);
  });
});
