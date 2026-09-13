/**
 * Multi-note selection and batch editing (P10.1).
 *
 * The piano roll used to edit exactly one note at a time: a single `selected`
 * id, one drag, one delete. Most music is not written that way — a chord has to
 * move as a chord, a bar has to be copied as a bar — so a selection is a *set*
 * of note ids and every batch edit is one document replacement, which is exactly
 * what the session already records as one undo step.
 *
 * The model here is deliberately pure and free of React and of the session:
 *
 *   * a selection is an ordered, duplicate-free list of ids. Order is document
 *     order, so the "first" and "last" of a selection are stable and a copied
 *     group keeps its shape;
 *   * the functions that build a selection (`selectOnly`, `toggleSelected`,
 *     `rangeSelected`, `selectAll`, `marqueeSelected`, `clearSelection`) never
 *     look at the document, so they cannot invent an id and cannot reorder one;
 *   * `pruneSelection` is the one function that does look at the document, and
 *     that is the point: a selection has to survive an undo or a track switch
 *     that removed notes, without keeping ids that no longer exist;
 *   * the batch movers (`moveSelection`, `pasteSelection`, `removeSelection`,
 *     `scaleSelection`, `quantizeSelection`) return a new document and never
 *     mutate the one they are given, the same contract `midi/roll.ts` keeps.
 *
 * Cross-layer paste/move is deliberately *not* implemented: a layer is a
 * different take/clip arrangement with its own pitch mapping, and there is no
 * way to move a group there without either losing the take semantics or
 * silently rewriting the source. The editor refuses it with a visible reason
 * (see `PianoRoll`), and `moveSelection` only ever edits the document it is
 * given, so a data move cannot happen behind that refusal.
 */

import { MAX_NOTE, MIN_LENGTH, MIN_NOTE, clamp, fitBeats, type RollDoc, type RollNote } from './roll';

/** A set of selected note ids, in document order. */
export type Selection = readonly string[];

/** Round to 1/10000 of a beat, the precision `midi/roll.ts` stores. */
const tidy = (v: number): number => Math.round(v * 10000) / 10000;

/** Document order, so a selection reads like the grid. */
const inDocOrder = (notes: readonly RollNote[], ids: readonly string[]): string[] => {
  const want = new Set(ids);
  return notes.filter((note) => want.has(note.id)).map((note) => note.id);
};

/** Is this note part of the selection? */
export function isSelected(selection: Selection, id: string): boolean {
  return selection.includes(id);
}

/** The anchor a Shift-click extends from, or null. */
export type SelectionAnchor = string | null;

/** A plain click: the selection becomes exactly this note, which is the anchor. */
export function selectOnly(id: string | null): { selection: string[]; anchor: SelectionAnchor } {
  return { selection: id ? [id] : [], anchor: id };
}

/** Ctrl/Cmd+click: add this note, or take it out when it is already selected. */
export function toggleSelected(
  selection: Selection,
  notes: readonly RollNote[],
  id: string,
): { selection: string[]; anchor: SelectionAnchor } {
  const next = selection.includes(id) ? selection.filter((entry) => entry !== id) : [...selection, id];
  return { selection: inDocOrder(notes, next), anchor: id };
}

/**
 * The rectangle a Shift-click spans, in grid terms.
 *
 * A range is a *rectangle*, not a list: a marquee and a Shift-click have to
 * agree, or the same gesture would mean two things. The rectangle spans from the
 * anchor note's start/pitch to the target note's start/pitch, and a note is
 * inside it when its start and its pitch both fall in the window. That is what
 * "extend by time/pitch" means for a piano roll, and it is testable by itself.
 */
export interface SelectionRange {
  fromBeat: number;
  toBeat: number;
  fromPitch: number;
  toPitch: number;
}

/** The normalised rectangle between two grid points, either order. */
export function rangeBetween(
  beatA: number,
  pitchA: number,
  beatB: number,
  pitchB: number,
): SelectionRange {
  return {
    fromBeat: Math.min(beatA, beatB),
    toBeat: Math.max(beatA, beatB),
    fromPitch: Math.min(pitchA, pitchB),
    toPitch: Math.max(pitchA, pitchB),
  };
}

