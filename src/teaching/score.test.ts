import { describe, expect, it } from 'vitest';
import { buildExercise, type ExerciseTarget } from './theory';
import { HIT_WINDOW_MS, scorePerformance, type PlayedNote } from './score';

/**
 * The scoring rules, pinned exactly.
 *
 * Every number asserted here is also written down in `docs/notes/teaching.md`;
 * if one of them changes, both places change together. The two tests that carry
 * the batch's self-check are called out below — they are the ones that go red
 * when the matching rule or an intonation weight is broken on purpose.
 */

const target = (steps: number[][], onsets: number[], bpm = 120): ExerciseTarget => {
  const built = steps.map((pitches, index) => ({ pitches, onset: onsets[index] }));
  return {
    kind: 'scale',
    root: steps[0]?.[0] ?? 60,
    id: 'test',
    bpm,
    octaves: 1,
    pitches: [...new Set(steps.flat())],
    steps: built,
    expected: built.reduce((sum, step) => sum + step.pitches.length, 0),
  };
};

/** A scale target: one note per step, C major over one octave at 120 bpm. */
const cMajor = target(
  [[60], [62], [64], [65], [67], [69], [71], [72]],
  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
);

const play = (note: number, start: number, duration = 0.4): PlayedNote => ({ note, start, duration });

/** On the grid, exactly what the exercise asks for. */
const perfect = (t: ExerciseTarget): PlayedNote[] =>
  t.steps.map((step) => play(step.pitches[0], step.onset));

