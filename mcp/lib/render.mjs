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
import { installInstrument } from './session.mjs';
import { encodeWavPair, sha256Hex } from './wav.mjs';

/**
 * The render caps.
 *
 * `MAX_SECONDS` was 30, which cannot hold a whole demo song: an agent had to
 * chop one into several calls and stitch the WAVs itself, and the JSON note list
 * for a long arrangement is the other half of the same problem (see
 * `resolveNotesInput`). The measured cost of this renderer is **~5.5× realtime**
 * on a dense 16th-note arrangement at 2× oversampling (30 s in 5.5 s wall), so
 * 120 s is ~22 s inside one tool call — long enough for a two-minute section,
 * short enough to stay a call rather than a batch job. `MAX_NOTES` moves with
 * it: 16ths for 120 s is 960 notes before any chord is added.
 */
export const MAX_SECONDS = 120;
export const MIN_SECONDS = 0.05;
export const MAX_NOTES = 4096;
export const MAX_SEED = 512;
/** `midiBase64` is decoded before it is trusted; ~1.5 MB of file is plenty. */
export const MAX_MIDI_BASE64 = 2 * 1024 * 1024;
/** The only rate the rulers are calibrated at (see `audio-ruler.mjs`). */
export const SAMPLE_RATES = [48000];

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Turn whichever note input the caller used into one `notes` array.
 *
 * Three ways in, exactly one of them:
 *
 *   * `notes`      — the JSON list this tool has always taken;
 *   * `songId`     — a built-in song, expanded by the app's own `demoSong()`;
 *   * `midiBase64` — a standard MIDI file, decoded by the app's own `parseMidi()`.
 *
 * The last two exist for **token economy**: a 240-note arrangement is roughly
 * 30 KB of JSON against a few KB of MIDI, and a built-in song that `gs1.songs.list`
 * already names costs one string. Both produce `MidiNote`s, which are already the
 * shape `notes` takes — `{ note, velocity, start, duration }`, start and duration
 * in seconds — so they go through the same validation and the same renderer
 * rather than a second path.
 *
 * @returns {null | { source: 'songId'|'midiBase64', notes: object[], sourceSeconds: number }}
 *   `null` for the `notes` path, which keeps the strict validation it always had.
 */
export function resolveNotesInput(data, spec) {
  const given = ['notes', 'songId', 'midiBase64'].filter((key) => spec?.[key] !== undefined);
  if (given.length !== 1) {
    throw fail(ERRORS.SCHEMA, 'provide exactly one of `notes`, `songId` or `midiBase64`', { given });
  }
  // A hand-written list is the caller's own arithmetic, so it is validated
  // strictly rather than clipped; only a decoded source is fitted to the window.
  if (given[0] === 'notes') return null;

  if (given[0] === 'songId') {
    const id = spec.songId;
    if (typeof id !== 'string' || id.length === 0) {
      throw fail(ERRORS.SCHEMA, 'songId must be a non-empty string', { field: 'songId', value: id ?? null });
    }
    const song = data.demoSong(id);
    if (!song) {
      throw fail(ERRORS.SCHEMA, `no built-in song with the id "${id}"`, {
        field: 'songId',
        value: id,
        hint: 'gs1.songs.list names every id',
      });
    }
    if (song.notes.length === 0) {
      throw fail(ERRORS.SCHEMA, `the built-in song "${id}" has no notes`, { field: 'songId', value: id });
    }
    return { source: 'songId', notes: song.notes, sourceSeconds: song.duration };
  }

  const base64 = spec.midiBase64;
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw fail(ERRORS.SCHEMA, 'midiBase64 must be a non-empty base64 string', {
      field: 'midiBase64',
      value: typeof base64,
    });
  }
  if (base64.length > MAX_MIDI_BASE64) {
    throw fail(ERRORS.RANGE, `midiBase64 must hold at most ${MAX_MIDI_BASE64} characters`, {
      field: 'midiBase64',
      length: base64.length,
      max: MAX_MIDI_BASE64,
    });
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || !data.looksLikeMidi(bytes)) {
    throw fail(ERRORS.SCHEMA, 'midiBase64 does not hold a standard MIDI file (no MThd header)', {
      field: 'midiBase64',
      bytes: bytes.length,
    });
  }
  const song = data.parseMidi(bytes, 'midiBase64');
  if (song.notes.length === 0) {
    throw fail(ERRORS.SCHEMA, 'midiBase64 decoded to a song with no notes', {
      field: 'midiBase64',
      bytes: bytes.length,
    });
  }
  return { source: 'midiBase64', notes: song.notes, sourceSeconds: song.duration };
}

