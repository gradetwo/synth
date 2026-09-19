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

// ---------------------------------------------------------------- readouts
//
// The caption under the VU meter. Pure so the idle behaviour is testable: with
// nothing playing a meter must be stable and must not pretend to be measuring.
// The old caption showed a hardcoded -60 for the loudness and -120 for the
// peak, and one-decimal rounding flickered between two strings whenever a value
// sat on a boundary — which reads as "the synth is doing something" when it is
// doing nothing.

/** Below this a meter reports silence rather than a number. */
export const METER_FLOOR_DB = -60;
/**
 * The load readout only appears above this share of the budget. An idle engine
 * sits at 1-4%, which is noise: showing it means the caption changes while
 * nothing is playing, which is exactly the complaint that started this.
 */
export const LOAD_DISPLAY_FLOOR = 0.05;

/** Shown in place of a number when there is nothing to measure. */
export const METER_SILENCE = '—';

const amplitudeDb = (amplitude: number): number =>
  amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;

/** Format one amplitude as a dB string, or the silence glyph below the floor. */
export function formatDb(amplitude: number, digits = 1): string {
  const db = amplitudeDb(amplitude);
  if (!Number.isFinite(db) || db <= METER_FLOOR_DB) return METER_SILENCE;
  return db.toFixed(digits);
}

/** Format a gain reduction (1.0 = none) — omitted while the limiter is idle. */
export function formatGainReduction(gain: number): string {
  if (!(gain < 0.999)) return '';
  const db = amplitudeDb(gain);
  return Number.isFinite(db) && db <= METER_FLOOR_DB
    ? ` · GR ${METER_SILENCE}`
    : ` · GR ${db.toFixed(1)}`;
}

/** Format the DSP load, hidden while it is negligible so it cannot flicker. */
export function formatLoad(load: number): string {
  if (!(load >= LOAD_DISPLAY_FLOOR)) return '';
  return ` · ${Math.round(load * 100)}%`;
}

/** The whole caption: peak · loudness · gain reduction · load. */
export function meterCaption(peak: number, loudness: number, load: number, limit: number): string {
  return `${formatDb(peak, 1)} · ${formatDb(loudness, 0)}${formatGainReduction(limit)}${formatLoad(load)}`;
}

/** True when the meter is showing silence. */
export function meterIsSilent(peak: number): boolean {
  return formatDb(peak, 1) === METER_SILENCE;
}

/** Is the peak close enough to full scale to warn about it? */
export function meterIsHot(peak: number, load: number): boolean {
  const db = amplitudeDb(peak);
  return (Number.isFinite(db) && db > -0.5) || load > 0.9;
}
