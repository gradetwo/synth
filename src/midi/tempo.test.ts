import { describe, expect, it } from 'vitest';
import { parseMidi, writeMidi, type MidiNote } from './smf';
import {
  MAX_TEMPO_SEGMENTS,
  barBeatAt,
  beatsToSeconds,
  defaultMap,
  gridStepAt,
  normalizeTempoMap,
  secondsToBeats,
  segmentAtBeat,
  tempoMapOf,
  withTempoMap,
} from './tempo';

/** Two tempos: 8 beats at 120, then 3/4 at 60 for the rest. */
const map = [
  { bpm: 120, beats: 8, beatsPerBar: 4 },
  { bpm: 60, beats: Number.POSITIVE_INFINITY, beatsPerBar: 3 },
];

const song = (extra: Partial<Parameters<typeof tempoMapOf>[0]> = {}) => ({
  name: 'tempo',
  bpm: 120,
  duration: 1,
  notes: [],
  ...extra,
});

describe('tempo map', () => {
  it('converts beats to seconds exactly across a boundary', () => {
    // 120 BPM: a beat is half a second, so the change lands on beat 8 = 4 s.
    expect(beatsToSeconds(map, 0)).toBeCloseTo(0, 6);
    expect(beatsToSeconds(map, 7)).toBeCloseTo(3.5, 6);
    expect(beatsToSeconds(map, 8)).toBeCloseTo(4, 6);
    // Then one beat per second.
    expect(beatsToSeconds(map, 9)).toBeCloseTo(5, 6);
    expect(beatsToSeconds(map, 12)).toBeCloseTo(8, 6);
    // …and back, to within a millisecond, which is the bar for this batch.
    for (const beat of [0, 1, 7, 8, 8.5, 9, 12, 100]) {
      const seconds = beatsToSeconds(map, beat);
      expect(Math.abs(secondsToBeats(map, seconds) - beat) * 1000).toBeLessThan(1);
    }
  });

  it('finds the segment a beat falls in', () => {
    expect(segmentAtBeat(map, 0).index).toBe(0);
    expect(segmentAtBeat(map, 7.999).index).toBe(0);
    expect(segmentAtBeat(map, 8).index).toBe(1);
    expect(segmentAtBeat(map, 8).startBeat).toBe(8);
    expect(segmentAtBeat(map, 100).segment.bpm).toBe(60);
  });

  it('counts bars from the start but restarts the pattern with a new signature', () => {
    expect(barBeatAt(map, 0)).toMatchObject({ bar: 1, beat: 1, beatsPerBar: 4 });
    expect(barBeatAt(map, 4)).toMatchObject({ bar: 2, beat: 1, beatsPerBar: 4 });
    expect(barBeatAt(map, 6)).toMatchObject({ bar: 2, beat: 3, beatsPerBar: 4 });
    // Two 4/4 bars, then 3/4: beat 8 starts bar 3, and beat 11 starts bar 4.
    expect(barBeatAt(map, 8)).toMatchObject({ bar: 3, beat: 1, beatsPerBar: 3 });
    expect(barBeatAt(map, 10)).toMatchObject({ bar: 3, beat: 3, beatsPerBar: 3 });
    expect(barBeatAt(map, 11)).toMatchObject({ bar: 4, beat: 1, beatsPerBar: 3 });
  });

  it('makes the grid follow the time signature', () => {
    // A sixteenth is a sixteenth wherever it is…
    expect(gridStepAt(map, 0, 0.25)).toBe(0.25);
    expect(gridStepAt(map, 9, 0.25)).toBe(0.25);
    // …but a *bar* is four beats in 4/4 and three in 3/4.
    expect(gridStepAt(map, 0, 4)).toBe(4);
    expect(gridStepAt(map, 9, 4)).toBe(3);
  });

  it('falls back to one segment for a song that has no map', () => {
    expect(tempoMapOf(song())).toEqual(defaultMap(120));
    expect(tempoMapOf(song({ tempoMap: map }))).toBe(map);
    expect(tempoMapOf(null)).toHaveLength(1);
    const moved = withTempoMap(song(), map);
    expect(moved.bpm).toBe(120);
    expect(moved.beatsPerBar).toBe(4);
    expect(moved.tempoMap).toHaveLength(2);
  });

  it('reads a stored map without trusting it', () => {
    const junk = [
      null,
      'nope',
      { bpm: 'fast' },
      { bpm: 0, beats: -1, beatsPerBar: 99 },
      { bpm: 9999, beats: Number.NaN, beatsPerBar: 0 },
    ];
    const clean = normalizeTempoMap(junk);
    expect(clean).toHaveLength(2);
    expect(clean[0].bpm).toBe(20); // clamped up
    expect(clean[1].bpm).toBe(300); // clamped down
    expect(clean[0].beats).toBe(Number.POSITIVE_INFINITY);
    expect(clean[0].beatsPerBar).toBe(16);
    expect(clean[1].beatsPerBar).toBe(1);
    expect(normalizeTempoMap([])).toEqual(defaultMap(120));
    const many = Array.from({ length: 200 }, () => ({ bpm: 100, beats: 4, beatsPerBar: 4 }));
    expect(normalizeTempoMap(many).length).toBe(MAX_TEMPO_SEGMENTS);
  });
});

describe('the tempo map travels in the file', () => {
  const notes = (): MidiNote[] => [
    { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
    { note: 62, velocity: 0.8, start: 4.5, duration: 0.5 },
    { note: 64, velocity: 0.8, start: 9, duration: 0.5 },
  ];

  it('round-trips a tempo change and a 3/4 section through our own parser', () => {
    const written = writeMidi(notes(), { bpm: 120, tempoMap: map, beatsPerBar: 4, name: 'map' });
    const back = parseMidi(written, 'map');
    expect(back.tempoMap).toBeDefined();
    expect(back.tempoMap).toHaveLength(2);
    // The first segment is eight beats at 120…
    expect(back.tempoMap![0]).toMatchObject({ bpm: 120, beatsPerBar: 4 });
    expect(back.tempoMap![0].beats).toBeCloseTo(8, 2);
    // …and the second runs to the end at 60 in 3/4.
    expect(back.tempoMap![1].bpm).toBe(60);
    expect(back.tempoMap![1].beatsPerBar).toBe(3);
    expect(back.beatsPerBar).toBe(4);
    // The flat BPM every other reader uses is the first segment's.
    expect(back.bpm).toBe(120);
    // The notes land where they were, within a millisecond.
    const starts = back.notes.map((note) => note.start);
    for (const [i, want] of [0, 4.5, 9].entries()) {
      expect(Math.abs((starts[i] ?? -1) - want) * 1000).toBeLessThan(1);
    }
    // The header tempo is the one the map starts with, not a stale single BPM.
    const us = 60_000_000 / 120;
    expect([...written].join(',')).toContain([0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff].join(','));
  });

  it('leaves a song of one tempo exactly as it was', () => {
    // The import path is unchanged for the common case: no map is invented, and
    // the file carries no time-signature event at all.
    const written = writeMidi(notes(), { bpm: 100, name: 'plain' });
    const back = parseMidi(written, 'plain');
    expect(back.tempoMap).toBeUndefined();
    expect(back.bpm).toBe(100);
    expect(back.beatsPerBar).toBe(4);
    const section = back.notes.filter((note) => note.start > 2 && note.start < 6);
    expect(section).toHaveLength(1);
  });
});
