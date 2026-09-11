/**
 * Layer mini-map geometry.
 *
 * A multi-track song is a set of layers that play at the same time; the strip in
 * the player panel shows each one as a bar of note blocks so the shape of the
 * arrangement is visible without opening the piano roll. The maths is trivial,
 * which is exactly why it lives here: it is testable without a browser.
 */

import type { MidiNote } from './smf';

export interface Block {
  /** Percent of the song, 0..100. */
  left: number;
  /** Percent of the song, at least `MIN_WIDTH` so a short note stays visible. */
  width: number;
  /** Index of the note this block was drawn from, in the array passed in. */
  index: number;
}

/** Thinnest a block may be drawn: a 1/32 note in a 4-minute song is a hairline. */
export const MIN_WIDTH = 0.6;

/**
 * Position `notes` on a bar that spans `duration` seconds, as percentages.
 *
 * `offset` shifts the whole layer, so the blocks move as a layer is dragged.
 */
export function layoutNotes(notes: MidiNote[], duration: number, offset = 0): Block[] {
  const span = duration > 0 ? duration : 1;
  return notes
    .map((note, index) => ({ note, index }))
    // A layer dragged past zero stops contributing notes there — exactly the
    // ones the transport drops, so the picture matches what you hear.
    .filter(({ note }) => note.start + offset >= 0)
    .map(({ note, index }) => {
      const from = note.start + offset;
      const start = Math.max(0, Math.min(1, from / span));
      const end = Math.max(start, Math.min(1, (from + note.duration) / span));
      const width = Math.max(MIN_WIDTH, (end - start) * 100);
      // A minimum-width block at the very end would stick out of the bar, so it
      // slides left instead of being clipped.
      return { left: Math.min(start * 100, 100 - width), width, index };
    });
}

/** Where the playhead sits on the same bar, 0..100. */
export function playheadPercent(time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(100, (time / duration) * 100));
}

// -------------------------------------------------------------- strip editing

/** A drag that lands within this many pixels of a note edge resizes it. */
export const EDGE_PX = 8;

/** A note block under the pointer, and which of its two gestures it wants. */
export interface StripHit {
  /** Index into the note array that was hit-tested. */
  index: number;
  /** `tail` when the pointer is on the right edge (resize), else `body`. */
  edge: 'body' | 'tail';
}

/**
 * Which note sits under `percent` (0..100 across the bar).
 *
 * `edge` is how wide the resize handle is, in the same percent units. Blocks can
 * overlap when a layer is dense; the last one drawn wins, which is also the one
 * on top.
 */
export function hitNote(blocks: Block[], percent: number, edge: number): StripHit | null {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (percent < block.left || percent > block.left + block.width) continue;
    const fromTail = block.left + block.width - percent;
    return { index: block.index, edge: fromTail <= edge ? 'tail' : 'body' };
  }
  return null;
}

/** Seconds a drag of `dx` pixels across a bar `width` pixels wide is worth. */
export function dragSeconds(dx: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  return (dx / width) * duration;
}

/** Snap a time to the nearest grid line, never below zero. */
export function snapSeconds(value: number, snap: number): number {
  if (!(snap > 0)) return Math.max(0, value);
  return Math.max(0, Math.round(value / snap) * snap);
}

/** Round to 1/10000 s so a drag does not store floating-point dust. */
const tidy = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * Move a note along the bar: snapped, never before the song starts, and never
 * pushed so far right that it leaves the song entirely.
 *
 * The note keeps its length — the strip is a coarse view, and losing a note's
 * length to a boundary would make nudging an arrangement destructive.
 */
export function moveNote(
  note: MidiNote,
  delta: number,
  snap: number,
  duration: number,
): { start: number; duration: number } {
  const latest = Math.max(0, duration - note.duration);
  const start = Math.min(snapSeconds(note.start + delta, snap), latest);
  return { start: tidy(start), duration: note.duration };
}

/** Resize a note from its tail: snapped, at least one grid step, inside the song. */
export function resizeNote(
  note: MidiNote,
  delta: number,
  snap: number,
  duration: number,
): { start: number; duration: number } {
  const step = snap > 0 ? snap : 0.0625;
  const wanted = snapSeconds(note.duration + delta, step);
  const longest = Math.max(step, duration - note.start);
  const length = Math.max(step, Math.min(wanted, longest));
  return { start: note.start, duration: tidy(length) };
}

/** Convert a tempo's beats to seconds for the strip's grid. */
export function gridSeconds(snapBeats: number, bpm: number): number {
  const tempo = bpm > 0 ? bpm : 120;
  return snapBeats * (60 / tempo);
}