describe('scorePerformance — the defined cases', () => {
  it('gives a perfect on-time take exactly 100', () => {
    const result = scorePerformance(cMajor, perfect(cMajor));
    expect(result.score).toBe(100);
    expect(result.expected).toBe(8);
    expect(result.matched).toBe(8);
    expect(result.missed).toBe(0);
    expect(result.extra).toBe(0);
    expect(result.hitRate).toBe(1);
    expect(result.intonation.meanError).toBe(0);
    expect(result.intonation.quality).toBe(1);
    expect(result.timing.meanAbsMs).toBe(0);
    expect(result.timing.early).toBe(0);
    expect(result.timing.late).toBe(0);
    expect(result.timing.quality).toBe(1);
  });

  it('gives an empty take exactly 0 and counts every note as missed', () => {
    const result = scorePerformance(cMajor, []);
    expect(result.score).toBe(0);
    expect(result.matched).toBe(0);
    expect(result.missed).toBe(8);
    expect(result.extra).toBe(0);
    expect(result.hitRate).toBe(0);
    // Nothing wrong was played, so the two quality terms stay at 1: the score
    // is zero because nothing was hit, not because they were penalised.
    expect(result.intonation.quality).toBe(1);
    expect(result.timing.quality).toBe(1);
    expect(result.timing.deviations).toEqual([]);
  });

  it('gives an empty target 0 rather than a vacuous 100', () => {
    const result = scorePerformance(target([], []), [play(60, 0)]);
    expect(result.score).toBe(0);
    expect(result.expected).toBe(0);
    expect(result.hitRate).toBe(0);
    expect(result.extra).toBe(1);
  });

  it('does not count a wrong pitch as a hit', () => {
    // The last step wants 65 (F4) and gets 61: the onset is right, the pitch is
    // four semitones low, and that distance is what the intonation report sees.
    const four = target([[60], [62], [64], [65]], [0, 0.5, 1, 1.5]);
    const result = scorePerformance(four, [play(60, 0), play(62, 0.5), play(64, 1), play(61, 1.5)]);
    expect(result.expected).toBe(4);
    expect(result.matched).toBe(3);
    expect(result.missed).toBe(1);
    expect(result.extra).toBe(1);
    expect(result.hitRate).toBe(0.75);
    expect(result.intonation.errors).toEqual([4]);
    // 100 · 0.75 · (0.6 + 0.2·(1/3) + 0.2·1) = 65.0
    expect(result.score).toBe(65);
  });

  /**
   * Self-check #2: if the matching rule stopped looking at the pitch, this
   * take would be 4/4 with `extra === 0` and a score of 100. The assertions on
   * `matched`, `extra` and `hitRate` are what make that sabotage red.
   */
  it('keeps the one-semitone-off note out of the hit count', () => {
    const four = target([[60], [62], [64], [65]], [0, 0.5, 1, 1.5]);
    const result = scorePerformance(four, [play(60, 0), play(62, 0.5), play(64, 1), play(66, 1.5)]);
    expect(result.matched).toBe(3);
    expect(result.extra).toBe(1);
    expect(result.hitRate).toBeLessThan(1);
    expect(result.intonation.errors).toEqual([1]);
    expect(result.intonation.meanError).toBe(1);
    expect(result.intonation.quality).toBeCloseTo(2 / 3, 4);
  });

  /**
   * Self-check #1: the *distance* of a wrong note is graded, not just the fact
   * that it is wrong. Both takes hit 3 of 4 notes with perfect timing, so the
   * only difference is the semitone error; zeroing the intonation weight makes
   * the two scores equal and this test red.
   */
  it('scores a near-miss higher than a far miss', () => {
    const four = target([[60], [62], [64], [65]], [0, 0.5, 1, 1.5]);
    const near = scorePerformance(four, [play(60, 0), play(62, 0.5), play(64, 1), play(66, 1.5)]);
    const far = scorePerformance(four, [play(60, 0), play(62, 0.5), play(64, 1), play(59, 1.5)]);
    expect(near.intonation.meanError).toBe(1);
    expect(far.intonation.meanError).toBe(6);
    expect(near.score).toBe(70);
    // 100 · 0.75 · (0.6 + 0.2·0.25 + 0.2·1) = 63.75 -> 64
    expect(far.score).toBe(64);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('grades lateness with a linear rhythm term', () => {
    const late = cMajor.steps.map((step) => play(step.pitches[0], step.onset + 0.15));
    const result = scorePerformance(cMajor, late);
    expect(result.matched).toBe(8);
    expect(result.timing.meanMs).toBe(150);
    expect(result.timing.meanAbsMs).toBe(150);
    expect(result.timing.maxAbsMs).toBe(150);
    expect(result.timing.late).toBe(8);
    expect(result.timing.early).toBe(0);
    expect(result.timing.quality).toBe(0.5);
    expect(result.timing.meanAbsBeats).toBe(0.3);
    // 100 · 1 · (0.6 + 0.2·1 + 0.2·0.5) = 90
    expect(result.score).toBe(90);
  });

  it('counts an early note as early, with a negative deviation', () => {
    const result = scorePerformance(cMajor, cMajor.steps.map((step) => play(step.pitches[0], step.onset - 0.1)));
    expect(result.timing.meanMs).toBe(-100);
    expect(result.timing.early).toBe(8);
    expect(result.timing.late).toBe(0);
  });

  it('accepts a note exactly on the window edge and refuses the next millisecond', () => {
    const one = target([[60]], [0]);
    const edge = scorePerformance(one, [play(60, HIT_WINDOW_MS / 1000)]);
    expect(edge.matched).toBe(1);
    expect(edge.timing.meanMs).toBe(300);
    const just = scorePerformance(one, [play(60, 0.301)]);
    expect(just.matched).toBe(0);
    expect(just.missed).toBe(1);
    expect(just.extra).toBe(1);
    // The early edge is inclusive too.
    expect(scorePerformance(one, [play(60, -0.3)]).timing.meanMs).toBe(-300);
  });

  it('honours a caller-supplied window', () => {
    const two = target([[60], [62]], [0, 1]);
    const loose = scorePerformance(two, [play(60, 0.25)], { windowMs: 300 });
    expect(loose.matched).toBe(1);
    const tight = scorePerformance(two, [play(60, 0.25)], { windowMs: 200 });
    expect(tight.matched).toBe(0);
    expect(tight.extra).toBe(1);
  });

  it('assigns a note between two steps to the nearer one, ties to the earlier', () => {
    const two = target([[60], [62]], [0, 0.5]);
    expect(scorePerformance(two, [play(60, 0.2)]).matched).toBe(1);
    expect(scorePerformance(two, [play(62, 0.3)]).matched).toBe(1);
    // Exactly half-way: step 0 is offered first and wins the tie, which shows
    // up as a +250 ms deviation rather than -250 ms.
    const tie = scorePerformance(two, [play(60, 0.25)]);
    expect(tie.matched).toBe(1);
    expect(tie.missed).toBe(1);
    expect(tie.timing.deviations).toEqual([250]);
  });

  it('prefers a precise `onset` over a nominal `start`', () => {
    const one = target([[60]], [0]);
    const result = scorePerformance(one, [{ note: 60, start: 5, duration: 0.4, onset: 0.001 }]);
    expect(result.matched).toBe(1);
    expect(result.timing.meanMs).toBe(1);
  });

  it('grades a strummed block chord inside one window', () => {
    const chord = target([[60, 64, 67]], [0]);
    const result = scorePerformance(chord, [play(60, 0), play(64, 0.05), play(67, 0.1)]);
    expect(result.expected).toBe(3);
    expect(result.matched).toBe(3);
    expect(result.missed).toBe(0);
    // All three are inside the window, so every pitch is a hit; the 50 ms mean
    // spread of the strum is a real, if small, rhythm deviation: 97, not 100.
    expect(result.timing.meanAbsMs).toBe(50);
    expect(result.score).toBe(97);
  });

  it('counts a repeated correct note as extra with a zero-semitone error', () => {
    const one = target([[60]], [0]);
    const result = scorePerformance(one, [play(60, 0), play(60, 0.05)]);
    expect(result.matched).toBe(1);
    expect(result.extra).toBe(1);
    expect(result.intonation.errors).toEqual([0]);
    expect(result.score).toBe(100);
  });

  it('ignores notes that fall outside every window', () => {
    const two = target([[60], [62]], [0, 1]);
    const result = scorePerformance(two, [play(60, 0.25), play(62, 1.25)], { windowMs: 100 });
    expect(result.matched).toBe(0);
    expect(result.missed).toBe(2);
    expect(result.extra).toBe(2);
    expect(result.score).toBe(0);
  });

  it('reports a per-pitch tally', () => {
    const four = target([[60], [62], [64], [65]], [0, 0.5, 1, 1.5]);
    const result = scorePerformance(four, [play(60, 0), play(64, 1)]);
    expect(result.pitches).toEqual([
      { pitch: 60, expected: 1, matched: 1 },
      { pitch: 62, expected: 1, matched: 0 },
      { pitch: 64, expected: 1, matched: 1 },
      { pitch: 65, expected: 1, matched: 0 },
    ]);
    expect(result.missed).toBe(2);
  });

  it('does not let off-time extra notes change the score', () => {
    const junk = [play(61, 0.25), play(63, 1.25)];
    const result = scorePerformance(cMajor, [...perfect(cMajor), ...junk], { windowMs: 100 });
    expect(result.matched).toBe(8);
    expect(result.extra).toBe(2);
    expect(result.score).toBe(100);
  });

  it('drops non-finite events instead of poisoning the result', () => {
    const result = scorePerformance(cMajor, [
      ...perfect(cMajor),
      { note: Number.NaN, start: 0, duration: 0.4 },
      { note: 60, start: Number.POSITIVE_INFINITY, duration: 0.4 },
    ]);
    expect(result.matched).toBe(8);
    expect(result.extra).toBe(0);
    expect(result.score).toBe(100);
  });

  it('is order-independent', () => {
    const shuffled = [...perfect(cMajor)].reverse();
    expect(scorePerformance(cMajor, shuffled)).toEqual(scorePerformance(cMajor, perfect(cMajor)));
  });

  it('normalises the weights, so zeroing one cannot push the score past 100', () => {
    const result = scorePerformance(cMajor, perfect(cMajor), {
      weights: { accuracy: 1, intonation: 0, rhythm: 0 },
    });
    expect(result.score).toBe(100);
  });
});

describe('scorePerformance with a real exercise', () => {
  it('grades the exercise the UI builds', () => {
    const exercise = buildExercise({ kind: 'scale', root: 48, id: 'major', octaves: 1, bpm: 90 });
    const onGrid = exercise.steps.map((step) => play(step.pitches[0], step.onset));
    const good = scorePerformance(exercise, onGrid);
    expect(good.score).toBe(100);
    expect(good.expected).toBe(8);

    // The off-scale keys the E2E feeds for the "wrong" take.
    const offScale = [49, 51, 54, 56, 58, 61, 49, 51];
    const bad = scorePerformance(
      exercise,
      exercise.steps.map((step, index) => play(offScale[index], step.onset)),
    );
    expect(bad.hitRate).toBe(0);
    expect(bad.matched).toBe(0);
    expect(bad.missed).toBe(8);
    expect(bad.extra).toBe(8);
    expect(bad.score).toBe(0);
  });
});
