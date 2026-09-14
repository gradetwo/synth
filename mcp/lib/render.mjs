/**
 * `gs1.render`: run the real core and hand back samples.
 *
 * **This is not a second renderer.** The block loop, the engine bootstrap, the
 * parameter push and the time-domain statistics are all `scripts/lib/
 * render-core.mjs` — the same module `scripts/verify-audio.mjs` drives. This
 * file only turns the tool's JSON spec into that module's calls:
 *
 *   * `engine(pairs, [])` is the gate's own prologue (init, settle, push the
 *     parameter block) with no notes;
 *   * `clearModMatrix()` + `gs_set_mod_route` apply the patch's routes the way
 *     the gate does;
 *   * `renderWith(blocks, onBlock, 0)` is `render` plus the note-scheduling hook
 *     (see its docstring in `render-core.mjs`).
 *
 * Determinism, spelled out because it is the hard requirement:
 *
 *   * **A fresh wasm instance per call.** `initCore()` builds a new
 *     `WebAssembly.Instance`, which is also a new engine: `phase_seed` and
 *     `random_seed` start from their constructors. Without this, the Nth
 *     note-on in a long-lived server would start on a different phase and two
 *     identical calls would not produce identical bytes.
 *   * **No clock anywhere.** Nothing in this path reads `Date.now`, and the
 *     scheduling is block-indexed, not timer-driven.
 *   * **`seed` is a real input.** A fresh engine has `phase_seed = 0`; `seed`
 *     primes it with that many silent note-ons, each of which advances the
 *     oscillator start-phase and random sequences. Same seed ⇒ same bytes,
 *     different seed ⇒ a different phase (and usually a different sha256).
 */
import {
  initCore, ex, engine, renderWith,
  SR, BLOCK, P, worstStepOf, peakOf, rmsOf, allocViolations, countNoteOn,
} from '../../scripts/lib/render-core.mjs';
import { ERRORS, fail } from './errors.mjs';
import { paramPairs, applyRoutes } from './patch.mjs';
import { encodeWavPair, sha256Hex } from './wav.mjs';

export const MAX_SECONDS = 30;
export const MIN_SECONDS = 0.05;
export const MAX_NOTES = 512;
export const MAX_SEED = 512;
/** The only rate the rulers are calibrated at (see `audio-ruler.mjs`). */
export const SAMPLE_RATES = [48000];

/** Validate `seconds`/`notes`/`seed`/`oversample`/`sampleRate`; throws structured rejections. */
export function validateRenderSpec(spec) {
  const seconds = spec?.seconds ?? 2;
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    throw fail(ERRORS.RANGE, `seconds must be between ${MIN_SECONDS} and ${MAX_SECONDS}`, {
      field: 'seconds',
      value: spec?.seconds ?? null,
      min: MIN_SECONDS,
      max: MAX_SECONDS,
    });
  }

  const notes = spec?.notes;
  if (!Array.isArray(notes) || notes.length < 1) {
    throw fail(ERRORS.SCHEMA, 'notes must be a non-empty array', { field: 'notes' });
  }
  if (notes.length > MAX_NOTES) {
    throw fail(ERRORS.RANGE, `notes must hold at most ${MAX_NOTES} entries`, {
      field: 'notes',
      length: notes.length,
      max: MAX_NOTES,
    });
  }

  const sampleRate = spec?.sampleRate ?? SR;
  if (!SAMPLE_RATES.includes(sampleRate)) {
    throw fail(
      ERRORS.SAMPLE_RATE,
      `sampleRate ${sampleRate} is not supported: the rulers are calibrated at 48 kHz`,
      { field: 'sampleRate', value: sampleRate, allowed: SAMPLE_RATES },
    );
  }

  const seed = spec?.seed ?? 0;
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw fail(ERRORS.RANGE, `seed must be an integer between 0 and ${MAX_SEED}`, {
      field: 'seed',
      value: spec?.seed ?? null,
      max: MAX_SEED,
    });
  }

  const oversample = spec?.oversample ?? 0;
  if (oversample !== 0 && oversample !== 1 && oversample !== false && oversample !== true) {
    throw fail(ERRORS.SCHEMA, 'oversample must be 0/1 (or a boolean)', {
      field: 'oversample',
      value: spec?.oversample,
    });
  }

  return {
    seconds,
    sampleRate,
    seed,
    oversample: oversample ? 1 : 0,
    notes: notes.map((entry, index) => validateNote(entry, index, seconds)),
  };
}

