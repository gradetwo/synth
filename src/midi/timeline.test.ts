import { describe, expect, it } from 'vitest';
import {
  MIN_WIDTH,
  dragSeconds,
  gridSeconds,
  hitNote,
  layoutNotes,
  moveNote,
  playheadPercent,
  resizeNote,
  snapSeconds,
} from './timeline';

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

describe('editing notes on the mini-map', () => {
  const notes = [
    { note: 60, velocity: 0.8, start: 0, duration: 1 },
    { note: 62, velocity: 0.8, start: 2, duration: 1 },
  ];

  it('reports which block is under the pointer and whether the tail was grabbed', () => {
    const blocks = layoutNotes(notes, 4);
    // 0..25 % is the first note, 50..75 % the second.
    expect(hitNote(blocks, 10, 2)).toEqual({ index: 0, edge: 'body' });
    expect(hitNote(blocks, 24, 2)).toEqual({ index: 0, edge: 'tail' });
    expect(hitNote(blocks, 60, 2)).toEqual({ index: 1, edge: 'body' });
    // A gap, and past both ends, hit nothing.
    expect(hitNote(blocks, 40, 2)).toBeNull();
    expect(hitNote(blocks, 90, 2)).toBeNull();
    // The handle is as wide as the caller says: at 2 % a point 3 % from the
    // tail is a move, not a resize.
    expect(hitNote(blocks, 22, 2)).toEqual({ index: 0, edge: 'body' });
  });

  it('keeps the original index when a layer offset hides the first notes', () => {
    const blocks = layoutNotes(notes, 4, -2);
    expect(blocks).toHaveLength(1);
    // The block is drawn from notes[1], not from the filtered array's element 0.
    expect(hitNote(blocks, 10, 1)).toEqual({ index: 1, edge: 'body' });
  });

  it('snaps a drag to the grid', () => {
    // A sixteenth at 120 BPM is 0.125 s; 0.2 s of drag is 1.6 steps → 2 steps.
    expect(snapSeconds(0.2, 0.125)).toBeCloseTo(0.25, 6);
    expect(snapSeconds(-5, 0.125)).toBe(0);
    // No grid (a free drag) still cannot go negative.
    expect(snapSeconds(-1, 0)).toBe(0);
    expect(gridSeconds(0.25, 120)).toBeCloseTo(0.125, 6);
    expect(gridSeconds(0.25, 0)).toBeCloseTo(0.125, 6);
  });

  it('moves a note inside the song and never off the front', () => {
    // snapped to the grid, and the length is untouched
    expect(moveNote(notes[0], 0.3, 0.125, 4)).toEqual({ start: 0.25, duration: 1 });
    // dragging left past zero clamps at zero instead of clipping the note
    expect(moveNote(notes[1], -10, 0.125, 4)).toEqual({ start: 0, duration: 1 });
    // dragging right past the end stops with the note still inside the song
    expect(moveNote(notes[0], 100, 0.125, 4)).toEqual({ start: 3, duration: 1 });
    // a song with no duration yet keeps the note where it was
    expect(moveNote(notes[1], -0.4, 0.125, 0)).toEqual({ start: 0, duration: 1 });
  });

  it('resizes from the tail, at least one step and never past the end', () => {
    expect(resizeNote(notes[0], 0.3, 0.125, 4)).toEqual({ start: 0, duration: 1.25 });
    // shrinking below a step stops at one step
    expect(resizeNote(notes[0], -10, 0.125, 4)).toEqual({ start: 0, duration: 0.125 });
    // growing past the song end stops at the end
    expect(resizeNote(notes[1], 10, 0.125, 4)).toEqual({ start: 2, duration: 2 });
    expect(resizeNote(notes[1], 10, 0, 4)).toEqual({ start: 2, duration: 2 });
  });

  it('converts a pixel drag into seconds', () => {
    expect(dragSeconds(50, 100, 4)).toBeCloseTo(2, 6);
    expect(dragSeconds(-50, 100, 4)).toBeCloseTo(-2, 6);
    // A bar that has not been laid out yet is not a division by zero.
    expect(dragSeconds(50, 0, 4)).toBe(0);
    expect(dragSeconds(50, 100, 0)).toBe(0);
  });
});
