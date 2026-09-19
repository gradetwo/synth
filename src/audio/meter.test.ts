import { describe, expect, it } from 'vitest';
import {
  formatDb,
  formatLoad,
  meterCaption,
  meterIsSilent,
  METER_FLOOR_DB,
  spectrumDisplay,
  vuDisplay,
} from './meter';

describe('meter formatting', () => {
  it('keeps the display curves sane', () => {
    // These are the pre-existing display shapers; the module also carries the
    // readout formatting, so guard both.
    expect(vuDisplay(1)).toBe(1);
    expect(vuDisplay(0)).toBe(0);
    expect(spectrumDisplay(0)).toBe(0);
    expect(spectrumDisplay(1)).toBeGreaterThan(0);
  });

  it('shows silence instead of a parked floor', () => {
    // Nothing playing: the engine reports exact zero (or a -300 dB dither),
    // and the caption must not twitch between two strings.
    expect(formatDb(0)).toBe('—');
    expect(formatDb(7.5e-16)).toBe('—');
    expect(formatDb(1e-6)).toBe('—');
    expect(meterCaption(0, 0, 0, 1)).toBe('— · —');
    expect(meterIsSilent(0)).toBe(true);
  });

  it('is stable at the floor boundary', () => {
    const floor = 10 ** (METER_FLOOR_DB / 20);
    const values = [floor * 0.99, floor, floor * 1.01];
    // Either everything below (and at) the floor is silence, or the number is
    // well clear of the boundary; no value may flip back and forth.
    for (const v of values) {
      const text = formatDb(v);
      expect(text === '—' || Number(text) > METER_FLOOR_DB).toBe(true);
    }
    expect(formatDb(floor * 0.999)).toBe('—');
  });

  it('formats real signals with the right precision', () => {
    expect(formatDb(1)).toBe('0.0');
    expect(formatDb(0.5, 0)).toBe('-6');
    expect(meterCaption(0.5, 0.25, 0, 1)).toBe('-6.0 · -12');
  });

  it('hides the load while it is negligible, so it cannot flicker', () => {
    expect(formatLoad(0)).toBe('');
    expect(formatLoad(0.004)).toBe('');
    expect(formatLoad(0.01)).toBe('');
    expect(formatLoad(0.04)).toBe('');
    expect(formatLoad(0.049)).toBe('');
    expect(formatLoad(0.05)).toBe(' · 5%');
    expect(formatLoad(0.06)).toBe(' · 6%');
    expect(formatLoad(0.31)).toBe(' · 31%');
  });

  it('shows gain reduction only when the limiter works', () => {
    expect(meterCaption(0.5, 0.25, 0, 1)).not.toContain('GR');
    expect(meterCaption(0.5, 0.25, 0, 0.5)).toContain('GR -6.0');
  });
});
