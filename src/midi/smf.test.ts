import { describe, expect, it } from 'vitest';
import { notesDuration, parseMidi, writeMidi, type MidiNote } from './smf';

function buildMidi(): Uint8Array {
  const track = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 120 BPM
    0x00, 0x90, 0x3c, 0x64, // C4 on
    0x83, 0x60, 0x80, 0x3c, 0x40, // delta 480, C4 off
    0x00, 0x90, 0x40, 0x50, // E4 on
    0x83, 0x60, 0x90, 0x40, 0x00, // delta 480, E4 off (note-on vel 0)
    0x00, 0xff, 0x2f, 0x00,
  ];
  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0, 0, 1, 0x01, 0xe0,
  ];
  const len = track.length;
  return new Uint8Array([
    ...header,
    0x4d, 0x54, 0x72, 0x6b,
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
    ...track,
  ]);
}

describe('SMF parser', () => {
  it('parses tempo, notes and note-off velocity 0', () => {
    const song = parseMidi(buildMidi(), 'test');
    expect(song.bpm).toBe(120);
    expect(song.notes).toHaveLength(2);
    const c4 = song.notes.find((n) => n.note === 60)!;
    expect(c4.start).toBeCloseTo(0, 5);
    expect(c4.duration).toBeCloseTo(0.5, 3);
    expect(c4.velocity).toBeCloseTo(100 / 127, 5);
    const e4 = song.notes.find((n) => n.note === 64)!;
    expect(e4.start).toBeCloseTo(0.5, 3);
    expect(song.duration).toBeGreaterThanOrEqual(1);
  });

  it('rejects non-MIDI input', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe('SMF writer', () => {
  it('round-trips a note list', () => {
    const notes: MidiNote[] = [
      { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
      { note: 64, velocity: 0.7, start: 0.5, duration: 0.5 },
      { note: 67, velocity: 0.9, start: 1, duration: 1 },
    ];
    const bytes = writeMidi(notes, { bpm: 120, name: 'test' });
    const song = parseMidi(bytes, 'roundtrip');
    expect(song.name).toBe('test');
    expect(song.bpm).toBe(120);
    expect(song.notes.map((n) => n.note)).toEqual([60, 64, 67]);
    for (const original of notes) {
      const parsed = song.notes.find((n) => n.note === original.note)!;
      expect(parsed.start).toBeCloseTo(original.start, 2);
      expect(parsed.duration).toBeCloseTo(original.duration, 2);
    }
    expect(notesDuration(song.notes)).toBeCloseTo(2, 1);
  });

  it('clamps out-of-range notes and velocities', () => {
    const bytes = writeMidi([{ note: 999, velocity: 5, start: 0, duration: 0.2 }]);
    const song = parseMidi(bytes);
    expect(song.notes[0].note).toBe(127);
    expect(song.notes[0].velocity).toBe(1);
  });
});
