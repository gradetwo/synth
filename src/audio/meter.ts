/**
 * Meter display shaping (pure helpers so the visual curves are unit-tested).
 *
 * The engine reports linear peak/spectrum values; these functions turn them into
 * 0..1 display heights that actually use the panel area.
 */

/** Spectrum bin (already 0..1 from the FFT dB curve) → display height. */
export function spectrumDisplay(v: number): number {
  if (!(v > 0)) return 0;
  return Math.min(1, Math.pow(v, 0.58) * 1.45);
}

/** Master peak → 0..1 on a −48..0 dBFS scale (ordinary levels light most segments). */
export function vuDisplay(peak: number): number {
  const db = 20 * Math.log10(Math.max(peak, 1e-4));
  return Math.min(1, Math.max(0, (db + 48) / 48));
}

/**
 * Scope auto-gain step: aim for ~92% of half-height, attack instantly when the
 * signal grows and release slowly, capped so silence does not explode.
 */
export function scopeGain(peak: number, current: number): number {
  const target = peak > 1e-4 ? Math.min(24, 0.92 / peak) : current;
  return target < current ? target : current + (target - current) * 0.04;
}
