/**
 * Built-in demo playlist.
 *
 * Every entry is authored with a tiny score helper: a compact note string for
 * the melody (`"e5/0.5 d#5/0.5 r/1 [c4,e4,g4]/2"`) plus chord-symbol
 * accompaniment patterns. Public-domain works (Beethoven, Pachelbel, Mozart,
 * Chinese folk) are arranged in full with intro, repeats, a variation and a
 * coda; the modern film/game themes stay as recognisable demonstration
 * excerpts because the rights remain with their owners.
 */

import type { MidiNote, MidiSong } from './smf';

export interface SongSpec {
  id: string;
  title: [zh: string, en: string];
  composer: string;
  bpm: number;
  steps: [string, number, number, number?][];
}

const SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export function midiOf(name: string): number {
  const trimmed = name.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(trimmed);
  if (!match) throw new Error(`bad note name: ${name}`);
  const base = SEMITONES[match[1].toUpperCase()];
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return base + accidental + (Number(match[3]) + 1) * 12;
}

export function specToSong(spec: SongSpec): MidiSong {
  const secondsPerBeat = 60 / spec.bpm;
  const notes: MidiNote[] = spec.steps.map(([name, start, length, velocity]) => ({
    note: midiOf(name),
    velocity: velocity ?? 0.85,
    start: start * secondsPerBeat,
    duration: Math.max(0.03, length * secondsPerBeat * 0.92),
  }));
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  let duration = 0;
  for (const n of notes) duration = Math.max(duration, n.start + n.duration);
  return {
    name: spec.title[1],
    bpm: spec.bpm,
    duration: duration + 0.6,
    notes,
  };
}

// ------------------------------------------------------------------ score DSL

type Step = [string, number, number, number?];

const CHORD_SHAPES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14],
  m9: [0, 3, 7, 10, 14],
  '9': [0, 4, 7, 10, 14],
};

/** How the left hand plays a chord. */
type Pattern = 'block' | 'broken' | 'alberti' | 'waltz' | 'pulse' | 'stride' | 'harp';

