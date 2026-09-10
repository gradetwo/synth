import { describe, expect, it } from 'vitest';
import type { MidiNote } from './smf';
import { gridSeconds, quantiseLabel, quantiseNotes } from './quantise';

const note = (start: number, duration = 0.5): MidiNote => ({ note: 60, velocity: 0.8, start, duration });

describe('record quantise', () => {
  it('snaps starts to the nearest division and keeps lengths', () => {
    // At 120 BPM a sixteenth is 0.125 s.
    const notes = [note(0.0), note(0.13), note(0.24), note(0.51, 0.25)];
    const out = quantiseNotes(notes, '1/16', 120);
    expect(out.map((n) => n.start)).toEqual([0, 0.125, 0.25, 0.5]);
    expect(out.map((n) => n.duration)).toEqual([0.5, 0.5, 0.5, 0.25]);
  });

  it('never moves a note more than half a division', () => {
    const step = gridSeconds('1/8', 96);
    for (let start = 0; start < 2; start += 0.037) {
      const out = quantiseNotes([note(0), note(start)], '1/8', 96);
      expect(Math.abs(out[1].start - out[0].start - start)).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
  });

  it('is idempotent and leaves the first note where it was', () => {
    const notes = [note(0.42), note(0.61), note(0.79)];
    const once = quantiseNotes(notes, '1/8', 110);
    const twice = quantiseNotes(once, '1/8', 110);
    expect(twice.map((n) => n.start)).toEqual(once.map((n) => n.start));
    // The take keeps its own origin rather than jumping to bar one.
    expect(once[0].start).toBeCloseTo(0.42, 6);
  });

  it('does nothing when quantising is off or there are no notes', () => {
    const notes = [note(0.13)];
    expect(quantiseNotes(notes, 'off', 120)[0].start).toBeCloseTo(0.13, 6);
    expect(quantiseNotes([], '1/16', 120)).toEqual([]);
    expect(gridSeconds('off', 120)).toBe(0);
    expect(quantiseLabel('1/8t', 'zh')).toBe('八分三连');
  });
});
