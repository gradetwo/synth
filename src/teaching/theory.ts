/**
 * Scale and chord theory for the teaching mode (P12.1).
 *
 * Everything here is a pure function of numbers: a root **MIDI note number**
 * (not a note name, and never a string) plus a set id gives back the pitches a
 * player has to hit. That is the whole interface the practice scorer and the
 * keyboard highlight need, and it is deliberately free of React, DOM and i18n
 * so it can be pinned by unit tests without a browser.
 *
 * Two conventions are worth stating because the UI and the scorer both rely on
 * them:
 *
 *   * `scalePitches` returns the scale **ascending over `octaves` octaves, with
 *     the closing octave included** — C major over one octave is eight notes,
 *     not seven. That is what a scale exercise plays, so the exercise builder
 *     does not have to special-case the top note.
 *   * `chordPitches` returns the chord tones **plus the root an octave up**, so
 *     the arpeggio has a definite top and one octave is a complete figure
 *     (C-E-G-C for a major triad).
 *
 * Out-of-range roots are clamped to 0..127 and duplicate pitches that clamping
 * produces are dropped, so every function is total: an absurd root yields a
 * short exercise, never a pitch outside the MIDI range.
 */

/** The MIDI note range, the same one `midi/roll.ts` uses. */
export const MIN_MIDI = 0;
export const MAX_MIDI = 127;

/** Which family a set id names. */
export type ExerciseKind = 'scale' | 'chord';

/** A named set of semitone offsets from the root, ascending, starting at 0. */
export interface IntervalSet {
  id: string;
  semitones: readonly number[];
}

/**
 * The scales the assistant offers. Natural minor is the plain `minor`; the
 * harmonic variant is separate because its raised seventh is a different
 * exercise, and the blues scale keeps the flat fifth that makes it one.
 */
export const SCALES: readonly IntervalSet[] = [
  { id: 'major', semitones: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', semitones: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonicMinor', semitones: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'dorian', semitones: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'majorPentatonic', semitones: [0, 2, 4, 7, 9] },
  { id: 'minorPentatonic', semitones: [0, 3, 5, 7, 10] },
  { id: 'blues', semitones: [0, 3, 5, 6, 7, 10] },
];

/** The chords, as stacked-thirds plus the two suspended voicings. */
export const CHORDS: readonly IntervalSet[] = [
  { id: 'major', semitones: [0, 4, 7] },
  { id: 'minor', semitones: [0, 3, 7] },
  { id: 'dim', semitones: [0, 3, 6] },
  { id: 'aug', semitones: [0, 4, 8] },
  { id: 'sus2', semitones: [0, 2, 7] },
  { id: 'sus4', semitones: [0, 5, 7] },
  { id: 'maj7', semitones: [0, 4, 7, 11] },
  { id: 'min7', semitones: [0, 3, 7, 10] },
  { id: 'dom7', semitones: [0, 4, 7, 10] },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * A MIDI number as `C4`-style text. A local copy of `noteBus.noteName` on
 * purpose: importing the audio module from a pure theory module would drag the
 * engine into every unit test that only wants arithmetic.
 */
export function pitchName(midi: number): string {
  const note = Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(midi)));
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

/** The set with this id, falling back to the first one for an unknown id. */
export function findSet(kind: ExerciseKind, id: string): IntervalSet {
  const sets = kind === 'chord' ? CHORDS : SCALES;
  return sets.find((set) => set.id === id) ?? sets[0];
}

const clampMidi = (note: number): number => Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(note)));

/** Clamp to the MIDI range and drop repeated pitches, keeping first order. */
function tidy(pitches: readonly number[]): number[] {
  const out: number[] = [];
  for (const pitch of pitches) {
    const note = clampMidi(pitch);
    if (!out.includes(note)) out.push(note);
  }
  return out;
}

/** How many octaves a request may span, whatever the caller passes. */
const octaveSpan = (octaves: number): number =>
  Math.max(1, Math.min(3, Number.isFinite(octaves) ? Math.round(octaves) : 1));

/**
 * The ascending scale from `root`, `octaves` octaves, closing octave included.
 *
 * C4 major over one octave is `[60, 62, 64, 65, 67, 69, 71, 72]`.
 */
export function scalePitches(root: number, id: string, octaves = 1): number[] {
  const set = findSet('scale', id);
  const span = octaveSpan(octaves);
  const out: number[] = [];
  for (let octave = 0; octave < span; octave += 1) {
    for (const semitone of set.semitones) out.push(root + octave * 12 + semitone);
  }
  out.push(root + span * 12);
  return tidy(out);
}

/**
 * The chord tones from `root`, `octaves` octaves, plus the closing root.
 *
 * C4 major over one octave is `[60, 64, 67, 72]` — the arpeggio the exercise
 * plays, which is why the top root is part of the set.
 */
export function chordPitches(root: number, id: string, octaves = 1): number[] {
  const set = findSet('chord', id);
  const span = octaveSpan(octaves);
  const out: number[] = [];
  for (let octave = 0; octave < span; octave += 1) {
    for (const semitone of set.semitones) out.push(root + octave * 12 + semitone);
  }
  out.push(root + span * 12);
  return tidy(out);
}

/** The pitch set for either family, which is also what the keyboard highlights. */
export function exercisePitches(kind: ExerciseKind, root: number, id: string, octaves = 1): number[] {
  return kind === 'chord' ? chordPitches(root, id, octaves) : scalePitches(root, id, octaves);
}

/** One expected event: the pitches that should sound at `onset` seconds. */
export interface ExerciseStep {
  pitches: number[];
  /** Seconds from the start of the take. */
  onset: number;
}

/** What the practice scorer grades and what the UI displays. */
export interface ExerciseTarget {
  kind: ExerciseKind;
  root: number;
  id: string;
  bpm: number;
  octaves: number;
  /** Every pitch the figure uses — the highlight set. */
  pitches: number[];
  steps: ExerciseStep[];
  /** Total expected notes (`Σ steps[].pitches.length`). */
  expected: number;
}

/**
 * Turn a chosen root/type into the sequence the player is asked to perform.
 *
 * Both families are performed as an **ascending arpeggio, one note per beat**:
 * a scale for the scale family, the chord tones (root, third, fifth, … and the
 * root again) for the chord family. One note per step keeps the rhythm signal
 * meaningful — a block chord inside a single onset would make the timing score
 * a foregone conclusion — and it is the figure a teacher actually asks for.
 *
 * `bpm` is clamped to 20..400 so a stray value cannot produce zero-length
 * beats; the caller is expected to offer a small list of sane tempos.
 */
export function buildExercise(options: {
  kind: ExerciseKind;
  root: number;
  id: string;
  octaves?: number;
  bpm?: number;
}): ExerciseTarget {
  const kind = options.kind === 'chord' ? 'chord' : 'scale';
  const span = octaveSpan(options.octaves ?? 1);
  const root = clampMidi(options.root);
  const bpm = Math.max(20, Math.min(400, Number.isFinite(options.bpm) ? Math.round(options.bpm as number) : 90));
  const pitches = exercisePitches(kind, root, options.id, span);
  const secondsPerBeat = 60 / bpm;
  const steps = pitches.map((pitch, index) => ({
    pitches: [pitch],
    onset: index * secondsPerBeat,
  }));
  return {
    kind,
    root,
    id: findSet(kind, options.id).id,
    bpm,
    octaves: span,
    pitches,
    steps,
    expected: steps.length,
  };
}
