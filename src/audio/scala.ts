/**
 * Scala `.scl` tuning files.
 *
 * The format is a small text file:
 *
 *   ! comment lines start with "!"
 *   <description>              (one line, may be empty)
 *   <number of notes>
 *   <interval>                 (one per line, ratio or cents)
 *
 * An interval is either a ratio (`3/2`, `2`) or a cents value (`701.955`),
 * optionally followed by `cents`. The last interval is the period — usually the
 * octave — and the whole pattern repeats from there.
 *
 * The parser is a pure function so it can be tested against real-world files
 * without a browser.
 */

export interface ScalaScale {
  name: string;
  /** Center offsets per degree, in cents, relative to the scale root. */
  degrees: number[];
  /** The repeating period in cents (the last interval). */
  period: number;
}

const MAX_DEGREES = 128;

/** Parse a `.scl` file body. Throws with a readable reason when malformed. */
export function parseScala(text: string): ScalaScale {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('!'));

  if (lines.length < 2) throw new Error('scala.tooShort');

  const description = lines[0];
  const count = Number.parseInt(lines[1].split(/\s+/)[0], 10);
  if (!Number.isFinite(count) || count < 1 || count > MAX_DEGREES) {
    throw new Error('scala.badCount');
  }
  if (lines.length < 2 + count) throw new Error('scala.tooFewNotes');

  const intervals: number[] = [];
  for (let i = 0; i < count; i++) {
    intervals.push(parseInterval(lines[2 + i]));
  }
  const period = intervals[intervals.length - 1];
  if (!(period > 0)) throw new Error('scala.badPeriod');

  // The format's tonic is implicit: the first line is the first note *above*
  // the 1/1 and the last is the period. Some files spell the tonic out anyway,
  // so normalise both shapes to "one entry per key, starting at 0 cents".
  const degrees =
    Math.abs(intervals[0]) < 1e-6 ? intervals.slice() : [0, ...intervals.slice(0, -1)];
  return { name: description || 'Scala', degrees, period };
}

/** One interval line: a ratio, a cents value, or a cents value with a unit. */
export function parseInterval(line: string): number {
  // "2/1", "3/2", "81/64" …  anything after the first token is a comment/unit.
  const token = line.split(/\s+/)[0];
  const slash = token.indexOf('/');
  if (slash > 0) {
    const numerator = Number.parseFloat(token.slice(0, slash));
    const denominator = Number.parseFloat(token.slice(slash + 1));
    if (!(numerator > 0) || !(denominator > 0)) throw new Error('scala.badRatio');
    return 1200 * Math.log2(numerator / denominator);
  }
  const cents = Number.parseFloat(token);
  if (!Number.isFinite(cents)) throw new Error('scala.badInterval');
  return cents;
}

/**
 * Expand a scale onto the 128 MIDI keys.
 *
 * Unlike the built-in 12-note temperaments this is *not* folded into ±50 cents:
 * a 19-note scale legitimately puts a key more than a semitone away from where
 * 12-TET would, and folding would collapse it back.
 */
export function scalaTable(scale: ScalaScale, root = 60): Float32Array {
  const table = new Float32Array(128);
  const n = scale.degrees.length;
  for (let key = 0; key < 128; key++) {
    const steps = Math.floor((key - root) / n);
    const degree = ((key - root) % n + n) % n;
    const cents = steps * scale.period + scale.degrees[degree];
    table[key] = cents - 100 * (key - root);
  }
  return table;
}

/** Accept a persisted scale without trusting the shape of the stored data. */
export function normalizeScale(raw: unknown): ScalaScale | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, degrees, period } = raw as Partial<ScalaScale>;
  if (typeof name !== 'string') return null;
  if (!Array.isArray(degrees) || degrees.length < 1 || degrees.length > MAX_DEGREES) return null;
  if (!degrees.every((d) => typeof d === 'number' && Number.isFinite(d))) return null;
  if (typeof period !== 'number' || !(period > 0) || !Number.isFinite(period)) return null;
  return { name, degrees: degrees.slice(), period };
}

/** Sanity check used by the importer before it replaces the current tuning. */
export function scaleSummary(scale: ScalaScale): string {
  return `${scale.degrees.length} notes · period ${scale.period.toFixed(1)}¢`;
}
