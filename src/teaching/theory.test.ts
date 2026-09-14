import { describe, expect, it } from 'vitest';
import { TEACH_STRINGS } from '@/i18n.teach';
import {
  CHORDS,
  MAX_MIDI,
  SCALES,
  buildExercise,
  chordPitches,
  exercisePitches,
  pitchName,
  scalePitches,
} from './theory';

/**
 * The scale/chord arithmetic and the exercise shape.
 *
 * These are the numbers the highlight and the scorer are built on, so they are
 * pinned exactly: a wrong interval here would move every score with it, and the
 * "closing octave included" convention is the one a reader is most likely to
 * assume the other way round.
 */

describe('pitch sets', () => {
  it('builds an ascending major scale with the closing octave', () => {
    expect(scalePitches(60, 'major')).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('knows the minor, mode and pentatonic variants', () => {
    expect(scalePitches(57, 'minor')).toEqual([57, 59, 60, 62, 64, 65, 67, 69]);
    expect(scalePitches(57, 'harmonicMinor')).toEqual([57, 59, 60, 62, 64, 65, 68, 69]);
    expect(scalePitches(62, 'dorian')).toEqual([62, 64, 65, 67, 69, 71, 72, 74]);
    expect(scalePitches(60, 'majorPentatonic')).toEqual([60, 62, 64, 67, 69, 72]);
    expect(scalePitches(60, 'minorPentatonic')).toEqual([60, 63, 65, 67, 70, 72]);
    expect(scalePitches(60, 'blues')).toEqual([60, 63, 65, 66, 67, 70, 72]);
  });

  it('spans two octaves when asked, keeping one closing octave', () => {
    const two = scalePitches(60, 'major', 2);
    expect(two).toHaveLength(15);
    expect(two[0]).toBe(60);
    expect(two[13]).toBe(83);
    expect(two[14]).toBe(84);
  });

  it('builds chord tones plus the root an octave up', () => {
    expect(chordPitches(60, 'major')).toEqual([60, 64, 67, 72]);
    expect(chordPitches(62, 'min7')).toEqual([62, 65, 69, 72, 74]);
    expect(chordPitches(60, 'dim')).toEqual([60, 63, 66, 72]);
    expect(chordPitches(60, 'aug')).toEqual([60, 64, 68, 72]);
    expect(chordPitches(60, 'sus2')).toEqual([60, 62, 67, 72]);
    expect(chordPitches(60, 'sus4')).toEqual([60, 65, 67, 72]);
    expect(chordPitches(60, 'dom7')).toEqual([60, 64, 67, 70, 72]);
  });

  it('routes either family through exercisePitches', () => {
    expect(exercisePitches('scale', 60, 'major')).toEqual(scalePitches(60, 'major'));
    expect(exercisePitches('chord', 60, 'major')).toEqual(chordPitches(60, 'major'));
  });

  it('falls back to the first set for an unknown id', () => {
    expect(scalePitches(60, 'not-a-scale')).toEqual(scalePitches(60, 'major'));
    expect(chordPitches(60, 'not-a-chord')).toEqual(chordPitches(60, 'major'));
  });

  it('clamps into 0..127 and never repeats a pitch', () => {
    const high = scalePitches(126, 'major');
    expect(high.every((note) => note >= 0 && note <= MAX_MIDI)).toBe(true);
    expect(new Set(high).size).toBe(high.length);
    const low = scalePitches(1, 'major', 3);
    expect(low.every((note) => note >= 0 && note <= MAX_MIDI)).toBe(true);
    expect(new Set(low).size).toBe(low.length);
  });

  it('names pitches the way the keyboard does', () => {
    expect(pitchName(60)).toBe('C4');
    expect(pitchName(61)).toBe('C#4');
    expect(pitchName(48)).toBe('C3');
    expect(pitchName(0)).toBe('C-1');
  });

  it('offers every set with at least three tones', () => {
    for (const set of [...SCALES, ...CHORDS]) {
      expect(set.semitones[0], `${set.id} must start on the root`).toBe(0);
      expect(set.semitones.length, `${set.id} is too small`).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < set.semitones.length; i += 1) {
        expect(set.semitones[i], `${set.id} is not ascending`).toBeGreaterThan(set.semitones[i - 1]);
      }
    }
  });

  it('has both languages for every set id', () => {
    // The UI builds these keys at runtime, so the i18n source walker cannot see
    // them: this is the guard that a new scale cannot ship as a key name.
    for (const set of SCALES) expect(TEACH_STRINGS[`teach.scale.${set.id}`], set.id).toHaveLength(2);
    for (const set of CHORDS) expect(TEACH_STRINGS[`teach.chord.${set.id}`], set.id).toHaveLength(2);
  });
});

describe('buildExercise', () => {
  it('lays a scale out as one note per beat, with the seconds onsets', () => {
    const target = buildExercise({ kind: 'scale', root: 60, id: 'major', octaves: 1, bpm: 120 });
    expect(target.expected).toBe(8);
    expect(target.pitches).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(target.steps.map((step) => step.onset)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(target.steps.every((step) => step.pitches.length === 1)).toBe(true);
    expect(target.steps[3].pitches).toEqual([65]);
  });

  it('turns a chord into an ascending arpeggio', () => {
    const target = buildExercise({ kind: 'chord', root: 60, id: 'major', octaves: 1, bpm: 60 });
    expect(target.steps.map((step) => step.pitches[0])).toEqual([60, 64, 67, 72]);
    expect(target.steps.map((step) => step.onset)).toEqual([0, 1, 2, 3]);
  });

  it('uses 4/4-ish whole-number onsets at 90 bpm', () => {
    const target = buildExercise({ kind: 'scale', root: 48, id: 'major', bpm: 90 });
    expect(target.steps[1].onset).toBeCloseTo(60 / 90, 10);
    expect(target.bpm).toBe(90);
    expect(target.root).toBe(48);
  });

  it('clamps the tempo and the octave span', () => {
    expect(buildExercise({ kind: 'scale', root: 60, id: 'major', bpm: 5000 }).bpm).toBe(400);
    expect(buildExercise({ kind: 'scale', root: 60, id: 'major', bpm: 0 }).bpm).toBe(20);
    expect(buildExercise({ kind: 'scale', root: 60, id: 'major', octaves: 9 }).octaves).toBe(3);
    expect(buildExercise({ kind: 'scale', root: 60, id: 'major', octaves: 0 }).octaves).toBe(1);
  });

  it('is deterministic', () => {
    const once = buildExercise({ kind: 'scale', root: 60, id: 'blues', octaves: 2, bpm: 100 });
    const twice = buildExercise({ kind: 'scale', root: 60, id: 'blues', octaves: 2, bpm: 100 });
    expect(once).toEqual(twice);
  });
});
