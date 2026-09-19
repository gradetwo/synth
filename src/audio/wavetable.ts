/**
 * Wavetable recipe names.
 *
 * The tables themselves live in Rust (`dsp/wavetable.rs`); this is the naming
 * half, so the interface can say *which* table the PW knob has selected instead
 * of leaving the player to discover it by ear.
 *
 * Keep the order in step with `RECIPES` in the Rust module: the oscillator maps
 * the PW knob's 0..1 onto the five banks in that order.
 */

export const WAVETABLE_RECIPES: [string, string][] = [
  ['风琴', 'Organ'],
  ['中空', 'Hollow'],
  ['人声', 'Vocal'],
  ['金属', 'Metallic'],
  ['玻璃', 'Glass'],
];

/** Which bank a PW position selects (0..4), matching the engine's rule. */
export function wavetableValueToRecipe(pw: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(pw) ? pw : 0));
  return Math.min(WAVETABLE_RECIPES.length - 1, Math.round(clamped * 4));
}

export function wavetableName(index: number, lang: 'zh' | 'en' = 'zh'): string {
  const entry = WAVETABLE_RECIPES[Math.min(WAVETABLE_RECIPES.length - 1, Math.max(0, index))];
  return entry[lang === 'zh' ? 0 : 1];
}
