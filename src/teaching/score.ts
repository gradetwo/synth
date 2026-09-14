/**
 * Practice scoring (P12.1).
 *
 * The scorer is a pure function from an `ExerciseTarget` (expected pitches and
 * their onsets) plus a list of played notes to a `PracticeResult`. It never
 * touches the DOM, never reads a clock and never mutates its input, so the same
 * take always produces the same numbers and a unit test can pin every rule. The
 * exact definition — matching, tolerances, weights and the boundary cases — is
 * written down in `docs/notes/teaching.md`; this file is its implementation and
 * `score.test.ts` is its proof.
 *
 * The rules in one paragraph. Every played note is assigned to the *nearest*
 * expected step whose onset lies within `windowMs` (ties go to the earlier
 * step). If the note's pitch is one of that step's pitches and has not been used
 * yet, it is a **hit** and its signed timing deviation is recorded. Otherwise
 * the note is **extra**: an off-time note when no step was in range, a
 * wrong-pitch note when one was (and its distance to the nearest expected pitch
 * of that step feeds the intonation report). Expected pitches that never get a
 * hit are **missed**. The total is
 *
 *     score = round(100 · hitRate · (Wacc + Winto · intonationQ + Wrhy · rhythmQ))
 *
 * with the weights summing to 1, so a perfect take is exactly 100 and an empty
 * one is 0. Intonation and rhythm only ever scale the score *down*; a take with
 * every right note and no wrong ones scores 100 even if it was never graded on
 * timing (see the free-rhythm note in the doc).
 */

import type { ExerciseTarget } from './theory';

/** A note someone played, in seconds. */
export interface PlayedNote {
  /** MIDI note number. */
  note: number;
  /** Onset in seconds, used when `onset` is absent. */
  start: number;
  /** Length in seconds; carried through for callers that want it, not scored. */
  duration: number;
  /**
   * The device's own timestamp in seconds, when it has one that is more precise
   * than `start` (a MIDI recorder's hardware clock, say). When present it *is*
   * the onset and `start` is treated as the nominal grid position.
   */
  onset?: number;
}

/** Default half-width of the timing window, in milliseconds. */
export const HIT_WINDOW_MS = 300;

/** The semitone error at which the intonation term halves. */
export const INTONATION_REFERENCE_SEMITONES = 2;

/** How the three terms are mixed. They sum to 1, so a perfect take is 100. */
export const SCORE_WEIGHTS = { accuracy: 0.6, intonation: 0.2, rhythm: 0.2 } as const;

export interface ScoreOptions {
  /** Timing window half-width in ms; a note exactly on the edge counts. */
  windowMs?: number;
  /** Semitone error that halves the intonation term. */
  intonationReference?: number;
  /** Term weights; they are normalised by their sum, so 0/0/0 cannot happen. */
  weights?: { accuracy: number; intonation: number; rhythm: number };
}

export interface IntonationReport {
  /** Absolute semitone error of every wrong-pitch note, in take order. */
  errors: number[];
  meanError: number;
  maxError: number;
  /** `1 / (1 + meanError / reference)`; 1 when no wrong pitch was played. */
  quality: number;
}

export interface TimingReport {
  /** Signed deviations in ms (negative = early) of every hit, in take order. */
  deviations: number[];
  meanMs: number;
  meanAbsMs: number;
  maxAbsMs: number;
  /** The same figures in beats, using the target's tempo. */
  meanAbsBeats: number;
  maxAbsBeats: number;
  early: number;
  late: number;
  /** `clamp(1 - meanAbsMs / windowMs, 0, 1)`; 1 when there is nothing to grade. */
  quality: number;
}

/** Per-pitch hit tally, so a teacher can see *which* note keeps being missed. */
export interface PitchTally {
  pitch: number;
  expected: number;
  matched: number;
}

export interface PracticeResult {
  /** Expected notes in the target. */
  expected: number;
  matched: number;
  missed: number;
  /** Played notes that were not hits (off-time plus wrong-pitch). */
  extra: number;
  /** `matched / expected`, 0 when the target is empty. */
  hitRate: number;
  intonation: IntonationReport;
  timing: TimingReport;
  /** One entry per distinct expected pitch, in first-appearance order. */
  pitches: PitchTally[];
  /** 0..100, integer. */
  score: number;
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const maxOf = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.max(...values));

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Grade a performance against a target.
 *
 * The input is never mutated and the played list may be in any order — it is
 * sorted by onset on the way in, with the note number and the caller's order as
 * deterministic tie-breakers.
 */
