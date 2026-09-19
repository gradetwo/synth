import { describe, expect, it } from 'vitest';
import { WAVETABLE_RECIPES, wavetableName, wavetableValueToRecipe } from './wavetable';

describe('wavetable recipe mapping', () => {
  it('maps the PW knob onto the five banks like the engine does', () => {
    // The engine rounds pw * 4 and clamps; the UI must agree or it would name
    // the wrong table.
    expect(wavetableValueToRecipe(0.05)).toBe(0);
    expect(wavetableValueToRecipe(0.3)).toBe(1);
    expect(wavetableValueToRecipe(0.5)).toBe(2);
    expect(wavetableValueToRecipe(0.7)).toBe(3);
    expect(wavetableValueToRecipe(0.95)).toBe(4);
    expect(wavetableValueToRecipe(-1)).toBe(0);
    expect(wavetableValueToRecipe(5)).toBe(4);
    expect(wavetableValueToRecipe(Number.NaN)).toBe(0);
  });

  it('names the banks in both languages', () => {
    expect(wavetableName(0, 'zh')).toBe('风琴');
    expect(wavetableName(4, 'en')).toBe('Glass');
    // Out-of-range indices clamp rather than throw.
    expect(wavetableName(99, 'en')).toBe('Glass');
    expect(WAVETABLE_RECIPES).toHaveLength(5);
  });
});
