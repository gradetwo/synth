import { describe, expect, it } from 'vitest';
import { notesDuration, parseMidi, songTracks, writeMidi, type MidiNote } from './smf';

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

describe('multi-track files', () => {
  /** A format-1 file: a conductor track plus two named note tracks. */
  function format1(): Uint8Array {
    const track = (bytes: number[]) =>
      [0x4d, 0x54, 0x72, 0x6b, (bytes.length >> 24) & 255, (bytes.length >> 16) & 255, (bytes.length >> 8) & 255, bytes.length & 255, ...bytes];
    const name = (text: string) => [0x00, 0xff, 0x03, text.length, ...Array.from(text).map((c) => c.charCodeAt(0))];
    const conductor = [
      ...name('Conductor'),
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 120 BPM
      0x00, 0xff, 0x2f, 0x00,
    ];
    const bass = [
      ...name('Bass'),
      0x00, 0x90, 0x30, 0x64,
      0x83, 0x60, 0x80, 0x30, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const lead = [
      ...name('Lead'),
      0x00, 0x90, 0x3c, 0x50,
      0x83, 0x60, 0x80, 0x3c, 0x40,
      0x00, 0x90, 0x40, 0x50,
      0x83, 0x60, 0x80, 0x40, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, 0x01, 0xe0];
    return Uint8Array.from([...header, ...track(conductor), ...track(bass), ...track(lead)]);
  }

  it('keeps each file track as a layer, in order, with its notes', () => {
    const song = parseMidi(format1(), 'two-tracks');
    expect(song.tracks).toBeDefined();
    const layers = songTracks(song);
    // The conductor track carries no notes, so it is not a layer.
    expect(layers.map((layer) => layer.name)).toEqual(['Bass', 'Lead']);
    expect(layers[0].notes.map((note) => note.note)).toEqual([48]);
    expect(layers[1].notes.map((note) => note.note)).toEqual([60, 64]);
    // The merged list is still there for the piano roll, and holds everything.
    expect(song.notes).toHaveLength(3);
    expect(song.notes.map((note) => note.note)).toEqual([48, 60, 64]);
  });

  it('gives a hand-built song exactly one layer', () => {
    const song = parseMidi(singleTrackFile(), 'one');
    expect(songTracks(song)).toHaveLength(1);
    expect(songTracks(song)[0].notes).toEqual(song.notes);
  });
});

/** The smallest format-0 file: one note. */
function singleTrackFile(): Uint8Array {
  const track = [0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const chunk = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track];
  return Uint8Array.from([...header, ...chunk]);
}