export function scorePerformance(
  target: ExerciseTarget,
  played: readonly PlayedNote[],
  options: ScoreOptions = {},
): PracticeResult {
  const windowMs = options.windowMs ?? HIT_WINDOW_MS;
  const reference = options.intonationReference ?? INTONATION_REFERENCE_SEMITONES;
  const weights = options.weights ?? SCORE_WEIGHTS;
  const weightSum = weights.accuracy + weights.intonation + weights.rhythm || 1;

  // The expected pitches, with a hit set per step so a repeated note cannot be
  // counted twice.
  const tallies = new Map<number, PitchTally>();
  for (const step of target.steps) {
    for (const pitch of step.pitches) {
      const tally = tallies.get(pitch) ?? { pitch, expected: 0, matched: 0 };
      tally.expected += 1;
      tallies.set(pitch, tally);
    }
  }
  const matchedPerStep = target.steps.map(() => new Set<number>());

  const notes = played
    .map((event, index) => ({ note: event.note, at: event.onset ?? event.start, index }))
    .filter((event) => Number.isFinite(event.note) && Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at || a.note - b.note || a.index - b.index);

  const deviations: number[] = [];
  const pitchErrors: number[] = [];
  let offTime = 0;
  let wrongPitch = 0;

  for (const event of notes) {
    let stepIndex = -1;
    let bestDelta = Infinity;
    for (let index = 0; index < target.steps.length; index += 1) {
      const delta = Math.abs(event.at - target.steps[index].onset);
      // Strict `<` keeps the earlier step on an exact tie.
      if (delta <= windowMs / 1000 && delta < bestDelta) {
        bestDelta = delta;
        stepIndex = index;
      }
    }

    if (stepIndex < 0) {
      offTime += 1;
      continue;
    }

    const step = target.steps[stepIndex];
    const hits = matchedPerStep[stepIndex];
    if (step.pitches.includes(event.note) && !hits.has(event.note)) {
      hits.add(event.note);
      deviations.push((event.at - step.onset) * 1000);
      const tally = tallies.get(event.note);
      if (tally) tally.matched += 1;
    } else {
      wrongPitch += 1;
      // Distance to the nearest pitch the step actually asked for. A repeated
      // correct pitch lands here with an error of 0: it is an extra note, not a
      // wrong one.
      let nearest = Infinity;
      for (const pitch of step.pitches) nearest = Math.min(nearest, Math.abs(event.note - pitch));
      pitchErrors.push(nearest === Infinity ? 0 : nearest);
    }
  }

  const matched = matchedPerStep.reduce((sum, hits) => sum + hits.size, 0);
  const missed = Math.max(0, target.expected - matched);
  const empty = target.expected === 0 || target.steps.length === 0;

  const meanError = mean(pitchErrors);
  const meanAbsMs = mean(deviations.map((value) => Math.abs(value)));
  const meanAbsBeats = meanAbsMs === 0 ? 0 : (meanAbsMs / 1000) * (target.bpm / 60);

  const hitRate = empty ? 0 : matched / target.expected;
  const intonationQuality = 1 / (1 + meanError / reference);
  const rhythmQuality = deviations.length === 0 ? 1 : clamp01(1 - meanAbsMs / windowMs);

  const score = empty
    ? 0
    : Math.round(
        100 *
          hitRate *
          ((weights.accuracy +
            weights.intonation * intonationQuality +
            weights.rhythm * rhythmQuality) /
            weightSum),
      );

  return {
    expected: target.expected,
    matched,
    missed,
    extra: offTime + wrongPitch,
    hitRate: round(hitRate, 4),
    intonation: {
      errors: pitchErrors,
      meanError: round(meanError, 3),
      maxError: maxOf(pitchErrors),
      quality: round(intonationQuality, 4),
    },
    timing: {
      deviations: deviations.map((value) => round(value, 1)),
      meanMs: round(mean(deviations), 1),
      meanAbsMs: round(meanAbsMs, 1),
      maxAbsMs: round(maxOf(deviations.map((value) => Math.abs(value))), 1),
      meanAbsBeats: round(meanAbsBeats, 3),
      maxAbsBeats: round(
        deviations.length === 0 ? 0 : (maxOf(deviations.map((value) => Math.abs(value))) / 1000) * (target.bpm / 60),
        3,
      ),
      early: deviations.filter((value) => value < 0).length,
      late: deviations.filter((value) => value > 0).length,
      quality: round(rhythmQuality, 4),
    },
    pitches: [...tallies.values()],
    score,
  };
}
