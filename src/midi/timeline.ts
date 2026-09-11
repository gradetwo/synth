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
    // A layer dragged past zero stops contributing notes there — exactly the
    // ones the transport drops, so the picture matches what you hear.
    .filter((note) => note.start + offset >= 0)
    .map((note) => {
      const from = note.start + offset;
      const start = Math.max(0, Math.min(1, from / span));
      const end = Math.max(start, Math.min(1, (from + note.duration) / span));
      const width = Math.max(MIN_WIDTH, (end - start) * 100);
      // A minimum-width block at the very end would stick out of the bar, so it
      // slides left instead of being clipped.
      return { left: Math.min(start * 100, 100 - width), width };
    });
}

/** Where the playhead sits on the same bar, 0..100. */
export function playheadPercent(time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(100, (time / duration) * 100));
}
