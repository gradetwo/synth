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

  it('draws a shifted layer shifted', () => {
    const notes = [
      { note: 60, velocity: 1, start: 1, duration: 1 },
      { note: 62, velocity: 1, start: 3, duration: 1 },
    ];
    // Whole layer a second later: every block moves by a quarter of a 4 s song.
    const late = layoutNotes(notes, 4, 1);
    expect(late[0].left).toBeCloseTo(50, 5);
    expect(late[1].left).toBeCloseTo(100 - late[1].width, 5);
    // …and two seconds earlier: the first note leaves the song, the second
    // lands where the first used to be.
    const early = layoutNotes(notes, 4, -2);
    expect(early).toHaveLength(1);
    expect(early[0].left).toBeCloseTo(25, 5);
    // A layer dragged clean off the start draws nothing at all.
    expect(layoutNotes(notes, 4, -60)).toHaveLength(0);
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
