/**
 * Chord recognition for the note monitor.
 *
 * Takes the currently held MIDI notes and returns the most plausible chord
 * name. The search is deliberately small and deterministic: every pitch class
 * is tried as the root, templates are matched exactly first, then by inclusion,
 * and the bass note decides between otherwise equal candidates.
 */

export interface Chord {
  name: string;
  root: number;
  quality: string;
  /** Pitch classes used, root first. */
  intervals: number[];
  /** True when the bass is not the chord root (slash chord). */
  inversion: boolean;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface Template {
  suffix: string;
  intervals: number[];
  /** Prefer larger templates when several match. */
  weight: number;
}

const TEMPLATES: Template[] = [
  { suffix: '', intervals: [0, 4, 7], weight: 3 },
  { suffix: 'm', intervals: [0, 3, 7], weight: 3 },
  { suffix: 'dim', intervals: [0, 3, 6], weight: 3 },
  { suffix: 'aug', intervals: [0, 4, 8], weight: 3 },
  { suffix: 'sus2', intervals: [0, 2, 7], weight: 3 },
  { suffix: 'sus4', intervals: [0, 5, 7], weight: 3 },
  { suffix: '5', intervals: [0, 7], weight: 2 },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], weight: 5 },
  { suffix: '7', intervals: [0, 4, 7, 10], weight: 5 },
  { suffix: 'm7', intervals: [0, 3, 7, 10], weight: 5 },
  { suffix: 'm7b5', intervals: [0, 3, 6, 10], weight: 5 },
  { suffix: 'dim7', intervals: [0, 3, 6, 9], weight: 5 },
  { suffix: 'mMaj7', intervals: [0, 3, 7, 11], weight: 5 },
  { suffix: '6', intervals: [0, 4, 7, 9], weight: 4 },
  { suffix: 'm6', intervals: [0, 3, 7, 9], weight: 4 },
  { suffix: '7sus4', intervals: [0, 5, 7, 10], weight: 4 },
  { suffix: 'add9', intervals: [0, 2, 4, 7], weight: 4 },
  { suffix: 'madd9', intervals: [0, 2, 3, 7], weight: 4 },
  { suffix: '9', intervals: [0, 2, 4, 7, 10], weight: 6 },
  { suffix: 'maj9', intervals: [0, 2, 4, 7, 11], weight: 6 },
  { suffix: 'm9', intervals: [0, 2, 3, 7, 10], weight: 6 },
];

const key = (intervals: number[]) => [...intervals].sort((a, b) => a - b).join(',');

const TEMPLATE_BY_KEY = new Map(TEMPLATES.map((t) => [key(t.intervals), t]));

function rotate(pitchClasses: number[], root: number): number[] {
  return pitchClasses.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b);
}

export function detectChord(midiNotes: number[]): Chord | null {
  const unique = [...new Set(midiNotes.map((n) => ((n % 12) + 12) % 12))];
  if (unique.length < 2) return null;

  const bass = ((Math.min(...midiNotes) % 12) + 12) % 12;
  const roots = [bass, ...unique.filter((pc) => pc !== bass)];

  let best: Chord | null = null;
  let bestScore = -Infinity;

  for (const root of roots) {
    const intervals = rotate(unique, root);
    const exact = TEMPLATE_BY_KEY.get(key(intervals));
    if (exact) {
      const score = 100 + exact.weight * 10 + (root === bass ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { name: '', root, quality: exact.suffix, intervals, inversion: root !== bass };
      }
      continue;
    }
    // Inclusion: the template is contained in the played notes (extra tensions).
    for (const template of TEMPLATES) {
      const contained = template.intervals.every((i) => intervals.includes(i));
      if (!contained) continue;
      const extra = intervals.length - template.intervals.length;
      const score =
        40 + template.weight * 5 - extra * 6 + (root === bass ? 4 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { name: '', root, quality: template.suffix, intervals, inversion: root !== bass };
      }
    }
  }

  if (!best) return null;
  const name = `${NAMES[best.root]}${best.quality}${best.inversion ? `/${NAMES[bass]}` : ''}`;
  return { ...best, name };
}