const pitchClass = (name: string): number => {
  const match = /^([A-Ga-g])([#b]?)/.exec(name);
  if (!match) throw new Error(`bad chord: ${name}`);
  const base = SEMITONES[match[1].toUpperCase()];
  return (((base + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)) % 12) + 12) % 12;
};

/** Absolute MIDI notes for a chord symbol, root sitting in `octave`. */
function chordTones(symbol: string, octave: number): number[] {
  const [main, bassName] = symbol.split('/');
  const match = /^([A-G][#b]?)(.*)$/.exec(main);
  if (!match) throw new Error(`bad chord: ${symbol}`);
  const base = (octave + 1) * 12 + pitchClass(match[1]);
  const shape = CHORD_SHAPES[match[2]] ?? CHORD_SHAPES[''];
  const tones = shape.map((interval) => base + interval);
  if (bassName) tones.unshift(octave * 12 + pitchClass(bassName));
  return tones;
}

/** Accumulates notes in beats; every song is authored through one of these. */
class Score {
  readonly steps: Step[] = [];
  constructor(readonly bpm: number) {}

  note(name: string | number, at: number, length: number, velocity = 0.85): void {
    if (length <= 0) return;
    const midi = typeof name === 'number' ? name : midiOf(name);
    this.steps.push([String(midi), at, length, velocity]);
  }

  chord(names: (string | number)[], at: number, length: number, velocity = 0.85): void {
    for (const name of names) this.note(name, at, length, velocity);
  }

  /**
   * Play a melody string starting at `at`. Tokens are `name/beats`,
   * `name` (one beat), `r/beats` for a rest and `[a,b,c]/beats` for a chord.
   * Returns the beat after the last token.
   */
  line(text: string, at: number, opts: { octave?: number; vel?: number } = {}): number {
    let cursor = at;
    for (const raw of text.split(/\s+/)) {
      if (!raw || raw === '|') continue;
      const [head, lenText] = raw.split('/');
      const length = lenText ? Number(lenText) : 1;
      if (head === 'r') {
        cursor += length;
        continue;
      }
      const names = head.startsWith('[') ? head.slice(1, -1).split(',') : [head];
      for (const name of names) {
        const midi = midiOf(name.trim()) + (opts.octave ?? 0) * 12;
        this.note(midi, cursor, length * 0.95, opts.vel ?? 0.85);
      }
      cursor += length;
    }
    return cursor;
  }

  /** Comp one chord symbol per `per` beats. Returns the beat after the last. */
  chords(
    symbols: string[],
    at: number,
    opts: { per?: number; pattern?: Pattern; octave?: number; vel?: number } = {},
  ): number {
    const per = opts.per ?? 4;
    const pattern = opts.pattern ?? 'block';
    const octave = opts.octave ?? 3;
    const vel = opts.vel ?? 0.6;
    let cursor = at;
    for (const symbol of symbols) {
      this.voice(symbol, cursor, per, pattern, octave, vel);
      cursor += per;
    }
    return cursor;
  }

  /** Play one chord symbol with the given pattern (used by custom builders). */
  voice(
    symbol: string,
    at: number,
    beats: number,
    pattern: Pattern,
    octave: number,
    vel: number,
  ): void {
    const tones = chordTones(symbol, octave);
    const root = tones[0];
    const third = tones[1] ?? root + 4;
    const fifth = tones[2] ?? root + 7;
    const top = tones[3] ?? root + 12;
    switch (pattern) {
      case 'block':
        this.chord(tones, at, beats * 0.97, vel);
        break;
      case 'broken': {
        const cycle = [root - 12, fifth, root, third, fifth, root + 12, third, fifth];
        const step = beats / 8;
        cycle.forEach((midi, i) => this.note(midi, at + i * step, step * 0.9, vel));
        break;
      }
      case 'harp': {
        const cycle = [root - 12, fifth, third, top, third, fifth];
        const step = beats / 6;
        cycle.forEach((midi, i) => this.note(midi, at + i * step, step * 1.4, vel));
        break;
      }
      case 'alberti': {
        const cycle = [root - 12, fifth, third, fifth];
        const step = beats / 4;
        cycle.forEach((midi, i) => this.note(midi, at + i * step, step * 0.9, vel));
        break;
      }
      case 'waltz': {
        this.note(root - 12, at, (beats / 3) * 0.9, vel);
        this.chord([third, fifth, root + 12], at + beats / 3, (beats / 3) * 0.9, vel * 0.8);
        this.chord([third, fifth, root + 12], at + (2 * beats) / 3, (beats / 3) * 0.9, vel * 0.8);
        break;
      }
      case 'pulse': {
        const step = beats / 4;
        for (let i = 0; i < 4; i++) {
          this.chord([root - 12, third, fifth], at + i * step, step * 0.8, vel * (i === 0 ? 1 : 0.72));
        }
        break;
      }
      case 'stride': {
        const half = beats / 2;
        this.note(root - 12, at, half * 0.85, vel);
        this.chord([third, fifth, root + 12], at + half * 0.5, half * 0.4, vel * 0.8);
        this.note(root - 5, at + half, half * 0.85, vel);
        this.chord([third, fifth, root + 12], at + half * 1.5, half * 0.4, vel * 0.8);
        break;
      }
    }
  }

  /** Repeat a section builder, offsetting each pass. */
  repeat(times: number, start: number, build: (at: number, pass: number) => number): number {
    let cursor = start;
    for (let pass = 0; pass < times; pass++) cursor = build(cursor, pass);
    return cursor;
  }
}

/** Length of a melody string in beats (used to align accompaniment). */
const beatsOf = (text: string): number => new Score(120).line(text, 0);

const spec = (
  id: string,
  title: [string, string],
  composer: string,
  bpm: number,
  build: (s: Score) => void,
): SongSpec => {
  const score = new Score(bpm);
  build(score);
  return { id, title, composer, bpm, steps: score.steps };
};

// ------------------------------------------------------------------ exercises

/** C-major scale up and back down, three octaves with a contrary motion tag. */
function scaleExercise(): SongSpec {
  return spec('scale', ['音阶（练习）', 'Scales (practice)'], '—', 100, (s) => {
    const progression = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C'];
    let at = 0;
    for (let pass = 0; pass < 3; pass++) {
      for (const octave of [0, 1]) {
        at = s.line(
          'c4/0.5 d4/0.5 e4/0.5 f4/0.5 g4/0.5 a4/0.5 b4/0.5 c5/0.5 d5/0.5 e5/0.5 f5/0.5 g5/0.5 a5/0.5 b5/0.5 c6/1',
          at,
          { octave, vel: 0.8 },
        );
        at = s.line(
          'c6/0.5 b5/0.5 a5/0.5 g5/0.5 f5/0.5 e5/0.5 d5/0.5 c5/0.5 b4/0.5 a4/0.5 g4/0.5 f4/0.5 e4/0.5 d4/0.5 c4/1',
          at,
          { octave, vel: 0.78 },
        );
      }
      // Contrary-motion scale to close each pass.
      at = s.line('c4/0.5 e4/0.5 g4/0.5 c5/0.5 e5/0.5 g5/0.5 c6/1', at, { vel: 0.8 });
      s.chord(['c3', 'c4', 'e4', 'g4', 'c5'], at, 2, 0.7);
      at += 2;
    }
    // Left hand for the whole exercise, one chord per bar.
    const per = at / Math.ceil(at / 4) || 4;
    for (let cursor = 0, i = 0; cursor < at; cursor += per, i++) {
      s.voice(progression[i % progression.length], cursor, per * 0.97, 'alberti', 3, 0.42);
    }
  });
}

/** Arpeggios through the circle of fifths, both hands. */
function arpeggioExercise(): SongSpec {
  return spec('arpeggio', ['琶音（练习）', 'Arpeggios (practice)'], '—', 100, (s) => {
    const progression = ['C', 'Am', 'F', 'G', 'Em', 'Am', 'Dm', 'G7', 'C', 'F', 'G7', 'C'];
    s.chords(progression, 0, { per: 4, pattern: 'harp', vel: 0.5 });
    let at = 0;
    for (const symbol of progression) {
      const tones = chordTones(symbol, 4);
      const run = [tones[0], tones[1], tones[2], tones[0] + 12, tones[2], tones[1], tones[0]];
      run.forEach((midi, i) => s.note(midi, at + i * 0.5, 0.45, 0.8));
      at += 4;
      run.forEach((midi, i) => s.note(midi, at + i * 0.5, 0.45, 0.75));
      at += 4;
    }
    s.chord(chordTones('C', 3), at, 3, 0.7);
  });
}

// ------------------------------------------------------------------- melodies

/**
 * Für Elise — the complete A section (Beethoven), played plainly, then with
 * the melody an octave up over a fuller accompaniment, a composed C-major
 * bridge, and a final statement.
 */
function elise(): SongSpec {
  return spec('elise', ['致爱丽丝', 'Für Elise'], 'L. v. Beethoven', 112, (s) => {
    const theme =
      'e5/0.5 d#5/0.5 e5/0.5 d#5/0.5 e5/0.5 b4/0.5 d5/0.5 c5/0.5 a4/1 r/0.5 c4/0.5 e4/0.5 a4/0.5 b4/1 r/0.5 e4/0.5 g#4/0.5 b4/0.5 c5/1 r/0.5 e4/0.5 ' +
      'e5/0.5 d#5/0.5 e5/0.5 d#5/0.5 e5/0.5 b4/0.5 d5/0.5 c5/0.5 a4/1 r/0.5 c4/0.5 e4/0.5 a4/0.5 b4/1 r/0.5 e4/0.5 c5/0.5 b4/0.5 a4/2';
    const bridge =
      'c5/1 e5/1 g5/1 f5/1 e5/1 d5/1 c5/1 d5/1 ' +
      'b4/1 d5/1 f5/1 e5/1 d5/1 c5/1 b4/1 a4/1 ' +
      'c5/1 e5/1 a5/1 g5/1 f5/1 e5/1 d5/1 c5/1 ' +
      'b4/1 e5/1 g#5/1 b5/1 a5/1 g#5/1 e5/1 b4/1';
    const left = ['Am', 'Am', 'E7', 'Am', 'Am', 'E7', 'Am', 'Am', 'E7', 'Am', 'Am', 'E7'];

    const per = beatsOf(theme) / left.length;
    // Intro: two bars of the accompaniment alone.
    let at = s.chords(['Am', 'E7'], 0, { per: 4, pattern: 'broken', vel: 0.5 });
    // Theme, plain.
    s.chords(left, at, { per, pattern: 'broken', vel: 0.5 });
    at = s.line(theme, at, { vel: 0.88 });
    // Theme an octave up with a fuller left hand.
    s.chords(['Am', 'Am', 'E7', 'Am', 'Am', 'E7', 'Am', 'Am', 'E7', 'Am', 'Am', 'E7'], at, {
      per,
      pattern: 'alberti',
      vel: 0.58,
    });
    at = s.line(theme, at, { octave: 1, vel: 0.82 });
    // Composed C-major bridge (the traditional B section slot).
    s.chords(['C', 'G/B', 'Am', 'Em/G', 'F', 'C/E', 'Dm', 'E7', 'F', 'C/G', 'G7', 'C', 'E7', 'Am', 'E7', 'Am'], at, {
      per: 2,
      pattern: 'broken',
      vel: 0.55,
    });
    at = s.line(bridge, at, { vel: 0.8 });
    // Final statement, melody doubled an octave up, then a gentle coda.
    s.chords(['Am', 'Am', 'E7', 'Am', 'Am', 'E7', 'Am', 'Am', 'E7', 'Am', 'Am', 'E7'], at, {
      per,
      pattern: 'broken',
      vel: 0.55,
    });
    at = s.line(theme, at, { vel: 0.86 });
    s.line(theme, at, { octave: 1, vel: 0.5 });
    at += beatsOf(theme);
    s.chord(['a3', 'c4', 'e4', 'a4'], at, 4, 0.7);
  });
}

/**
 * Canon in D — Pachelbel's ground bass with layered variations, the traditional
 * way the piece is played at weddings.
 */
function canon(): SongSpec {
  return spec('canon', ['卡农', 'Canon in D'], 'J. Pachelbel', 88, (s) => {
    const ground = ['D', 'A', 'B', 'F#m', 'G', 'D', 'G', 'A'];
    const violin1 =
      'f#5/1 e5/1 d5/1 c#5/1 b4/1 a4/1 b4/1 c#5/1 d5/1 c#5/1 b4/1 a4/1 g4/1 f#4/1 g4/1 e4/1 d4/2';
    const violin2 =
      'a5/1 g5/1 f#5/1 e5/1 d5/1 c#5/1 d5/1 e5/1 f#5/1 e5/1 d5/1 c#5/1 b4/1 a4/1 b4/1 g4/1 f#4/2';
    const counter =
      'd5/0.5 e5/0.5 f#5/1 g5/0.5 f#5/0.5 e5/1 d5/0.5 c#5/0.5 b4/1 a4/0.5 b4/0.5 c#5/1 ' +
      'd5/0.5 e5/0.5 f#5/1 g5/0.5 a5/0.5 b5/1 a5/0.5 g5/0.5 f#5/1 e5/0.5 d5/0.5 c#5/1 d5/1';

    let at = 0;
    // Intro: ground alone, twice.
    at = s.repeat(2, at, (cursor) => s.chords(ground, cursor, { per: 2, pattern: 'block', vel: 0.5 }));
    // Violin 1 over the ground, twice.
    at = s.repeat(2, at, (cursor) => {
      s.chords(ground, cursor, { per: 2, pattern: 'broken', vel: 0.5 });
      return s.line(violin1, cursor, { vel: 0.86 });
    });
    // Violin 2 an octave up with a moving counter-line.
    at = s.repeat(2, at, (cursor) => {
      s.chords(ground, cursor, { per: 2, pattern: 'harp', vel: 0.52 });
      const end = s.line(violin2, cursor, { vel: 0.82 });
      s.line(counter, cursor, { vel: 0.6 });
      return end;
    });
    // Final statement: both violins and a sustained left hand.
    at = s.repeat(2, at, (cursor) => {
      s.chords(ground, cursor, { per: 2, pattern: 'block', vel: 0.55 });
      const end = s.line(violin1, cursor, { vel: 0.88 });
      s.line(violin2, cursor, { octave: -1, vel: 0.6 });
      return end;
    });
    s.chord(chordTones('D', 3), at, 4, 0.7);
  });
}

/**
 * Moonlight Sonata, first movement — the triplet arpeggio texture with the
 * melody on top, following the movement's opening harmony.
 */
function moonlight(): SongSpec {
  return spec('moonlight', ['月光奏鸣曲（第一乐章）', 'Moonlight Sonata (I)'], 'L. v. Beethoven', 52, (s) => {
    // One chord per bar (4 beats), the movement's opening progression.
    const bars = [
      'C#m', 'C#m', 'A', 'A', 'F#m', 'F#m', 'G#7', 'G#7',
      'C#m', 'C#m', 'A', 'A', 'F#m', 'G#7', 'C#m', 'C#m',
      'C#m', 'C#m', 'A', 'A', 'F#m', 'F#m', 'G#7', 'G#7',
      'C#m', 'C#m', 'A', 'A', 'F#m', 'G#7', 'C#m', 'C#m',
    ];
    const melody =
      'r/4 r/2 g#4/1 g#4/1 c#5/2 b4/1 a4/1 g#4/2 g#4/1 f#4/1 g#4/2 f#4/1 e4/1 ' +
      'd#4/2 d#4/1 c#4/1 c#4/2 c#4/1 d#4/1 e4/2 e4/1 f#4/1 g#4/2 g#4/1 a4/1 ' +
      'g#4/2 g#4/1 f#4/1 e4/2 d#4/1 c#4/1 c#4/2 c#4/1 d#4/1 e4/2 f#4/1 g#4/1 ' +
      'a4/2 g#4/1 f#4/1 e4/2 d#4/1 c#4/1 c#4/2 b#3/1 c#4/2 c#4/2';
    // Triplet arpeggios: 12 notes per bar.
    const triplet = (symbol: string, at: number, pass: number) => {
      const tones = chordTones(symbol, 3);
      const root = tones[0];
      const third = tones[1] ?? root + 3;
      const fifth = tones[2] ?? root + 7;
      const cycle = [root, fifth, third, root + 12, third, fifth];
      const step = 1 / 3;
      for (let i = 0; i < 12; i++) {
        const octaveLift = pass > 0 && i >= 6 ? 12 : 0;
        s.note(cycle[i % cycle.length] + octaveLift, at + i * step, step * 1.15, 0.42);
      }
    };
    let at = 0;
    for (const symbol of bars) {
      triplet(symbol, at, 0);
      at += 4;
    }
    s.line(melody, 0, { vel: 0.8 });
    // Second pass: melody an octave up, arpeggios with the upper octave.
    let second = at;
    bars.forEach((symbol) => {
      triplet(symbol, second, 1);
      second += 4;
    });
    s.line(melody, at, { octave: 1, vel: 0.72 });
    s.chord(chordTones('C#m', 3), second, 6, 0.6);
  });
}

/** Turkish March — the rondo theme, a C-major episode and the reprise. */
function turkish(): SongSpec {
  return spec('turkish', ['土耳其进行曲', 'Turkish March'], 'W. A. Mozart', 120, (s) => {
    const theme =
      'b4/0.5 a4/0.5 g#4/0.5 a4/0.5 c5/0.75 b4/0.25 a4/0.25 g#4/0.25 a4/0.25 e5/0.75 d5/0.25 c5/0.25 b4/0.25 ' +
      'c5/0.25 a4/0.5 c5/0.25 b4/0.25 a4/0.25 g#4/0.25 a4/0.5 c5/0.25 b4/0.25 a4/0.25 g#4/0.25 a4/1';
    const episode =
      'e5/0.5 f5/0.5 g5/0.5 a5/0.75 g5/0.25 f5/0.25 e5/0.25 d5/0.25 c5/0.75 b4/0.25 a4/0.25 b4/0.25 ' +
      'c5/0.5 d5/0.5 e5/0.5 f5/0.75 e5/0.25 d5/0.25 c5/0.25 b4/0.25 a4/0.75 g#4/0.25 a4/0.25 b4/0.25 c5/0.25 ' +
      'g5/0.5 a5/0.5 b5/0.5 c6/0.75 b5/0.25 a5/0.25 g5/0.25 f5/0.25 e5/0.75 d5/0.25 c5/0.25 d5/0.25 e5/0.25 ' +
      'f5/0.5 e5/0.5 d5/0.5 c5/0.75 b4/0.25 a4/0.25 b4/0.25 c5/0.25 d5/0.5 c5/0.5 b4/0.5 a4/1';
    const minor = ['Am', 'E7', 'Am', 'E7', 'Am', 'Dm', 'E7', 'Am'];
    const major = ['C', 'G7', 'C', 'G7', 'C', 'G7', 'C', 'G7', 'C', 'G7', 'C', 'G7', 'C', 'G7', 'C', 'G7'];
    const minorPer = beatsOf(theme) / minor.length;
    const majorPer = beatsOf(episode) / major.length;
    let at = 0;
    // Rondo: theme, episode, theme with the melody an octave up, episode an
    // octave up, then the theme again — the shape of the real march.
    at = s.repeat(2, at, (cursor) => {
      s.chords(minor, cursor, { per: minorPer, pattern: 'alberti', vel: 0.52 });
      return s.line(theme, cursor, { vel: 0.88 });
    });
    at = s.repeat(2, at, (cursor) => {
      s.chords(major, cursor, { per: majorPer, pattern: 'alberti', vel: 0.52 });
      return s.line(episode, cursor, { vel: 0.84 });
    });
    at = s.repeat(2, at, (cursor) => {
      s.chords(minor, cursor, { per: minorPer, pattern: 'alberti', vel: 0.56 });
      return s.line(theme, cursor, { octave: 1, vel: 0.82 });
    });
    at = s.repeat(2, at, (cursor) => {
      s.chords(major, cursor, { per: majorPer, pattern: 'alberti', vel: 0.54 });
      return s.line(episode, cursor, { octave: 1, vel: 0.78 });
    });
    // Reprise and cadence.
    s.chords(minor, at, { per: minorPer, pattern: 'alberti', vel: 0.56 });
    at = s.line(theme, at, { vel: 0.9 });
    s.chord(['a2', 'a3', 'c4', 'e4', 'a4'], at, 3, 0.72);
  });
}

/** Jasmine Flower — the complete folk tune, three verses with variations. */
function jasmine(): SongSpec {
  return spec('jasmine', ['茉莉花', 'Jasmine Flower'], 'Chinese folk', 84, (s) => {
    const verse1 =
      'e4/0.5 e4/0.5 g4/0.5 a4/0.5 c5/0.5 c5/0.5 a4/0.5 g4/0.5 g4/0.5 a4/0.5 g4/0.5 e4/0.5 d4/0.5 e4/0.5 g4/0.5 a4/1 ' +
      'c5/0.5 a4/0.5 g4/0.5 e4/0.5 g4/0.5 a4/0.5 c5/0.5 a4/0.5 g4/0.5 e4/0.5 d4/0.5 e4/0.5 g4/1 e4/1';
    const verse2 =
      'g4/0.5 g4/0.5 a4/0.5 c5/0.5 d5/0.5 c5/0.5 a4/0.5 g4/0.5 a4/0.5 c5/0.5 a4/0.5 g4/0.5 e4/0.5 g4/0.5 a4/0.5 c5/1 ' +
      'd5/0.5 c5/0.5 a4/0.5 g4/0.5 a4/0.5 g4/0.5 e4/0.5 d4/0.5 e4/0.5 g4/0.5 a4/0.5 g4/0.5 e4/1 d4/1';
    const refrain =
      'a4/0.5 c5/0.5 d5/0.5 e5/0.5 d5/0.5 c5/0.5 a4/0.5 c5/0.5 d5/1 c5/0.5 a4/0.5 g4/1 ' +
      'a4/0.5 g4/0.5 e4/0.5 g4/0.5 a4/0.5 c5/0.5 a4/0.5 g4/0.5 e4/1 d4/0.5 e4/0.5 g4/1';
    const chords = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C'];
    let at = 0;
    at = s.repeat(2, at, (cursor) => {
      s.chords(chords, cursor, { per: 2, pattern: 'broken', vel: 0.48 });
      let end = s.line(verse1, cursor, { vel: 0.86 });
      end = s.line(verse2, end, { vel: 0.86 });
      return end;
    });
    // Refrain, then a quiet close.
    s.chords(chords, at, { per: 2, pattern: 'broken', vel: 0.5 });
    at = s.line(refrain, at, { vel: 0.88 });
    s.chords(['C', 'F', 'G7', 'C'], at, { per: 2, pattern: 'block', vel: 0.5 });
    at = s.line(verse1, at, { octave: 1, vel: 0.78 });
    s.chord(['c3', 'c4', 'e4', 'g4', 'c5'], at, 4, 0.7);
  });
}

// ------------------------------------------------------- demonstration excerpts
// The modern film/game themes below are short, recognisable demonstrations; all
// rights remain with their owners. Each one gets a light accompaniment so it
// still feels finished, but they are deliberately not full arrangements.

const withAccompaniment = (
  id: string,
  title: [string, string],
  composer: string,
  bpm: number,
  melody: string,
  chords: string[],
  opts: { per?: number; pattern?: Pattern; octave?: number; vel?: number; passes?: number } = {},
): SongSpec =>
  spec(id, title, composer, bpm, (s) => {
    // The progression is stretched to cover exactly one melody pass, so the
    // harmony never runs past the phrase or starts late.
    const per = opts.per ?? beatsOf(melody) / chords.length;
    let at = 0;
    // Three statements — plain, an octave up, then with a fuller left hand —
    // so the excerpt feels finished without becoming a full arrangement.
    const passes: { octave: number; vel: number; comp: number }[] = [
      { octave: 0, vel: 0.88, comp: 0.42 },
      { octave: opts.octave ?? 1, vel: 0.78, comp: 0.5 },
      { octave: 0, vel: 0.82, comp: 0.54 },
      { octave: 0, vel: 0.84, comp: 0.5 },
      { octave: opts.octave ?? 1, vel: 0.76, comp: 0.56 },
    ].slice(0, opts.passes ?? 3);
    for (const pass of passes) {
      s.chords(chords, at, { per, pattern: opts.pattern ?? 'broken', vel: pass.comp });
      at = s.line(melody, at, { octave: pass.octave, vel: pass.vel });
    }
    s.chord(chordTones(chords[chords.length - 1].split('/')[0], 3), at, 3, 0.65);
  });

export const DEMO_SONGS: SongSpec[] = [
  elise(),
  canon(),
  moonlight(),
  withAccompaniment(
    'mariage',
    ['梦中的婚礼', "Mariage d'Amour"],
    'P. de Senneville',
    76,
    'e4/0.5 g4/0.5 b4/0.5 e5/0.5 d5/0.5 b4/0.5 g4/0.5 e4/0.5 a4/0.5 c5/0.5 e5/0.5 a5/0.5 g5/0.5 e5/0.5 c5/0.5 a4/0.5 ' +
      'f#4/0.5 a4/0.5 d5/0.5 f#5/0.5 e5/0.5 d5/0.5 b4/0.5 g4/0.5 e4/1 g4/1 b4/1 e5/1' +
      ' c5/0.5 b4/0.5 a4/0.5 g4/0.5 f#4/0.5 a4/0.5 d5/0.5 f#5/0.5 e5/1 d5/1 b4/0.5 a4/0.5 g4/0.5 b4/0.5 e5/1',
    ['Em', 'Am', 'D', 'G', 'Em', 'Am', 'B7', 'Em'],
    { per: 4, pattern: 'broken' },
  ),
  turkish(),
  withAccompaniment(
    'river',
    ['River Flows in You', 'River Flows in You'],
    'Yiruma',
    84,
    'a4/0.5 b4/0.5 c5/0.5 e5/0.5 d5/0.5 c5/0.5 b4/0.5 a4/0.5 g4/0.5 a4/0.5 b4/0.5 d5/0.5 c5/0.5 b4/0.5 a4/0.5 g4/0.5 ' +
      'f4/0.5 g4/0.5 a4/0.5 c5/0.5 b4/0.5 a4/0.5 g4/0.5 e4/0.5 a4/1 b4/1 c5/1 e5/1' +
      ' a4/0.5 c5/0.5 e5/0.5 d5/0.5 c5/0.5 b4/0.5 a4/0.5 g4/0.5 a4/1 c5/0.5 d5/0.5 e5/0.5 d5/0.5 c5/0.5 b4/1 a4/1',
    ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'Am'],
    { per: 4, pattern: 'broken' },
  ),
  withAccompaniment(
    'summer',
    ['Summer', 'Summer'],
    'Joe Hisaishi',
    104,
    'e5/0.5 g5/0.5 a5/0.5 g5/0.5 e5/0.5 d5/0.5 e5/1 d5/0.5 e5/0.5 g5/0.5 a5/0.5 c6/0.5 b5/0.5 a5/1 ' +
      'g5/0.5 e5/0.5 d5/0.5 e5/0.5 g5/1 a5/1 g5/1 e5/1' +
      ' c6/0.5 b5/0.5 a5/0.5 g5/0.5 e5/0.5 g5/0.5 a5/1 g5/0.5 e5/0.5 d5/0.5 c5/0.5 d5/1 e5/1 g5/1 e5/1',
    ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'C'],
    { per: 4, pattern: 'broken', passes: 4 },
  ),
  spec('croatian', ['克罗地亚狂想曲', 'Croatian Rhapsody'], 'Tonči Huljić', 138, (s) => {
    const riff = (root: string, at: number) => {
      const low = midiOf(`${root}3`);
      const pattern = [low, low + 7, low + 12, low + 7, low, low + 7, low + 12, low + 19];
      pattern.forEach((midi, i) => s.note(midi, at + i * 0.25, 0.22, 0.7));
    };
    const progression: [string, string][] = [
      ['E', 'Em'], ['D', 'D'], ['C', 'C'], ['B', 'B7'],
      ['E', 'Em'], ['D', 'D'], ['C', 'C'], ['B', 'B7'],
    ];
    const melody =
      'b4/0.25 e5/0.25 f#5/0.25 g5/0.25 f#5/0.25 e5/0.25 b4/0.5 a4/0.25 b4/0.25 c#5/0.25 d5/0.25 c#5/0.25 b4/0.25 a4/0.5 g#4/0.25 a4/0.25 b4/0.25 c5/0.25 b4/0.25 a4/0.25 g#4/0.5 f#4/0.25 g#4/0.25 a4/0.25 b4/0.25 a4/0.25 g#4/0.25 f#4/0.5 ' +
      'e5/0.25 f#5/0.25 g5/0.25 a5/0.25 g5/0.25 f#5/0.25 e5/0.5 d5/0.25 e5/0.25 f#5/0.25 g5/0.25 f#5/0.25 e5/0.25 d5/0.5 c5/0.25 d5/0.25 e5/0.25 f#5/0.25 e5/0.25 d5/0.25 c5/0.5 b4/1';
    let at = 0;
    at = s.repeat(2, at, (cursor) => {
      progression.forEach(([bass, symbol], i) => {
        riff(bass, cursor + i * 4);
        s.voice(symbol, cursor + i * 4, 4, 'block', 3, 0.4);
      });
      return cursor + progression.length * 4;
    });
    s.chords(['Em', 'D', 'C', 'B7', 'Em', 'D', 'C', 'B7'], at, { per: 4, pattern: 'pulse', vel: 0.5 });
    at = s.line(melody, at, { vel: 0.88 });
    at = s.repeat(2, at, (cursor) => {
      progression.forEach(([bass, symbol], i) => {
        riff(bass, cursor + i * 4);
        s.voice(symbol, cursor + i * 4, 4, 'block', 4, 0.4);
      });
      return cursor + progression.length * 4;
    });
    s.chord(chordTones('Em', 3), at, 4, 0.7);
  }),
  withAccompaniment(
    'castle',
    ['天空之城', 'Castle in the Sky'],
    'Joe Hisaishi',
    96,
    'a4/1 b4/0.5 c5/0.5 e5/0.5 d5/0.5 c5/0.5 b4/0.5 a4/1 e5/0.5 d5/0.5 c5/0.5 b4/0.5 c5/1 ' +
      'a4/1 c5/0.5 d5/0.5 e5/0.5 f5/0.5 e5/0.5 d5/0.5 c5/1 b4/0.5 c5/0.5 d5/1 c5/1' +
      ' e5/0.5 d5/0.5 c5/0.5 b4/0.5 a4/0.5 c5/0.5 b4/0.5 a4/0.5 g4/1 e4/1 g4/0.5 a4/0.5 b4/1 a4/1',
    ['Am', 'Em', 'F', 'C', 'Dm', 'Am', 'E7', 'Am'],
    { per: 4, pattern: 'broken', passes: 4 },
  ),
  spec('mario', ['超级玛丽主题曲', 'Super Mario theme'], 'Koji Kondo', 200, (s) => {
    const theme =
      'e5/0.25 e5/0.25 r/0.25 e5/0.25 r/0.25 c5/0.25 e5/0.25 r/0.25 g5/0.5 r/0.5 g4/0.5 r/0.5 ' +
      'c5/0.5 r/0.25 g4/0.25 r/0.25 e4/0.25 r/0.25 a4/0.25 b4/0.25 a#4/0.25 a4/0.25 r/0.25 g4/0.25 e5/0.25 g5/0.25 a5/0.25 r/0.25 f5/0.25 g5/0.25 r/0.25 e5/0.25 c5/0.25 d5/0.25 b4/0.5 r/0.25 ' +
      'c5/0.25 r/0.25 g4/0.25 r/0.25 e4/0.25 r/0.25 a4/0.25 b4/0.25 a#4/0.25 a4/0.25 r/0.25 g4/0.25 e5/0.25 g5/0.25 a5/0.25 r/0.25 f5/0.25 g5/0.25 r/0.25 e5/0.25 c5/0.25 d5/0.25 b4/0.5 r/0.5 ' +
      'e5/0.25 e5/0.25 r/0.25 e5/0.25 r/0.25 c5/0.25 e5/0.25 r/0.25 g5/0.5 r/0.5 g4/0.5 r/0.5 c5/0.5 r/0.25 g4/0.25 r/0.25 e4/0.25 r/0.25 a4/0.25 b4/0.25 a#4/0.25 a4/0.25 r/0.25 g4/0.25 e5/0.25 g5/0.25 a5/0.25 r/0.25 f5/0.25 g5/0.25 r/0.25 e5/0.25 c5/0.25 d5/0.25 b4/0.5 r/0.25 ' +
      'g5/0.25 f#5/0.25 f5/0.25 d#5/0.25 r/0.25 e5/0.25 r/0.25 g#4/0.25 a4/0.25 c5/0.25 r/0.25 a4/0.25 c5/0.25 d5/0.25 r/0.5 g5/0.25 f#5/0.25 f5/0.25 d#5/0.25 r/0.25 e5/0.25 r/0.25 c6/0.25 r/0.25 c6/0.25 c6/0.5 r/0.5';
    const chords = ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'G', 'C', 'G', 'C', 'G', 'C', 'G', 'C', 'G'];
    let at = 0;
    at = s.repeat(6, at, (cursor, pass) => {
      s.chords(chords, cursor, { per: 2, pattern: 'pulse', vel: 0.42 + (pass % 3) * 0.03 });
      return s.line(theme, cursor, { octave: pass % 2, vel: pass >= 4 ? 0.78 : 0.88 });
    });
    s.chord(['c3', 'c4', 'e4', 'g4', 'c5'], at, 2, 0.68);
  }),
  withAccompaniment(
    'got',
    ['权力的游戏主题曲', 'Game of Thrones theme'],
    'Ramin Djawadi',
    112,
    'c4/1 c4/0.5 c4/0.5 c4/1 d#4/0.5 d4/0.5 c4/1 a#3/0.5 c4/0.5 d#4/1 d4/0.5 c4/0.5 a#3/1 g#3/0.5 a#3/0.5 c4/2 ' +
      'g3/1 g3/0.5 g3/0.5 g3/1 a#3/0.5 a3/0.5 g3/1 f3/0.5 g3/0.5 a#3/1 a3/0.5 g3/0.5 f3/1 d#3/0.5 f3/0.5 g3/2' +
      ' c4/1 d#4/0.5 d4/0.5 c4/1 a#3/0.5 c4/0.5 d#4/1 f4/0.5 d#4/0.5 c4/1 a#3/0.5 g#3/0.5 a#3/2 c4/2',
    ['Cm', 'Ab', 'Eb', 'Bb', 'Cm', 'Ab', 'Fm', 'Gm'],
    { per: 4, pattern: 'block', vel: 0.42 },
  ),
  withAccompaniment(
    'butterfly',
    ['梁祝（选段）', 'Butterfly Lovers (excerpt)'],
    'He Zhanhao / Chen Gang',
    72,
    'g4/0.5 a4/0.5 b4/0.5 d5/0.75 c5/0.5 b4/0.5 a4/0.75 g4/0.5 e4/0.5 d4/0.75 e4/0.5 g4/0.5 a4/0.5 b4/1.5 ' +
      'd5/0.5 e5/0.5 d5/0.75 c5/0.5 b4/0.5 a4/0.75 g4/0.5 a4/0.5 b4/0.75 a4/0.5 g4/0.5 e4/1.5' +
      ' e5/0.5 d5/0.5 c5/0.5 b4/0.5 a4/0.5 g4/0.5 a4/0.5 b4/0.5 c5/1 b4/0.5 a4/0.5 g4/0.5 e4/0.5 d4/1 e4/1',
    ['G', 'Em', 'C', 'D', 'G', 'Em', 'Am', 'D'],
    { per: 4, pattern: 'broken' },
  ),
  withAccompaniment(
    'seashore',
    ['沧海一声笑', 'A Chinese Ghost Story theme'],
    'James Wong',
    92,
    'a4/1 g4/0.5 e4/0.5 d4/0.5 c4/0.5 a3/1 c4/0.5 d4/0.5 e4/1 g4/0.5 a4/0.5 c5/1.5 ' +
      'd5/0.5 c5/0.5 a4/0.5 g4/0.5 e4/0.5 g4/0.5 a4/0.5 c5/0.5 d5/1 c5/0.5 a4/0.5 g4/1.5' +
      ' a4/0.5 c5/0.5 d5/0.5 e5/0.5 d5/0.5 c5/0.5 a4/0.5 g4/0.5 a4/1 c5/0.5 a4/0.5 g4/0.5 e4/0.5 g4/1 a4/1',
    ['Am', 'C', 'G', 'Am', 'F', 'C', 'G', 'Am'],
    { per: 4, pattern: 'broken', passes: 4 },
  ),
  jasmine(),
  // ------------------------------------------------- well-known, fun, public domain
  withAccompaniment(
    'tetris',
    ['俄罗斯方块（主题）', 'Tetris (Korobeiniki)'],
    'Russian folk',
    138,
    'e5/0.5 b4/0.25 c5/0.25 d5/0.5 c5/0.25 b4/0.25 a4/0.5 a4/0.25 c5/0.25 e5/0.5 d5/0.25 c5/0.25 ' +
      'b4/0.75 c5/0.25 d5/0.5 e5/0.5 c5/0.5 a4/0.5 a4/0.5 ' +
      'd5/0.5 f5/0.25 a5/0.25 g5/0.5 f5/0.25 e5/0.25 c5/0.75 e5/0.25 d5/0.5 c5/0.5 b4/0.5 a4/1',
    ['Em', 'Em', 'Am', 'Em', 'Em', 'Am', 'B7', 'Em'],
    { per: 2, pattern: 'pulse', passes: 5 },
  ),
  withAccompaniment(
    'joy',
    ['欢乐颂', 'Ode to Joy'],
    'Beethoven',
    112,
    'e4/1 e4/1 f4/1 g4/1 g4/1 f4/1 e4/1 d4/1 c4/1 c4/1 d4/1 e4/1 e4/1.5 d4/0.5 d4/2 ' +
      'e4/1 e4/1 f4/1 g4/1 g4/1 f4/1 e4/1 d4/1 c4/1 c4/1 d4/1 e4/1 d4/1.5 c4/0.5 c4/2',
    ['C', 'C', 'G', 'C', 'F', 'C', 'G', 'C'],
    { per: 2, pattern: 'block', passes: 5 },
  ),
  withAccompaniment(
    'greensleeves',
    ['绿袖子', 'Greensleeves'],
    'Traditional English',
    96,
    'a4/1 c5/2 d5/1 e5/1.5 f5/0.5 e5/1 d5/2 b4/1 g4/1.5 a4/0.5 b4/1 c5/2 a4/1 a4/1.5 g#4/0.5 a4/1 b4/2 g#4/1 e4/2 ' +
      'a4/1 c5/2 d5/1 e5/1.5 f5/0.5 e5/1 d5/2 b4/1 g4/1.5 a4/0.5 b4/1 c5/1.5 b4/0.5 a4/1 g#4/1.5 a4/0.5 b4/1 g#4/1 e4/2',
    ['Am', 'Am', 'C', 'G', 'Am', 'E7', 'Am', 'Am'],
    { per: 3, pattern: 'broken', passes: 6 },
  ),
  withAccompaniment(
    'furelise-rock',
    ['致爱丽丝（八位机版）', 'Für Elise (8-bit)'],
    'Beethoven',
    140,
    'e5/0.5 d#5/0.5 e5/0.5 d#5/0.5 e5/0.5 b4/0.5 d5/0.5 c5/0.5 a4/1 ' +
      'c4/0.5 e4/0.5 a4/0.5 b4/1 e4/0.5 g#4/0.5 b4/0.5 c5/1 e4/1 ' +
      'e5/0.5 d#5/0.5 e5/0.5 d#5/0.5 e5/0.5 b4/0.5 d5/0.5 c5/0.5 a4/1 ' +
      'c4/0.5 e4/0.5 a4/0.5 b4/1 e4/0.5 c5/0.5 b4/0.5 a4/2',
    ['Am', 'E7', 'Am', 'E7', 'Am', 'E7', 'Am', 'Am'],
    { per: 2, pattern: 'pulse', passes: 5 },
  ),
  arpeggioExercise(),
  scaleExercise(),
];

export const DEMO_SONG_BY_ID = new Map(DEMO_SONGS.map((s) => [s.id, s]));

export function demoSong(id: string): MidiSong | null {
  const spec = DEMO_SONG_BY_ID.get(id);
  return spec ? specToSong(spec) : null;
}
