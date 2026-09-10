import { describe, expect, it } from 'vitest';
import type { MidiSong } from './smf';
import {
  addNote,
  clearNotes,
  fitBeats,
  isBlackKey,
  pitchRange,
  quantizeDoc,
  removeNote,
  resolveOverlaps,
  rollToSong,
  setBpm,
  setLengthBeats,
  songToRoll,
  snapBeat,
  transposeDoc,
  updateNote,
  type RollDoc,
} from './roll';

const song = (): MidiSong => ({
  name: 'test',
  bpm: 120,
  duration: 2.4,
  notes: [
    { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
    { note: 64, velocity: 0.6, start: 0.5, duration: 0.5 },
    { note: 67, velocity: 0.9, start: 1.5, duration: 1 },
  ],
});

const doc = (): RollDoc => songToRoll(song());

describe('piano-roll model', () => {
  it('converts seconds to beats and back at the song tempo', () => {
    const roll = doc();
    expect(roll.bpm).toBe(120);
    // 120 BPM → one beat is 0.5 s.
    expect(roll.notes.map((n) => n.start)).toEqual([0, 1, 3]);
    expect(roll.notes.map((n) => n.length)).toEqual([1, 1, 2]);
    expect(roll.beats).toBe(8); // 5 beats rounded up to a bar

    const back = rollToSong(roll);
    expect(back.bpm).toBe(120);
    expect(back.notes.map((n) => n.start)).toEqual([0, 0.5, 1.5]);
    expect(back.notes.map((n) => n.duration)).toEqual([0.5, 0.5, 1]);
    expect(back.notes.map((n) => n.note)).toEqual([60, 64, 67]);
  });

  it('keeps tempo changes in musical time', () => {
    const roll = setBpm(doc(), 60);
    // Same beats, twice as long in seconds.
    expect(rollToSong(roll).notes[2].start).toBe(3);
    expect(rollToSong(roll).duration).toBe(5.4);
    expect(setBpm(roll, 10_000).bpm).toBe(240);
    expect(setBpm(roll, 1).bpm).toBe(40);
  });

  it('snaps positions to the grid and never goes negative', () => {
    expect(snapBeat(0.3, 0.25)).toBe(0.25);
    expect(snapBeat(0.4, 0.25)).toBe(0.5);
    expect(snapBeat(-2, 0.25)).toBe(0);
    expect(snapBeat(1.26, 0.125)).toBe(1.25);
  });

  it('adds, moves, resizes and removes notes without mutating the input', () => {
    const base = doc();
    const { doc: withNote, id } = addNote(base, 72, 2.5, 0.5, 0.7);
    expect(base.notes).toHaveLength(3);
    expect(withNote.notes).toHaveLength(4);
    expect(withNote.notes.at(-1)).toMatchObject({ note: 72, start: 2.5, length: 0.5, velocity: 0.7 });

    const moved = updateNote(withNote, id, { start: 4, note: 71 });
    expect(moved.notes.at(-1)).toMatchObject({ start: 4, note: 71 });
    // Length is untouched by a move.
    expect(moved.notes.at(-1)!.length).toBe(0.5);

    const shorter = updateNote(moved, id, { length: 0.01 });
    expect(shorter.notes.at(-1)!.length).toBe(0.0625); // clamped to the minimum

    const gone = removeNote(shorter, id);
    expect(gone.notes).toHaveLength(3);
    expect(removeNote(gone, 'missing')).toBe(gone);
  });

  it('clamps pitches and velocities to the legal range', () => {
    const { doc: withNote, id } = addNote(doc(), 200, -3, -1, 5);
    const note = withNote.notes.at(-1)!;
    expect(note.note).toBe(127);
    expect(note.start).toBe(0);
    expect(note.length).toBe(0.0625);
    expect(note.velocity).toBe(1);

    const low = updateNote(withNote, id, { note: -40, velocity: -1 });
    expect(low.notes.at(-1)).toMatchObject({ note: 0, velocity: 0.05 });
  });

  it('quantizes starts and rounds lengths up to one step', () => {
    const messy: RollDoc = {
      name: 'q',
      bpm: 120,
      beats: 8,
      notes: [
        { id: 'a', note: 60, start: 0.31, length: 0.4, velocity: 0.8 },
        { id: 'b', note: 62, start: 1.62, length: 0.9, velocity: 0.8 },
      ],
    };
    const out = quantizeDoc(messy, 0.5);
    expect(out.notes[0]).toMatchObject({ start: 0.5, length: 0.5 });
    expect(out.notes[1]).toMatchObject({ start: 1.5, length: 1 });
    expect(quantizeDoc(messy, 0)).toBe(messy);
  });

  it('transposes as a block and stops at the range edges', () => {
    const roll = doc();
    expect(transposeDoc(roll, 12).notes.map((n) => n.note)).toEqual([72, 76, 79]);
    // A shift that would push a note past 127 only moves what fits.
    const high: RollDoc = {
      name: 'h',
      bpm: 120,
      beats: 4,
      notes: [
        { id: 'a', note: 120, start: 0, length: 1, velocity: 0.8 },
        { id: 'b', note: 100, start: 1, length: 1, velocity: 0.8 },
      ],
    };
    expect(transposeDoc(high, 12).notes.map((n) => n.note)).toEqual([127, 107]);
    expect(transposeDoc(roll, 0)).toBe(roll);
  });

  it('grows the clip for new notes and never shrinks below the notes', () => {
    const { doc: long } = addNote(doc(), 60, 20, 2);
    expect(long.beats).toBe(24);
    expect(setLengthBeats(long, 2).beats).toBe(24);
    expect(setLengthBeats(long, 40).beats).toBe(40);
    expect(setLengthBeats(long, 12.3).beats).toBe(24);
    expect(clearNotes(long).notes).toHaveLength(0);
    expect(fitBeats([])).toBe(4);
  });

  it('keeps one note per pitch lane, trimming what it covers', () => {
    const base: RollDoc = {
      name: 'o',
      bpm: 120,
      beats: 8,
      notes: [
        { id: 'a', note: 60, start: 0, length: 4, velocity: 0.8 },
        { id: 'b', note: 62, start: 0, length: 4, velocity: 0.8 },
      ],
    };
    // A new note inside the first one splits it in two.
    const split = resolveOverlaps(
      { ...base, notes: [...base.notes, { id: 'c', note: 60, start: 1, length: 1, velocity: 0.8 }] },
      'c',
    );
    const lane = split.notes.filter((n) => n.note === 60);
    expect(lane.map((n) => [n.start, n.length])).toEqual([
      [0, 1],
      [2, 2],
      [1, 1],
    ]);
    // A note that covers the whole of another removes it.
    const covered = resolveOverlaps(
      { ...base, notes: [...base.notes, { id: 'd', note: 60, start: 0, length: 6, velocity: 0.8 }] },
      'd',
    );
    expect(covered.notes.filter((n) => n.note === 60)).toHaveLength(1);
    // Other pitches are untouched, and a clear winner is a no-op.
    expect(covered.notes.filter((n) => n.note === 62)).toHaveLength(1);
    expect(resolveOverlaps(base, 'missing')).toBe(base);
  });

  it('reports a padded pitch window and the black-key pattern', () => {
    const [rollLow, rollHigh] = pitchRange(doc());
    expect(rollLow).toBe(45); // padded out to two octaves
    expect(rollHigh).toBe(69);
    const empty: RollDoc = { name: 'e', bpm: 120, beats: 4, notes: [] };
    const [low, high] = pitchRange(empty);
    expect(high - low).toBeGreaterThanOrEqual(24);
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(60)).toBe(false);
    expect(isBlackKey(66)).toBe(true);
  });
});
