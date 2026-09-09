/**
 * Built-in demo playlist.
 *
 * Each entry is a short, recognisable excerpt or exercise authored as compact
 * note steps `[name, startBeat, lengthBeat, velocity?]`. The modern film/game
 * themes are deliberately brief demonstrations; all rights remain with their
 * owners. Classical and folk pieces are public domain.
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
  const match = /^([A-G])(#|b)?(-?\d)$/.exec(trimmed);
  if (!match) throw new Error(`bad note name: ${name}`);
  const base = SEMITONES[match[1]];
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

// ------------------------------------------------------------------ exercises

/** C-major scale up and back down, two octaves. */
function scaleExercise(): SongSpec {
  const up = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
  const down = [...up].reverse().slice(1);
  const steps: [string, number, number][] = [];
  up.forEach((m, i) => steps.push([String(m), i * 0.5, 0.45]));
  down.forEach((m, i) => steps.push([String(m), (up.length + i) * 0.5, 0.45]));
  return { id: 'scale', title: ['音阶（练习）', 'Scales (practice)'], composer: '—', bpm: 100, steps };
}

/** C / Am / F / G arpeggios, up and down. */
function arpeggioExercise(): SongSpec {
  const chords = [
    [60, 64, 67, 72],
    [57, 60, 64, 69],
    [53, 57, 60, 65],
    [55, 59, 62, 67],
  ];
  const steps: [string, number, number][] = [];
  let beat = 0;
  for (const chord of chords) {
    for (const m of chord) {
      steps.push([String(m), beat, 0.45]);
      beat += 0.5;
    }
    for (const m of [...chord].reverse()) {
      steps.push([String(m), beat, 0.45]);
      beat += 0.5;
    }
  }
  return { id: 'arpeggio', title: ['琶音（练习）', 'Arpeggios (practice)'], composer: '—', bpm: 100, steps };
}

// ------------------------------------------------------------------ melodies

