/**
 * Microtuning.
 *
 * A temperament is 128 cent offsets (one per MIDI key) sent to the core, which
 * adds them where it derives a frequency from a note number. Everything else in
 * the synth — pitch bend, glide, the keyboard, file playback — keeps working in
 * note numbers, so a temperament only changes where the notes land.
 *
 * The offsets are generated from a 12-note pattern repeated across the
 * keyboard, which is how historical temperaments are defined.
 */

export interface Temperament {
  id: string;
  /** Bilingual name. */
  name: [string, string];
  /** Cent offset per pitch class, key 0 = C. */
  cents: number[];
}

/** Equal temperament: nothing to correct. */
const EQUAL = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * 5-limit just intonation on C: pure thirds and fifths, at the cost of a
 * noticeably narrow fifth between D and A (which is the point — it is what
 * makes chords lock in).
 */
const JUST_C = [
  0,
  111.731 - 100,
  203.910 - 200,
  315.641 - 300,
  386.314 - 400,
  498.045 - 500,
  590.224 - 600,
  701.955 - 700,
  813.686 - 800,
  884.359 - 900,
  1017.596 - 1000,
  1088.269 - 1100,
];

/** Pythagorean: pure fifths stacked, so thirds are wide and bright. */
const PYTHAGOREAN = [
  0,
  113.685 - 100,
  203.910 - 200,
  305.865 - 300,
  407.820 - 400,
  498.045 - 500,
  611.730 - 600,
  701.955 - 700,
  815.640 - 800,
  905.865 - 900,
  1017.960 - 1000,
  1109.775 - 1100,
];

/** Quarter-comma meantone: the classic Renaissance/Baroque keyboard tuning. */
const MEANTONE = [
  0,
  76.049 - 100,
  193.157 - 200,
  310.265 - 300,
  386.314 - 400,
  503.422 - 500,
  579.471 - 600,
  696.578 - 700,
  772.627 - 800,
  889.735 - 900,
  1006.843 - 1000,
  1082.892 - 1100,
];

export const TEMPERAMENTS: Temperament[] = [
  { id: 'equal', name: ['平均律', 'Equal'], cents: EQUAL },
  { id: 'just', name: ['纯律（C 为主音）', 'Just (in C)'], cents: JUST_C },
  { id: 'pythagorean', name: ['毕达哥拉斯律', 'Pythagorean'], cents: PYTHAGOREAN },
  { id: 'meantone', name: ['中庸律（四分之一彗差）', 'Quarter-comma meantone'], cents: MEANTONE },
];

/** Expand a 12-note pattern to all 128 keys, wrapped into ±50 cents. */
export function temperamentTable(cents: number[]): Float32Array {
  const table = new Float32Array(128);
  for (let note = 0; note < 128; note++) {
    const raw = cents[((note % 12) + 12) % 12] ?? 0;
    // Keep the correction as small as it can be: -13.7 cents is the same pitch
    // class as +86.3, and the smaller number is the one that reads as "slightly
    // flat" rather than "nearly a semitone sharp".
    table[note] = raw - Math.round(raw / 100) * 100;
  }
  return table;
}

export function temperamentById(id: string): Temperament {
  return TEMPERAMENTS.find((t) => t.id === id) ?? TEMPERAMENTS[0];
}