function validateNote(entry, index, seconds) {
  const where = `notes[${index}]`;
  if (entry === null || typeof entry !== 'object') {
    throw fail(ERRORS.SCHEMA, `${where} must be an object`, { field: where });
  }
  const note = entry.note;
  if (!Number.isInteger(note) || note < 0 || note > 127) {
    throw fail(ERRORS.RANGE, `${where}.note must be an integer 0..127`, {
      field: `${where}.note`,
      value: entry.note ?? null,
    });
  }
  const velocity = entry.velocity ?? 1;
  if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) {
    throw fail(ERRORS.RANGE, `${where}.velocity must be between 0 and 1`, {
      field: `${where}.velocity`,
      value: entry.velocity ?? null,
    });
  }
  const start = entry.start ?? 0;
  if (!Number.isFinite(start) || start < 0 || start >= seconds) {
    throw fail(ERRORS.RANGE, `${where}.start must be within [0, seconds)`, {
      field: `${where}.start`,
      value: entry.start ?? null,
      seconds,
    });
  }
  const duration = entry.duration ?? seconds - start;
  if (!Number.isFinite(duration) || duration <= 0 || start + duration > seconds + 1e-9) {
    throw fail(ERRORS.RANGE, `${where}.duration must be positive and end within the render`, {
      field: `${where}.duration`,
      value: entry.duration ?? null,
      seconds,
      start,
    });
  }
  return { note, velocity, start, duration };
}

/**
 * Prime the fresh engine's phase/random sequence with `seed` silent note-ons.
 *
 * Each note-on allocates a free voice and retriggers it, which is what advances
 * `phase_seed`/`random_seed`. The note is released and settled immediately so
 * the next iteration allocates again; the master volume is zero throughout, so
 * priming is inaudible and only moves the sequence.
 */
function primeSeed(seed) {
  if (seed <= 0) return;
  ex.gs_init(SR, 32);
  ex.gs_set_param(P.MASTER_VOLUME, 0);
  ex.gs_set_param(P.ENV_RELEASE, 0.005);
  ex.gs_set_param(P.FX_REVERB_ON, 0);
  ex.gs_set_param(P.FX_DELAY_ON, 0);
  for (let i = 0; i < seed; i++) {
    ex.gs_note_on(60 + (i % 12), 1);
    ex.gs_all_notes_off();
    for (let k = 0; k < 5; k++) ex.gs_process(BLOCK);
  }
}

/**
 * Render a validated spec to interleaved-free stereo float channels.
 *
 * @returns {{left: Float32Array, right: Float32Array, blocks: number, frames: number,
 *            peak: number, rms: number, maxStep: number, nonFinite: number,
 *            allocViolations: number}}
 */
export function renderChannels(data, spec, payload) {
  const { seconds, seed, oversample, notes } = spec;
  const blocks = Math.max(1, Math.ceil((seconds * SR) / BLOCK));

  // A brand-new wasm instance: a brand-new engine, phase_seed = 0.
  initCore();
  primeSeed(seed);

  const pairs = paramPairs(payload.params).filter(([id]) => id !== P.OVERSAMPLE);
  pairs.push([P.OVERSAMPLE, oversample]);
  // `engine` is the gate's bootstrap. Passing no notes keeps the note-on timing
  // under this function's control; everything else (release, settle, parameter
  // push) is verbatim the gate's path.
  engine(pairs, []);
  // The patch's own modulation routes, written the way the gate writes them
  // (which also clears the eight slots first).
  applyRoutes(data, ex, payload.routes);

  /** Block index -> events that happen before that block is processed. */
  const on = new Map();
  const off = new Map();
  const push = (map, block, event) => {
    if (!map.has(block)) map.set(block, []);
    map.get(block).push(event);
  };
  for (const note of notes) {
    const startBlock = Math.min(blocks, Math.round((note.start * SR) / BLOCK));
    const endBlock = Math.min(blocks, Math.round(((note.start + note.duration) * SR) / BLOCK));
    push(on, startBlock, note);
    if (endBlock < blocks) push(off, endBlock, note);
  }

  const rendered = renderWith(
    blocks,
    (block) => {
      for (const event of on.get(block) ?? []) {
        ex.gs_note_on(event.note, event.velocity);
        countNoteOn();
      }
      for (const event of off.get(block) ?? []) ex.gs_note_off(event.note);
    },
    0,
  );

  const left = new Float32Array(blocks * BLOCK);
  const right = new Float32Array(blocks * BLOCK);
  rendered.forEach(([l, r], index) => {
    left.set(l, index * BLOCK);
    right.set(r, index * BLOCK);
  });

  let nonFinite = 0;
  for (let i = 0; i < left.length; i++) {
    if (!Number.isFinite(left[i])) nonFinite += 1;
    if (!Number.isFinite(right[i])) nonFinite += 1;
  }

  return {
    left,
    right,
    blocks,
    frames: blocks * BLOCK,
    peak: Math.max(peakOf(left), peakOf(right)),
    rms: Math.sqrt((rmsOf(left) ** 2 + rmsOf(right) ** 2) / 2),
    maxStep: worstStepOf(left).step,
    nonFinite,
    allocViolations: allocViolations(),
  };
}

/** The canonical hash a caller can compare against: sha256 of the WAV bytes. */
export function wavSha256(data, channels, sampleRate) {
  const bytes = encodeWavPair(data, channels.left, channels.right, sampleRate);
  return { bytes, sha256: sha256Hex(bytes), byteLength: bytes.length };
}

/** MIDI note -> Hz, the same equal-temperament map the rulers use. */
export const noteHz = (note) => 440 * 2 ** ((note - 69) / 12);