/** Every note whose start and pitch both sit inside the rectangle. */
export function notesInRange(notes: readonly RollNote[], range: SelectionRange): string[] {
  return notes
    .filter(
      (note) =>
        note.start >= range.fromBeat - 1e-6 &&
        note.start <= range.toBeat + 1e-6 &&
        note.note >= range.fromPitch &&
        note.note <= range.toPitch,
    )
    .map((note) => note.id);
}

/**
 * Shift+click: select the rectangle between the anchor note and this one.
 *
 * With no anchor (or an anchor that is gone) it degrades to a plain click, and
 * the result is `existing ∪ rectangle` so a range can extend a Ctrl-built
 * selection instead of throwing it away. The anchor stays where it was: holding
 * Shift and clicking again grows from the same corner, as it should.
 */
export function rangeSelected(
  selection: Selection,
  notes: readonly RollNote[],
  anchorId: SelectionAnchor,
  id: string,
): { selection: string[]; anchor: SelectionAnchor } {
  const anchor = anchorId ? notes.find((note) => note.id === anchorId) : undefined;
  const target = notes.find((note) => note.id === id);
  if (!anchor || !target) return { selection: inDocOrder(notes, [...selection, id]), anchor: id };
  const range = rangeBetween(anchor.start, anchor.note, target.start, target.note);
  return {
    selection: inDocOrder(notes, [...selection, ...notesInRange(notes, range)]),
    anchor: anchor.id,
  };
}

/**
 * Marquee selection: a rectangle in grid space (beats x semitones), with the
 * y axis in the same units the grid uses. "Overlaps" rather than "starts
 * inside": dragging a box across a long note has to pick it up, exactly like
 * every other timeline. The vertical test therefore uses the note's pitch row,
 * and the horizontal one the note's whole span.
 */
export function marqueeSelected(
  notes: readonly RollNote[],
  rect: { beat0: number; beat1: number; pitch0: number; pitch1: number },
): string[] {
  const beat0 = Math.min(rect.beat0, rect.beat1);
  const beat1 = Math.max(rect.beat0, rect.beat1);
  const pitch0 = Math.min(rect.pitch0, rect.pitch1);
  const pitch1 = Math.max(rect.pitch0, rect.pitch1);
  return notes
    .filter((note) => {
      const end = note.start + note.length;
      return end >= beat0 - 1e-6 && note.start <= beat1 + 1e-6 && note.note >= pitch0 && note.note <= pitch1;
    })
    .map((note) => note.id);
}

/** Ctrl/Cmd+A: every note of the document, in document order. */
export function selectAll(notes: readonly RollNote[]): string[] {
  return notes.map((note) => note.id);
}

/** Esc / a click on empty space: nothing is selected. */
export function clearSelection(): string[] {
  return [];
}

/**
 * Drop ids that are no longer in the document.
 *
 * This is the invariant that keeps a stale selection harmless: an undo, a clip
 * switch or a batch delete can remove notes the selection still names, and a
 * batch edit must then act on what is really there. The order is re-derived
 * from the document too, so a restored note slots back where it belongs.
 */
export function pruneSelection(notes: readonly RollNote[], selection: Selection): string[] {
  if (selection.length === 0) return [];
  const next = inDocOrder(notes, selection);
  return next.length === selection.length && next.every((id, i) => id === selection[i]) ? [...selection] : next;
}

// ------------------------------------------------------------ grid geometry

/**
 * Where a client-space point falls on the grid, in beats and semitones.
 *
 * A pointer event gives the *viewport* position, but the grid scrolls inside
 * `.roll-scroll`, so the same client x means a different beat once the user has
 * scrolled. Everything here therefore takes the grid's own bounding box — which
 * already accounts for scroll and for the sticky gutter — rather than a stored
 * `scrollLeft`. `rowH` is the pixels per semitone and `zoom` the pixels per
 * beat; the y axis counts *down* from the highest visible pitch.
 */
