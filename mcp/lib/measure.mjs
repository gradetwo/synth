/**
 * The rulers, pointed at a tool call.
 *
 * Every number `gs1.analyze` and `gs1.gate` return is produced by
 * `scripts/lib/audio-ruler.mjs` and `scripts/lib/render-core.mjs` — the modules
 * `scripts/verify-audio.mjs` asserts with. This file adds **no** FFT, window,
 * Goertzel or bin arithmetic: it only chooses which ruler to point at which
 * buffer and labels the answer with the ruler that produced it, which is the
 * `docs/LLM-INTERFACE.md` §4.3 rule ("every number carries which ruler").
 */
import {
  offGridFloor, binMagHann, binMag, binMagRect, thdPercent, interHarmonicDb,
  FLOOR_BINS,
} from '../../scripts/lib/audio-ruler.mjs';
import { renderFloor, initCore, P, SR } from '../../scripts/lib/render-core.mjs';
import { noteHz } from './render.mjs';
import { paramPairs } from './patch.mjs';
import { installInstrument } from './session.mjs';

/** What produced an off-grid number: the whole-spectrum Blackman-Harris ruler. */
export const BH7 = { ruler: 'bh7', window: 'blackman-harris-7' };
/** The second, independent ruler: a Hann-windowed single-frequency Goertzel. */
export const HANN = { ruler: 'hann-goertzel', window: 'hann' };
/** The gate's own Hann probe frequencies at C7 (2093 Hz), from `verify-audio.mjs`. */
export const DEFAULT_PROBES = [9000, 9200, 9500];

/** `offGridFloor` with its ruler named in the result. */
export function bh7Floor(samples, f0, bins = FLOOR_BINS) {
  return { ...BH7, bins, floorDb: offGridFloor(samples, f0, bins) };
}

/**
 * `binMagHann` at a list of exact frequencies, each reported in dB below the
 * fundamental. This is the gate's second ruler: it answers "how tall is the
 * floor at these frequencies", not "how much total off-grid power".
 */
export function hannProbes(samples, f0, probes = DEFAULT_PROBES) {
  const fundamental = binMagHann(samples, f0);
  const perProbe = probes.map((frequency) => ({
    frequency,
    db: 20 * Math.log10(Math.max(binMagHann(samples, frequency), 1e-30) / Math.max(fundamental, 1e-30)),
  }));
  return {
    ...HANN,
    f0,
    fundamental,
    probes: perProbe,
    worstDb: Math.max(...perProbe.map((entry) => entry.db)),
  };
}

/** Total harmonic distortion, labelled with the ruler that reads it. */
export function thd(samples, f0, maxHarmonic = 12) {
  return { ruler: 'hann-goertzel', window: 'hann', maxHarmonic, percent: thdPercent(samples, f0, maxHarmonic) };
}

/** Energy between the harmonics, labelled with the ruler that reads it. */
export function interHarmonic(samples, f0, limitHz = 20000) {
  return { ruler: 'hann-goertzel', window: 'hann', limitHz, db: interHarmonicDb(samples, f0, limitHz) };
}

/** A raw single-bin magnitude, for callers that want to build their own ratio. */
export { binMag, binMagRect };

/**
 * The gate's settled fixture, with **an arbitrary patch**: one note, four
 * seconds, 400 blocks of settle, the modulation matrix cleared.
 *
 * `renderFloor(extra, note)` is the gate's own function; it seeds
 * `QUIET_PATCH` and then applies `extra`, and every id in a patch overrides the
 * quiet default (a patch carries all 224 ids), so passing the patch's pairs
 * makes the fixture measure *this* patch with the gate's exact timing and
 * settling. That is why `gs1.gate` and `verify:audio` cannot disagree.
 */
export function settledFloor(payload, note, bins = FLOOR_BINS, oversample = 0, session = null) {
  const pairs = paramPairs(payload.params).filter(([id]) => id !== P.OVERSAMPLE);
  pairs.push([P.OVERSAMPLE, oversample ? 1 : 0]);
  // A fresh core per note: the gate's phase sequence depends on how many
  // note-ons came before, and a tool called twice must not inherit the first
  // call's counter. `initCore()` gives a new engine with phase_seed = 0.
  initCore();
  // P13.3: the session's imported instrument, replayed into the new instance.
  installInstrument(session);
  const samples = renderFloor(pairs, note);
  return { samples, f0: noteHz(note), ...bh7Floor(samples, noteHz(note), bins) };
}

/** Every distinct note in a validated spec, in first-seen order. */
export function distinctNotes(notes) {
  const seen = [];
  for (const entry of notes) if (!seen.includes(entry.note)) seen.push(entry.note);
  return seen;
}

/** The sample rate the rulers are calibrated at; reported so callers can check. */
export const RULER_SAMPLE_RATE = SR;
