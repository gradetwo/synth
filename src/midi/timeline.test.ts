import { describe, expect, it } from 'vitest';
import { MIN_WIDTH, layoutNotes, playheadPercent } from './timeline';

describe('layer mini-map geometry', () => {
  it('places a note where it plays and sizes it by its length', () => {
    const blocks = layoutNotes(
      [
        { note: 60, velocity: 0.8, start: 0, duration: 1 },
        { note: 62, velocity: 0.8, start: 2, duration: 2 },
      ],
      4,
    );
    expect(blocks[0].left).toBeCloseTo(0, 5);
    expect(blocks[0].width).toBeCloseTo(25, 5);
    expect(blocks[1].left).toBeCloseTo(50, 5);
    expect(blocks[1].width).toBeCloseTo(50, 5);
  });

  it('keeps a very short note visible and never runs past the end', () => {
    const blocks = layoutNotes([{ note: 60, velocity: 1, start: 99.99, duration: 0.001 }], 100);
    expect(blocks[0].left).toBeLessThanOrEqual(100);
    expect(blocks[0].left + blocks[0].width).toBeLessThanOrEqual(100.0001);
    expect(blocks[0].width).toBeGreaterThanOrEqual(MIN_WIDTH);
    // A note that starts after the end still lands at the end of the bar (the
    // minimum width keeps it inside, so its left edge is a hair before 100).
    const late = layoutNotes([{ note: 60, velocity: 1, start: 200, duration: 1 }], 100)[0];
    expect(late.left).toBeCloseTo(100 - MIN_WIDTH, 5);
    expect(late.left + late.width).toBeLessThanOrEqual(100.0001);
  });

  it('survives a song with no duration yet', () => {
    const blocks = layoutNotes([{ note: 60, velocity: 1, start: 0, duration: 1 }], 0);
    expect(blocks).toHaveLength(1);
    expect(Number.isFinite(blocks[0].left)).toBe(true);
    expect(playheadPercent(0, 0)).toBe(0);
  });

  it('puts the playhead where the transport is', () => {
    expect(playheadPercent(0, 10)).toBe(0);
    expect(playheadPercent(5, 10)).toBe(50);
    expect(playheadPercent(20, 10)).toBe(100);
  });
});