export interface GridBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function gridPoint(
  clientX: number,
  clientY: number,
  box: GridBox,
  zoom: number,
  rowH: number,
  highPitch: number,
): { beat: number; pitch: number } {
  const beat = zoom > 0 ? Math.max(0, (clientX - box.left) / zoom) : 0;
  const row = Math.floor((clientY - box.top) / rowH);
  const pitch = clamp(highPitch - row, MIN_NOTE, MAX_NOTE);
  return { beat, pitch };
}

// ---------------------------------------------------------------- batch edits

/** Every note of the selection, in document order. */
export function selectedNotes(doc: RollDoc, selection: Selection): RollNote[] {
  const want = new Set(selection);
  return doc.notes.filter((note) => want.has(note.id));
}

/** A delta of zero is a delta of nothing, whatever sign the clamp gave it. */
const signed = (v: number): number => (v === 0 ? 0 : v);

/**
 * The largest group move that fits, as a pair of deltas.
 *
 * The whole selection moves by one delta so a chord keeps its shape; what is
 * clamped is the group, not each note. A group whose lowest note is already at
 * C-1 simply cannot go down, and it does not deform to try. `beats` is clamped
 * on the earliest note (nothing may start before the clip) and `notes` on the
 * lowest and highest, so the relative time and pitch relationships are exactly
 * preserved.
 */
export function clampSelectionDelta(
  selection: readonly RollNote[],
  deltaBeats: number,
  deltaNotes: number,
): { beats: number; notes: number } {
  if (selection.length === 0) return { beats: deltaBeats, notes: deltaNotes };
  let earliest = Infinity;
  let lowest = MAX_NOTE;
  let highest = MIN_NOTE;
  for (const note of selection) {
    earliest = Math.min(earliest, note.start);
    lowest = Math.min(lowest, note.note);
    highest = Math.max(highest, note.note);
  }
  // Clamp only the out-of-range direction, and compare against a *positive*
  // magnitude. A leftward move may never travel further than the earliest note's
  // start; a rightward one is always allowed, so one signed comparison is enough.
  // Writing it this way (rather than `Math.max(delta, -earliest)`) also keeps a
  // partial move exact: `Math.max` can hand back `-0`, which compares equal to a
  // zero-beat move while actually being `-0`.
  const room = earliest; // how far left the group may travel, as a positive number
  const beats = -deltaBeats > room ? (room === 0 ? 0 : -room) : deltaBeats;
  return {
    beats: signed(beats),
    notes: signed(clamp(deltaNotes, MIN_NOTE - lowest, MAX_NOTE - highest)),
  };
}

/**
 * Move a whole selection, as one document replacement.
 *
 * The delta is clamped first (`clampSelectionDelta`) so the group keeps its
 * internal shape: no note is squashed against the edge while its neighbours
 * carry on.
 */
export function moveSelection(doc: RollDoc, selection: Selection, deltaBeats: number, deltaNotes: number): RollDoc {
  const group = selectedNotes(doc, selection);
  if (group.length === 0) return doc;
  const delta = clampSelectionDelta(group, deltaBeats, deltaNotes);
  if (delta.beats === 0 && delta.notes === 0) return doc;
  const want = new Set(selection);
  const notes = doc.notes.map((note) =>
    want.has(note.id)
      ? { ...note, start: tidy(Math.max(0, note.start + delta.beats)), note: clamp(note.note + delta.notes, MIN_NOTE, MAX_NOTE) }
      : note,
  );
  return { ...doc, notes, beats: Math.max(doc.beats, fitBeats(notes)) };
}

/**
 * The document without the selection. One call, one undo step.
 *
 * The clip keeps its own length: deleting a note is not a reason to shorten the
 * bar the user is looking at.
 */
export function removeSelection(doc: RollDoc, selection: Selection): RollDoc {
  if (selection.length === 0) return doc;
  const want = new Set(selection);
  const notes = doc.notes.filter((note) => !want.has(note.id));
  if (notes.length === doc.notes.length) return doc;
  return { ...doc, notes };
}

/** A copied group: pure data, independent of the document it came from. */
export interface NoteClipboard {
  notes: RollNote[];
}

/**
 * Copy the selection into a clipboard.
 *
 * The notes are kept relative to the earliest one, so pasting puts the same
 * figure back with the same internal timing no matter where it is pasted.
 */
