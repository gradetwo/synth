import { describe, expect, it } from 'vitest';
import { parseScala, parseInterval, scalaTable } from './scala';

const JUST_C = `! C major, 5-limit
Just intonation in C
12
1/1
16/15
9/8
6/5
5/4
4/3
45/32
3/2
8/5
5/3
9/5
2/1
`;

const NINETEEN_EDO = `19 equal
19
63.1578947368
126.3157894737
189.4736842105
252.6315789474
315.7894736842
378.9473684211
442.1052631579
505.2631578947
568.4210526316
631.5789473684
694.7368421053
757.8947368421
821.0526315789
884.2105263158
947.3684210526
1010.5263157895
1073.6842105263
1136.8421052632
1200.0
`;

describe('Scala .scl parsing', () => {
  it('reads ratios, cents and comments', () => {
    const scale = parseScala(JUST_C);
    expect(scale.name).toBe('Just intonation in C');
    expect(scale.degrees).toHaveLength(12);
    expect(scale.period).toBeCloseTo(1200, 6);
    // 5/4 is 386.31 cents.
    expect(scale.degrees[4]).toBeCloseTo(386.3137, 3);
    // 16/15 is 111.73 cents.
    expect(scale.degrees[1]).toBeCloseTo(111.7313, 3);
  });

  it('accepts a cents value with a unit and a bare ratio', () => {
    expect(parseInterval('701.955 cents')).toBeCloseTo(701.955, 6);
    // A bare number is cents per the format, so an octave is "2/1" or "1200.0".
    expect(parseInterval('2')).toBeCloseTo(2, 6);
    expect(parseInterval('2/1')).toBeCloseTo(1200, 6);
    expect(parseInterval('3/2')).toBeCloseTo(701.955, 3);
  });

  it('maps a 12-note scale onto the keys like a temperament', () => {
    const table = scalaTable(parseScala(JUST_C));
    // Key 64 is E: 386.31 cents instead of 400 — 13.69 cents flat.
    expect(table[64]).toBeCloseTo(-13.686, 2);
    // The root and its octave are exact, and the pattern repeats.
    expect(table[60]).toBeCloseTo(0, 6);
    expect(table[72]).toBeCloseTo(0, 6);
    expect(table[76]).toBeCloseTo(table[64], 6);
  });

  it('keeps a non-12-note scale unfolded', () => {
    const table = scalaTable(parseScala(NINETEEN_EDO));
    // 19-EDO's third step is 189.5 cents where 12-TET's second key is 200 —
    // more than a semitone away from 12-TET at some keys, so folding into
    // +/-50 cents would destroy the scale.
    expect(table[63]).toBeCloseTo(189.4737 - 300, 1);
    expect(Math.abs(table[63])).toBeGreaterThan(50);
    // Still octave-repeating: 19 keys up is exactly an octave above.
    expect(table[79] - table[60]).toBeCloseTo(1200 - 1900, 1);
  });

  it('rejects malformed files with a reason', () => {
    expect(() => parseScala('only one line')).toThrow('scala.tooShort');
    expect(() => parseScala('name\n0\n')).toThrow('scala.badCount');
    expect(() => parseScala('name\n12\n1/1\n')).toThrow('scala.tooFewNotes');
    expect(() => parseScala('name\n2\n1/1\nbad')).toThrow('scala.badInterval');
    expect(() => parseScala('name\n2\n0/0\n2/1')).toThrow('scala.badRatio');
    expect(() => parseScala('name\n2\n-100\n-200')).toThrow('scala.badPeriod');
  });
});