/**
 * Fit a decoded song into the render window.
 *
 * A song longer than `MAX_SECONDS` (or a `seconds` the caller chose) has to lose
 * something, and dropping it silently would be the one thing this server does not
 * do — so the count comes back in the result as `notesDropped`.
 */
function clipToWindow(notes, seconds) {
  const kept = [];
  let dropped = 0;
  for (const entry of notes) {
    if (!(entry.start < seconds)) {
      dropped += 1;
      continue;
    }
    const duration = Math.min(entry.duration, seconds - entry.start);
    if (!(duration > 0)) {
      dropped += 1;
      continue;
    }
    kept.push({ ...entry, duration });
  }
  return { kept, dropped };
}

/**
 * Validate `seconds`/`notes`/`seed`/`oversample`/`sampleRate`; throws structured
 * rejections.
 *
 * `resolved` is what `resolveNotesInput` returned, when the caller used `songId`
 * or `midiBase64`. Those notes are **clipped** to the window (and the count
 * reported) instead of rejected: a caller who names a song is asking for the
 * song, not for a validation error about the last note. A hand-written `notes`
 * list keeps the strict contract it has always had — its notes are the caller's
 * own arithmetic, and a note that runs past `seconds` is a mistake worth naming.
 */
export function validateRenderSpec(spec, resolved = null) {
  const defaultSeconds =
    resolved?.sourceSeconds != null
      ? Math.max(MIN_SECONDS, Math.min(round3(resolved.sourceSeconds + 0.5), MAX_SECONDS))
      : 2;
  const seconds = spec?.seconds ?? defaultSeconds;
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    throw fail(ERRORS.RANGE, `seconds must be between ${MIN_SECONDS} and ${MAX_SECONDS}`, {
      field: 'seconds',
      value: spec?.seconds ?? null,
      min: MIN_SECONDS,
      max: MAX_SECONDS,
    });
  }

  const clipped = resolved
    ? clipToWindow(resolved.notes, seconds)
    : { kept: spec?.notes, dropped: 0 };
  const notes = clipped.kept;
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
    /** Which input the notes came from, echoed so a result is self-describing. */
    source: resolved?.source ?? 'notes',
    /** How long the song itself is, before the window clipped it (null for `notes`). */
    sourceSeconds: resolved?.sourceSeconds ?? null,
    /**
     * True when the song is longer than the window that was rendered. Measured
     * against the song's own length and not against the defaulted window: a
     * caller who rendered `drift` in 2 s asked for a fragment, and one who
     * rendered all 45 s got the whole piece with the tail on top.
     */
    truncated: resolved?.sourceSeconds != null && resolved.sourceSeconds > seconds + 1e-9,
    notesDropped: clipped.dropped,
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
export function renderChannels(data, spec, payload, session = null) {
  const { seconds, seed, oversample, notes } = spec;
  const blocks = Math.max(1, Math.ceil((seconds * SR) / BLOCK));

  // A brand-new wasm instance: a brand-new engine, phase_seed = 0.
  initCore();
  // P13.3: a fresh instance has no imported sample or cycle, so the session's
  // instrument is replayed before the first block (see `lib/session.mjs`).
  installInstrument(session);
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