export function copySelection(doc: RollDoc, selection: Selection): NoteClipboard | null {
  const group = selectedNotes(doc, selection);
  if (group.length === 0) return null;
  const origin = Math.min(...group.map((note) => note.start));
  return { notes: group.map((note) => ({ ...note, start: tidy(note.start - origin) })) };
}

/**
 * Did a paste land on top of the notes it was copied from?
 *
 * The copies always go where the caller asked (the playhead); what this answers
 * is whether they went somewhere the user can *see*, so the editor can say so
 * instead of leaving a pile of notes hidden under an identical pile.
 */
export function pasteCollides(doc: RollDoc, clipboard: NoteClipboard, atBeat: number): boolean {
  const origin = clipboard.notes.length
    ? Math.min(...clipboard.notes.map((note) => note.start))
    : 0;
  const shift = Math.max(0, atBeat) - origin;
  return clipboard.notes.some((copy) =>
    doc.notes.some((note) => {
      const start = Math.max(0, copy.start + shift);
      if (note.note !== copy.note) return false;
      return start < note.start + note.length - 1e-6 && note.start < start + copy.length - 1e-6;
    }),
  );
}

/**
 * Paste a copied group: new ids, one document replacement, and the copies are
 * the new selection.
 *
 * New ids are the whole point — an edit to the copy must not move the original
 * (P10.2 makes the same promise for clips).
 */
export function pasteSelection(
  doc: RollDoc,
  clipboard: NoteClipboard,
  atBeat: number,
  makeId: () => string,
): { doc: RollDoc; selection: string[] } {
  if (clipboard.notes.length === 0) return { doc, selection: [] };
  const origin = Math.min(...clipboard.notes.map((note) => note.start));
  const shift = Math.max(0, atBeat) - origin;
  const added = clipboard.notes.map((note) => ({
    ...note,
    id: makeId(),
    start: tidy(Math.max(0, note.start + shift)),
  }));
  const notes = [...doc.notes, ...added];
  return { doc: { ...doc, notes, beats: Math.max(doc.beats, fitBeats(notes)) }, selection: added.map((n) => n.id) };
}

/**
 * Batch resize: scale the length of every selected note around `atBeat`.
 *
 * A note's end follows the pointer, so a chord of equal notes stays equal and a
 * figure keeps its rhythm. Lengths are floored at `MIN_LENGTH` and a note that
 * is already at the start of the clip cannot grow leftwards (the clip's left
 * edge is hard, exactly as it is for a single-note resize).
 */
export function scaleSelection(doc: RollDoc, selection: Selection, atBeat: number): RollDoc {
  const group = selectedNotes(doc, selection);
  if (group.length === 0) return doc;
  const want = new Set(selection);
  const notes = doc.notes.map((note) => {
    if (!want.has(note.id)) return note;
    const from = Math.max(0, Math.min(note.start, atBeat));
    return { ...note, start: tidy(from), length: tidy(Math.max(MIN_LENGTH, atBeat - from)) };
  });
  return { ...doc, notes, beats: Math.max(doc.beats, fitBeats(notes)) };
}

/** Batch quantise: snap the whole selection to the grid, one undo step. */
export function quantizeSelection(doc: RollDoc, selection: Selection, snap: number): RollDoc {
  if (snap <= 0 || selection.length === 0) return doc;
  const want = new Set(selection);
  const notes = doc.notes.map((note) =>
    want.has(note.id)
      ? {
          ...note,
          start: tidy(Math.max(0, Math.round(note.start / snap) * snap)),
          length: tidy(Math.max(snap, Math.round(note.length / snap) * snap)),
        }
      : note,
  );
  return { ...doc, notes, beats: Math.max(doc.beats, fitBeats(notes)) };
}

/**
 * Batch velocity: set every selected note to the same velocity, which is what
 * the inspector's slider means once more than one note is selected.
 */
export function setSelectionVelocity(doc: RollDoc, selection: Selection, velocity: number): RollDoc {
  if (selection.length === 0) return doc;
  const want = new Set(selection);
  const v = clamp(velocity, 0.05, 1);
  return { ...doc, notes: doc.notes.map((note) => (want.has(note.id) ? { ...note, velocity: v } : note)) };
}
