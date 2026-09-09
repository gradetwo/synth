/**
 * Piano-roll document model.
 *
 * The player, recorder and SMF writer all speak seconds, but editing wants
 * musical time. A `RollDoc` keeps notes in beats at a fixed tempo and converts
 * losslessly to/from `MidiSong`, so the editor never has to think in seconds
 * and the player never has to think in beats.
 *
 * All operations are pure: they return a new document and never mutate the
 * input, which keeps the editor's undo stack trivial.
 */

import type { MidiNote, MidiSong } from './smf';

export interface RollNote {
  id: string;
  /** MIDI note number, 0–127. */
  note: number;
  /** Start position in beats from the top of the clip. */
  start: number;
  /** Length in beats, always > 0. */
  length: number;
  /** Normalised velocity, 0–1. */
  velocity: number;
}

export interface RollDoc {
  name: string;
  bpm: number;
  /** Clip length in beats; always at least the end of the last note. */
  beats: number;
  notes: RollNote[];
}

/** Grid resolutions offered in the editor, in beats (1/32 … 1/4). */
export const SNAP_OPTIONS = [0.125, 0.25, 0.5, 1] as const;
export const MIN_BPM = 40;
export const MAX_BPM = 240;
export const MAX_NOTE = 127;
export const MIN_NOTE = 0;
/** Shortest note the editor will create or resize to. */
export const MIN_LENGTH = 0.0625;

let idSeed = 0;
function nextId(): string {
  idSeed += 1;
  return `n${idSeed.toString(36)}`;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const secondsPerBeat = (bpm: number): number => 60 / bpm;

/** Snap a beat position to the nearest grid line. */
export function snapBeat(value: number, snap: number): number {
  if (snap <= 0) return Math.max(0, value);
  return Math.max(0, Math.round(value / snap) * snap);
}

/** Round to 1/10000 of a beat so serialised values stay readable. */
const tidy = (v: number): number => Math.round(v * 10000) / 10000;

/** Total beats needed to hold every note, rounded up to a whole bar. */
export function fitBeats(notes: RollNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + n.length);
  return Math.max(4, Math.ceil(end / 4) * 4);
}

/** The pitch window the editor should show for a document. */
export function pitchRange(doc: RollDoc): [number, number] {
  if (doc.notes.length === 0) return [48, 72];
  let low = MAX_NOTE;
  let high = MIN_NOTE;
  for (const n of doc.notes) {
    low = Math.min(low, n.note);
    high = Math.max(high, n.note);
  }
  low -= 2;
  high += 2;
  // Keep at least two octaves visible so an empty clip is not a thin strip.
  while (high - low < 24) {
    if (low > MIN_NOTE) low -= 1;
    else if (high < MAX_NOTE) high += 1;
    else break;
  }
  return [clamp(low, MIN_NOTE, MAX_NOTE), clamp(high, MIN_NOTE, MAX_NOTE)];
}

// ------------------------------------------------------------------ conversion

export function songToRoll(song: MidiSong): RollDoc {
  const bpm = clamp(Math.round(song.bpm || 120), MIN_BPM, MAX_BPM);
  const spb = secondsPerBeat(bpm);
  const notes: RollNote[] = song.notes.map((n) => ({
    id: nextId(),
    note: clamp(Math.round(n.note), MIN_NOTE, MAX_NOTE),
    start: tidy(n.start / spb),
    length: Math.max(MIN_LENGTH, tidy(n.duration / spb)),
    velocity: clamp(n.velocity, 0.05, 1),
  }));
  return {
    name: song.name,
    bpm,
    beats: fitBeats(notes),
    notes,
  };
}