export const DEMO_SONGS: SongSpec[] = [
  {
    id: 'elise',
    title: ['致爱丽丝', 'Für Elise'],
    composer: 'L. v. Beethoven',
    bpm: 120,
    steps: [
      ['E5', 0, 0.5], ['D#5', 0.5, 0.5], ['E5', 1, 0.5], ['D#5', 1.5, 0.5],
      ['E5', 2, 0.5], ['B4', 2.5, 0.5], ['D5', 3, 0.5], ['C5', 3.5, 0.5],
      ['A4', 4, 1], ['C4', 5, 0.5], ['E4', 5.5, 0.5], ['A4', 6, 0.5],
      ['B4', 6.5, 1], ['E4', 7.5, 0.5], ['G#4', 8, 0.5], ['B4', 8.5, 0.5],
      ['C5', 9, 1], ['E4', 10, 0.5], ['E5', 10.5, 0.5], ['D#5', 11, 0.5],
      ['E5', 11.5, 0.5], ['D#5', 12, 0.5], ['E5', 12.5, 0.5], ['B4', 13, 0.5],
      ['D5', 13.5, 0.5], ['C5', 14, 0.5], ['A4', 14.5, 1],
    ],
  },
  {
    id: 'canon',
    title: ['卡农', 'Canon in D'],
    composer: 'J. Pachelbel',
    bpm: 92,
    steps: [
      ['F#5', 0, 0.9], ['E5', 1, 0.9], ['D5', 2, 0.9], ['C#5', 3, 0.9],
      ['B4', 4, 0.9], ['A4', 5, 0.9], ['B4', 6, 0.9], ['C#5', 7, 0.9],
      ['D5', 8, 0.9], ['C#5', 9, 0.9], ['B4', 10, 0.9], ['A4', 11, 0.9],
      ['G4', 12, 0.9], ['F#4', 13, 0.9], ['G4', 14, 0.9], ['E4', 15, 0.9],
      ['D4', 16, 1.8],
    ],
  },
  {
    id: 'moonlight',
    title: ['月光奏鸣曲（第一乐章）', 'Moonlight Sonata (I)'],
    composer: 'L. v. Beethoven',
    bpm: 54,
    steps: [
      ['G#3', 0, 0.5], ['C#4', 0.5, 0.5], ['E4', 1, 0.5],
      ['G#3', 1.5, 0.5], ['C#4', 2, 0.5], ['E4', 2.5, 0.5],
      ['G#3', 3, 0.5], ['C#4', 3.5, 0.5], ['E4', 4, 0.5],
      ['A3', 4.5, 0.5], ['C#4', 5, 0.5], ['E4', 5.5, 0.5],
      ['A3', 6, 0.5], ['D4', 6.5, 0.5], ['F#4', 7, 0.5],
      ['G#3', 7.5, 0.5], ['B#3', 8, 0.5], ['F#4', 8.5, 0.5],
      ['G#3', 9, 0.5], ['C#4', 9.5, 0.5], ['E4', 10, 0.5],
      ['G#3', 10.5, 0.5], ['C#4', 11, 0.5], ['D#4', 11.5, 0.5],
    ],
  },
  {
    id: 'mariage',
    title: ['梦中的婚礼', "Mariage d'Amour"],
    composer: 'P. de Senneville',
    bpm: 76,
    steps: [
      ['E4', 0, 0.5], ['G4', 0.5, 0.5], ['B4', 1, 0.5], ['E5', 1.5, 0.5],
      ['D5', 2, 0.5], ['B4', 2.5, 0.5], ['G4', 3, 0.5], ['E4', 3.5, 0.5],
      ['A4', 4, 0.5], ['C5', 4.5, 0.5], ['E5', 5, 0.5], ['A5', 5.5, 0.5],
      ['G5', 6, 0.5], ['E5', 6.5, 0.5], ['C5', 7, 0.5], ['A4', 7.5, 0.5],
      ['F#4', 8, 0.5], ['A4', 8.5, 0.5], ['D5', 9, 0.5], ['F#5', 9.5, 0.5],
      ['E5', 10, 0.5], ['D5', 10.5, 0.5], ['B4', 11, 0.5], ['G4', 11.5, 0.5],
      ['E4', 12, 1.6],
    ],
  },
  {
    id: 'turkish',
    title: ['土耳其进行曲', 'Turkish March'],
    composer: 'W. A. Mozart',
    bpm: 126,
    steps: [
      ['B4', 0, 0.35], ['A4', 0.5, 0.35], ['G#4', 1, 0.35], ['A4', 1.5, 0.35],
      ['C5', 2, 0.7], ['B4', 2.75, 0.35], ['A4', 3.25, 0.35], ['G#4', 3.75, 0.35],
      ['A4', 4.25, 0.35], ['E5', 4.75, 0.7], ['D5', 5.5, 0.35], ['C5', 6, 0.35],
      ['B4', 6.5, 0.35], ['C5', 7, 0.35], ['A4', 7.5, 0.9],
      ['E5', 8.5, 0.35], ['F5', 9, 0.35], ['G5', 9.5, 0.35], ['A5', 10, 0.7],
      ['G5', 10.75, 0.35], ['F5', 11.25, 0.35], ['E5', 11.75, 0.35], ['D5', 12.25, 0.35],
      ['C5', 12.75, 0.35], ['B4', 13.25, 0.35], ['A4', 13.75, 1],
    ],
  },
  {
    id: 'river',
    title: ['River Flows in You', 'River Flows in You'],
    composer: 'Yiruma',
    bpm: 84,
    steps: [
      ['A4', 0, 0.5], ['B4', 0.5, 0.5], ['C5', 1, 0.5], ['E5', 1.5, 0.5],
      ['D5', 2, 0.5], ['C5', 2.5, 0.5], ['B4', 3, 0.5], ['A4', 3.5, 0.5],
      ['G4', 4, 0.5], ['A4', 4.5, 0.5], ['B4', 5, 0.5], ['D5', 5.5, 0.5],
      ['C5', 6, 0.5], ['B4', 6.5, 0.5], ['A4', 7, 0.5], ['G4', 7.5, 0.5],
      ['F4', 8, 0.5], ['G4', 8.5, 0.5], ['A4', 9, 0.5], ['C5', 9.5, 0.5],
      ['B4', 10, 0.5], ['A4', 10.5, 0.5], ['G4', 11, 0.5], ['E4', 11.5, 1.4],
    ],
  },
  {
    id: 'summer',
    title: ['Summer', 'Summer'],
    composer: 'Joe Hisaishi',
    bpm: 104,
    steps: [
      ['E5', 0, 0.5], ['G5', 0.5, 0.5], ['A5', 1, 0.5], ['G5', 1.5, 0.5],
      ['E5', 2, 0.5], ['D5', 2.5, 0.5], ['E5', 3, 1],
      ['D5', 4, 0.5], ['E5', 4.5, 0.5], ['G5', 5, 0.5], ['A5', 5.5, 0.5],
      ['C6', 6, 0.5], ['B5', 6.5, 0.5], ['A5', 7, 1],
      ['G5', 8, 0.5], ['E5', 8.5, 0.5], ['D5', 9, 0.5], ['E5', 9.5, 0.5],
      ['G5', 10, 1.4],
    ],
  },
  {
    id: 'croatian',
    title: ['克罗地亚狂想曲', 'Croatian Rhapsody'],
    composer: 'Tonči Huljić',
    bpm: 138,
    steps: [
      ['E4', 0, 0.3], ['B4', 0.5, 0.3], ['E5', 1, 0.3], ['B4', 1.5, 0.3],
      ['E4', 2, 0.3], ['B4', 2.5, 0.3], ['E5', 3, 0.3], ['B4', 3.5, 0.3],
      ['D4', 4, 0.3], ['A4', 4.5, 0.3], ['D5', 5, 0.3], ['A4', 5.5, 0.3],
      ['D4', 6, 0.3], ['A4', 6.5, 0.3], ['D5', 7, 0.3], ['A4', 7.5, 0.3],
      ['C4', 8, 0.3], ['G4', 8.5, 0.3], ['C5', 9, 0.3], ['G4', 9.5, 0.3],
      ['B3', 10, 0.3], ['F#4', 10.5, 0.3], ['B4', 11, 0.3], ['F#4', 11.5, 0.3],
      ['E4', 12, 0.6], ['B4', 12.75, 0.6], ['E5', 13.5, 1],
    ],
  },
  {
    id: 'castle',
    title: ['天空之城', 'Castle in the Sky'],
    composer: 'Joe Hisaishi',
    bpm: 96,
    steps: [
      ['A4', 0, 0.7], ['B4', 1, 0.5], ['C5', 1.5, 0.7], ['E5', 2.5, 0.5],
      ['D5', 3, 0.5], ['C5', 3.5, 0.7], ['B4', 4.5, 0.5], ['A4', 5, 1],
      ['E5', 6, 0.7], ['D5', 7, 0.5], ['C5', 7.5, 0.7], ['B4', 8.5, 0.5],
      ['C5', 9, 1.6],
    ],
  },
  {
    id: 'mario',
    title: ['超级玛丽主题曲', 'Super Mario theme'],
    composer: 'Koji Kondo',
    bpm: 200,
    steps: [
      ['E5', 0, 0.35], ['E5', 0.5, 0.35], ['E5', 1, 0.35], ['C5', 1.5, 0.35],
      ['E5', 2, 0.35], ['G5', 2.5, 0.7], ['G4', 3.5, 0.7],
      ['C5', 4.5, 0.5], ['G4', 5, 0.5], ['E4', 5.5, 0.5],
      ['A4', 6, 0.35], ['B4', 6.5, 0.35], ['A#4', 7, 0.35], ['A4', 7.5, 0.35],
      ['G4', 8, 0.35], ['E5', 8.5, 0.35], ['G5', 9, 0.35], ['A5', 9.5, 0.5],
      ['F5', 10, 0.35], ['G5', 10.5, 0.35], ['E5', 11, 0.35], ['C5', 11.5, 0.35],
      ['D5', 12, 0.35], ['B4', 12.5, 1],
    ],
  },
  {
    id: 'got',
    title: ['权力的游戏主题曲', 'Game of Thrones theme'],
    composer: 'Ramin Djawadi',
    bpm: 112,
    steps: [
      ['C4', 0, 0.9], ['C4', 1, 0.45], ['C4', 1.5, 0.45], ['C4', 2, 0.9],
      ['D#4', 3, 0.45], ['D4', 3.5, 0.45], ['C4', 4, 0.9], ['A#3', 5, 0.45],
      ['C4', 5.5, 0.45], ['D#4', 6, 0.9], ['D4', 7, 0.45], ['C4', 7.5, 0.45],
      ['A#3', 8, 0.9], ['G#3', 9, 0.45], ['A#3', 9.5, 0.45], ['C4', 10, 1.8],
    ],
  },
  {
    id: 'jasmine',
    title: ['茉莉花', 'Jasmine Flower'],
    composer: 'Chinese folk',
    bpm: 88,
    steps: [
      ['E4', 0, 0.5], ['E4', 0.5, 0.5], ['G4', 1, 0.5], ['A4', 1.5, 0.5],
      ['C5', 2, 0.5], ['C5', 2.5, 0.5], ['A4', 3, 0.5], ['G4', 3.5, 0.5],
      ['G4', 4, 0.5], ['A4', 4.5, 0.5], ['G4', 5, 0.5], ['E4', 5.5, 0.5],
      ['D4', 6, 0.5], ['E4', 6.5, 0.5], ['G4', 7, 0.5], ['A4', 7.5, 1],
      ['C5', 8.5, 0.5], ['A4', 9, 0.5], ['G4', 9.5, 0.5], ['E4', 10, 1.6],
    ],
  },
  {
    id: 'butterfly',
    title: ['梁祝（选段）', 'Butterfly Lovers (excerpt)'],
    composer: 'He Zhanhao / Chen Gang',
    bpm: 72,
    steps: [
      ['G4', 0, 0.6], ['A4', 0.75, 0.6], ['B4', 1.5, 0.6], ['D5', 2.25, 0.9],
      ['C5', 3.25, 0.6], ['B4', 4, 0.6], ['A4', 4.75, 0.9],
      ['G4', 5.75, 0.6], ['E4', 6.5, 0.6], ['D4', 7.25, 0.9],
      ['E4', 8.25, 0.6], ['G4', 9, 0.6], ['A4', 9.75, 0.6], ['B4', 10.5, 1.8],
    ],
  },
  {
    id: 'seashore',
    title: ['沧海一声笑', 'A Chinese Ghost Story theme'],
    composer: 'James Wong',
    bpm: 92,
    steps: [
      ['A4', 0, 0.9], ['G4', 1, 0.5], ['E4', 1.5, 0.5], ['D4', 2, 0.5],
      ['C4', 2.5, 0.9], ['A3', 3.5, 0.5], ['C4', 4, 0.5], ['D4', 4.5, 0.5],
      ['E4', 5, 0.9], ['G4', 6, 0.5], ['A4', 6.5, 0.5], ['C5', 7, 1.4],
    ],
  },
  arpeggioExercise(),
  scaleExercise(),
];

export const DEMO_SONG_BY_ID = new Map(DEMO_SONGS.map((s) => [s.id, s]));

export function demoSong(id: string): MidiSong | null {
  const spec = DEMO_SONG_BY_ID.get(id);
  return spec ? specToSong(spec) : null;
}
