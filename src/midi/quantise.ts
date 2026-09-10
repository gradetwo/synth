/**
 * Quantising a recording.
 *
 * The recorder captures what was played, which is never exactly on the grid. A
 * quantiser pulls each note's start to the nearest division and drags the note
 * with it, so the rhythm tightens without changing what was played.
 *
 * Pure, so the musical rules are testable: a note keeps its length, quantising
 * is idempotent, and nothing moves more than half a division.
 */

import type { MidiNote } from './smf';

export type QuantiseGrid = 'off' | '1/16' | '1/8' | '1/8t' | '1/4';

export const QUANTISE_GRIDS: { id: QuantiseGrid; name: [string, string]; beats: number }[] = [
  { id: 'off', name: ['关闭', 'Off'], beats: 0 },
  { id: '1/16', name: ['十六分', '1/16'], beats: 0.25 },
  { id: '1/8', name: ['八分', '1/8'], beats: 0.5 },
  { id: '1/8t', name: ['八分三连', '1/8 triplet'], beats: 1 / 3 },
  { id: '1/4', name: ['四分', '1/4'], beats: 1 },
];

/** Grid length in seconds for a tempo, or 0 when quantising is off. */
export function gridSeconds(grid: QuantiseGrid, bpm: number): number {
  const beats = QUANTISE_GRIDS.find((entry) => entry.id === grid)?.beats ?? 0;
  if (beats <= 0) return 0;
  return (beats * 60) / Math.max(1, bpm);
}

/**
 * Snap note starts to the grid. Lengths are preserved and the earliest note
 * stays put (it defines the clip's zero), so a take does not drift late.
 */
export function quantiseNotes(notes: MidiNote[], grid: QuantiseGrid, bpm: number): MidiNote[] {
  const step = gridSeconds(grid, bpm);
  if (step <= 0 || notes.length === 0) return notes.map((note) => ({ ...note }));
  // Relative to the first note, so a late start does not quantise everything up.
  const origin = Math.min(...notes.map((note) => note.start));
  return notes.map((note) => {
    const offset = note.start - origin;
    const snapped = Math.round(offset / step) * step;
    return { ...note, start: origin + snapped };
  });
}

export function quantiseLabel(grid: string, lang: 'zh' | 'en'): string {
  const entry = QUANTISE_GRIDS.find((g) => g.id === grid) ?? QUANTISE_GRIDS[0];
  return entry.name[lang === 'zh' ? 0 : 1];
}