export function rollToSong(doc: RollDoc): MidiSong {
  const bpm = clamp(doc.bpm, MIN_BPM, MAX_BPM);
  const spb = secondsPerBeat(bpm);
  const notes: MidiNote[] = [...doc.notes]
    .sort((a, b) => a.start - b.start || a.note - b.note)
    .map((n) => ({
      note: clamp(Math.round(n.note), MIN_NOTE, MAX_NOTE),
      velocity: clamp(n.velocity, 0.05, 1),
      start: tidy(n.start * spb),
      duration: tidy(Math.max(MIN_LENGTH, n.length) * spb),
    }));
  let duration = 0;
  for (const n of notes) duration = Math.max(duration, n.start + n.duration);
  return {
    name: doc.name,
    bpm,
    duration: tidy(duration + 0.4),
    notes,
  };
}

// ------------------------------------------------------------------- editing

export function addNote(
  doc: RollDoc,
  note: number,
  start: number,
  length: number,
  velocity = 0.85,
): { doc: RollDoc; id: string } {
  const entry: RollNote = {
    id: nextId(),
    note: clamp(Math.round(note), MIN_NOTE, MAX_NOTE),
    start: tidy(Math.max(0, start)),
    length: tidy(Math.max(MIN_LENGTH, length)),
    velocity: clamp(velocity, 0.05, 1),
  };
  const notes = [...doc.notes, entry];
  return { doc: { ...doc, notes, beats: Math.max(doc.beats, fitBeats(notes)) }, id: entry.id };
}

export function updateNote(
  doc: RollDoc,
  id: string,
  patch: Partial<Pick<RollNote, 'note' | 'start' | 'length' | 'velocity'>>,
): RollDoc {
  let changed = false;
  const notes = doc.notes.map((n) => {
    if (n.id !== id) return n;
    changed = true;
    return {
      ...n,
      note: patch.note === undefined ? n.note : clamp(Math.round(patch.note), MIN_NOTE, MAX_NOTE),
      start: patch.start === undefined ? n.start : tidy(Math.max(0, patch.start)),
      length: patch.length === undefined ? n.length : tidy(Math.max(MIN_LENGTH, patch.length)),
      velocity: patch.velocity === undefined ? n.velocity : clamp(patch.velocity, 0.05, 1),
    };
  });
  if (!changed) return doc;
  return { ...doc, notes, beats: Math.max(doc.beats, fitBeats(notes)) };
}

export function removeNote(doc: RollDoc, id: string): RollDoc {
  const notes = doc.notes.filter((n) => n.id !== id);
  if (notes.length === doc.notes.length) return doc;
  return { ...doc, notes };
}

/** Snap every note start to the grid and keep lengths at least one step. */
export function quantizeDoc(doc: RollDoc, snap: number): RollDoc {
  if (snap <= 0) return doc;
  return {
    ...doc,
    notes: doc.notes.map((n) => ({
      ...n,
      start: tidy(snapBeat(n.start, snap)),
      length: tidy(Math.max(snap, Math.round(n.length / snap) * snap)),
    })),
  };
}

export function transposeDoc(doc: RollDoc, semitones: number): RollDoc {
  if (semitones === 0 || doc.notes.length === 0) return doc;
  // Clamp the whole selection so a transposed chord keeps its shape.
  let lowest = MAX_NOTE;
  let highest = MIN_NOTE;
  for (const n of doc.notes) {
    lowest = Math.min(lowest, n.note);
    highest = Math.max(highest, n.note);
  }
  const shift = clamp(semitones, MIN_NOTE - lowest, MAX_NOTE - highest);
  if (shift === 0) return doc;
  return { ...doc, notes: doc.notes.map((n) => ({ ...n, note: n.note + shift })) };
}

export function setBpm(doc: RollDoc, bpm: number): RollDoc {
  return { ...doc, bpm: clamp(Math.round(bpm), MIN_BPM, MAX_BPM) };
}

export function setLengthBeats(doc: RollDoc, beats: number): RollDoc {
  const minimum = fitBeats(doc.notes);
  return { ...doc, beats: Math.max(minimum, Math.round(beats * 4) / 4) };
}

export function clearNotes(doc: RollDoc): RollDoc {
  return { ...doc, notes: [], beats: Math.max(4, doc.beats) };
}

/** True for the five black keys of an octave. */
export function isBlackKey(note: number): boolean {
  return [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
}
