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

  it('writes a layered song as format 1 and reads its tracks back', () => {
    const layered = {
      name: 'Round Trip',
      bpm: 100,
      duration: 2,
      notes: [
        { note: 48, velocity: 0.8, start: 0, duration: 0.5 },
        { note: 60, velocity: 0.8, start: 0.5, duration: 0.5 },
      ],
      tracks: [
        { name: 'Bass', notes: [{ note: 48, velocity: 0.8, start: 0, duration: 0.5 }] },
        { name: 'Lead', notes: [{ note: 60, velocity: 0.8, start: 0.5, duration: 0.5 }] },
      ],
    };
    const bytes = writeMidi(layered.notes, {
      bpm: layered.bpm,
      name: layered.name,
      tracks: layered.tracks,
    });
    // Format 1, three tracks: conductor + two layers.
    expect(bytes[8]).toBe(0);
    expect(bytes[9]).toBe(1);
    expect((bytes[10] << 8) | bytes[11]).toBe(3);

    const back = parseMidi(bytes, 'round-trip');
    expect(songTracks(back).map((layer) => layer.name)).toEqual(['Bass', 'Lead']);
    expect(songTracks(back)[0].notes.map((note) => note.note)).toEqual([48]);
    expect(songTracks(back)[1].notes.map((note) => note.note)).toEqual([60]);
    expect(back.notes).toHaveLength(2);

    // A single-layer song stays format 0 with one track.
    const plain = writeMidi(layered.tracks[0].notes, { bpm: 100, name: 'One' });
    expect(plain[8]).toBe(0);
    expect(plain[9]).toBe(0);
    expect((plain[10] << 8) | plain[11]).toBe(1);
  });

  it('writes a layer\'s pan as CC10 at the head of its track', () => {
    const notes = [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }];
    const bytes = writeMidi(notes, {
      bpm: 120,
      name: 'Panned',
      tracks: [
        { name: 'Left', notes, pan: -1 },
        { name: 'Right', notes, pan: 0.5 },
        { name: 'Centre', notes },
      ],
    });
    // Both panned layers carry a controller, the centred one does not.
    const cc = (byte: number) => byte === 10;
    const events = [...bytes];
    expect(events.filter((b, i) => b === 0xb0 && cc(events[i + 1])).length).toBe(2);
    // Hard left is 0, +0.5 is three quarters right (round(0.75 * 127) = 95).
    const pans = events
      .map((b, i) => (b === 0xb0 && cc(events[i + 1]) ? events[i + 2] : null))
      .filter((v): v is number => v !== null);
    expect(pans).toEqual([0, 95]);

    // The controller does not disturb the round trip.
    const back = parseMidi(bytes, 'panned');
    expect(songTracks(back).map((layer) => layer.name)).toEqual(['Left', 'Right', 'Centre']);
    expect(songTracks(back)[0].notes.map((n) => n.note)).toEqual([60]);
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

/**
 * Corrupt files, kept as the minimal samples the parser fuzzer found.
 *
 * A MIDI file arrives from a download folder or a chat client, so none of these
 * may throw, hang, or hand the player a value it cannot use.
 */
describe('parseMidi on corrupt files', () => {
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const chunk = (body: number[], declared = body.length) => [
    0x4d, 0x54, 0x72, 0x6b,
    (declared >>> 24) & 0xff, (declared >>> 16) & 0xff, (declared >>> 8) & 0xff, declared & 0xff,
    ...body,
  ];

  it('salvages a track whose text event claims more bytes than the file holds', () => {
    // `FF 03 7F …` promises 127 name bytes and the file ends after three.
    const bytes = Uint8Array.from([...header, ...chunk([0x00, 0xff, 0x03, 0x7f, 0x61, 0x62, 0x63])]);
    const song = parseMidi(bytes, 'truncated');
    expect(song.notes).toEqual([]);
    expect(song.duration).toBeGreaterThan(0);
  });

  it('salvages a track that claims to be longer than the file', () => {
    const bytes = Uint8Array.from([...header, ...chunk([0x00, 0x90, 0x3c, 0x64], 0x7fffffff)]);
    expect(() => parseMidi(bytes, 'lying')).not.toThrow();
  });

  it('keeps note numbers and velocities inside MIDI range', () => {
    // Data bytes of 0xff are not legal, and 255/127 would be a velocity of 2.
    const bytes = Uint8Array.from([...header, ...chunk([0x00, 0x90, 0xff, 0xff, 0x00, 0x80, 0xff, 0x00])]);
    const song = parseMidi(bytes, 'loud');
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0].note).toBe(127);
    expect(song.notes[0].velocity).toBeLessThanOrEqual(1);
  });

  it('ignores a tempo of zero instead of reporting an infinite BPM', () => {
    const bytes = Uint8Array.from([...header, ...chunk([0x00, 0xff, 0x51, 0x03, 0, 0, 0, 0x00, 0xff, 0x2f, 0x00])]);
    const song = parseMidi(bytes, 'zero-tempo');
    expect(Number.isFinite(song.bpm)).toBe(true);
    expect(song.bpm).toBe(120);
  });

  it('does not allocate per claimed track: 65 535 of them, on 50 bytes', () => {
    const lying = singleTrackFile();
    lying[10] = 0xff;
    lying[11] = 0xff;
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) parseMidi(lying, 'many');
    // The eager version allocated a list per *claimed* track and needed ~5 s
    // for this loop; the sparse version needs a few milliseconds, so the bound
    // is wide enough to survive a busy host and still catch the regression.
    expect(performance.now() - started).toBeLessThan(1000);
    expect(songTracks(parseMidi(lying, 'many'))).toHaveLength(1);
  });
});
