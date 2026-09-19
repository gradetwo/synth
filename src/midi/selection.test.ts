import { describe, expect, it } from 'vitest';
import {
  clearSelection,
  clampSelectionDelta,
  copySelection,
  gridPoint,
  isSelected,
  marqueeSelected,
  moveSelection,
  notesInRange,
  pasteCollides,
  pasteSelection,
  pruneSelection,
  quantizeSelection,
  rangeBetween,
  rangeSelected,
  removeSelection,
  scaleSelection,
  selectAll,
  selectOnly,
  selectedNotes,
  setSelectionVelocity,
  toggleSelected,
} from './selection';
import type { RollDoc, RollNote } from './roll';

/**
 * Selection-set semantics and the batch edits built on them.
 *
 * These are the rules the editor's gestures forward to, so they are pinned here
 * without React or a session: what a click means, what a modifier adds, what a
 * batch edit does to the document, and what happens to a selection when the
 * document moves on underneath it.
 */

const note = (id: string, n: number, start: number, length = 1, velocity = 0.8): RollNote => ({
  id,
  note: n,
  start,
  length,
  velocity,
});

/**
 * A small grid: ids n1…n6 in document order.
 *
 *   n4 (67) at beat 2 ………………………
 *   n5 (64) at beat 1   n6 (64) at beat 3
 *   n1 (60) at 0   n2 (60) at 1   n3 (60) at 4
 */
const doc = (): RollDoc => ({
  name: 'sel',
  bpm: 120,
  beats: 8,
  notes: [
    note('n1', 60, 0),
    note('n2', 60, 1, 0.5),
    note('n3', 60, 4),
    note('n4', 67, 2),
    note('n5', 64, 1),
    note('n6', 64, 3, 0.25),
  ],
});

const ids = (selection: readonly string[]) => [...selection];

describe('selection set semantics', () => {
  it('plain click clears the old selection and selects exactly one note', () => {
    const first = selectOnly('n2');
    expect(ids(first.selection)).toEqual(['n2']);
    expect(first.anchor).toBe('n2');
    const second = selectOnly('n4');
    expect(ids(second.selection)).toEqual(['n4']);
    expect(second.anchor).toBe('n4');
    // An empty plain click is how "click the empty grid" clears the set.
    expect(ids(selectOnly(null).selection)).toEqual([]);
    expect(selectOnly(null).anchor).toBeNull();
  });

  it('Ctrl/Cmd+click toggles a note and re-selects it, in document order', () => {
    const d = doc();
    const a = toggleSelected(selectOnly('n4').selection, d.notes, 'n1');
    expect(ids(a.selection)).toEqual(['n1', 'n4']); // document order, not click order
    expect(a.anchor).toBe('n1');
    const b = toggleSelected(a.selection, d.notes, 'n4');
    expect(ids(b.selection)).toEqual(['n1']);
    expect(b.anchor).toBe('n4');
    // Toggling a note that is not there adds it exactly once…
    const c = toggleSelected(b.selection, d.notes, 'n4');
    expect(ids(c.selection)).toEqual(['n1', 'n4']);
    // …and toggling it again removes it, never duplicating it.
    const d2 = toggleSelected(c.selection, d.notes, 'n4');
    expect(ids(d2.selection)).toEqual(['n1']);
    expect(d2.selection).toHaveLength(1);
  });

  it('Shift+click selects the time/pitch rectangle between anchor and target', () => {
    const d = doc();
    // Anchor on n1 (60 at beat 0), click n5 (64 at beat 1): the rectangle covers
    // beats 0-1 and pitches 60-64 — n1, n2 and n5, but not n6 (beat 3) or n4 (67).
    const built = rangeSelected(selectOnly('n1').selection, d.notes, 'n1', 'n5');
    expect(ids(built.selection)).toEqual(['n1', 'n2', 'n5']);
    expect(built.anchor).toBe('n1');
    // The rectangle is symmetric: clicking the other way selects the same notes.
    expect(ids(rangeSelected([], d.notes, 'n5', 'n1').selection)).toEqual(['n1', 'n2', 'n5']);
    // The pitch axis matters on its own: n4 (67) is out of the 60-64 window.
    expect(ids(rangeSelected([], d.notes, 'n5', 'n4').selection)).toEqual(['n4', 'n5']);
  });

  it('Shift+click extends an existing selection and keeps the anchor', () => {
    const d = doc();
    const base = toggleSelected(toggleSelected([], d.notes, 'n3').selection, d.notes, 'n1');
    expect(ids(base.selection)).toEqual(['n1', 'n3']);
    // Anchor n1, target n5: the range adds n1/n2/n5 to what was already there.
    const grown = rangeSelected(base.selection, d.notes, 'n1', 'n5');
    expect(ids(grown.selection)).toEqual(['n1', 'n2', 'n3', 'n5']);
    expect(grown.anchor).toBe('n1');
    // A second Shift+click grows from the same anchor, not from the last click.
    const wider = rangeSelected(grown.selection, d.notes, grown.anchor, 'n4');
    expect(ids(wider.selection)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(wider.anchor).toBe('n1');
  });

  it('Shift+click with no anchor behaves like a plain click', () => {
    const d = doc();
    const r = rangeSelected([], d.notes, null, 'n6');
    expect(ids(r.selection)).toEqual(['n6']);
    expect(r.anchor).toBe('n6');
    // An anchor the document no longer has is just as harmless.
    const gone = rangeSelected(['n1'], d.notes, 'nope', 'n6');
    expect(ids(gone.selection)).toEqual(['n1', 'n6']);
  });

  it('range and marquee agree on what a rectangle contains', () => {
    const d = doc();
    const range = rangeBetween(0, 60, 1, 64);
    expect(ids(notesInRange(d.notes, range))).toEqual(ids(marqueeSelected(d.notes, { beat0: 1, beat1: 0, pitch0: 64, pitch1: 60 })));
  });

  it('marquee picks up a note it only overlaps horizontally', () => {
    const d = doc();
    // A box over beats 0.5-0.9 must still catch n1 (beat 0, one beat long),
    // because dragging across a long note selects it.
    expect(ids(marqueeSelected(d.notes, { beat0: 0.5, beat1: 0.9, pitch0: 60, pitch1: 60 }))).toEqual(['n1']);
    // …and a box that lands in the gap between two same-lane notes catches
    // neither of them.
    expect(ids(marqueeSelected(d.notes, { beat0: 3.6, beat1: 3.9, pitch0: 60, pitch1: 60 }))).toEqual([]);
  });

  it('marquee is direction-agnostic and pitch-bounded', () => {
    const d = doc();
    const box = { beat0: 3.5, beat1: 0.5, pitch0: 67, pitch1: 60 };
    // n6 starts half a beat past the box's right edge but reaches back into it,
    // so a drag across it selects it. n3 (beat 4) is left out.
    expect(ids(marqueeSelected(d.notes, box))).toEqual(['n1', 'n2', 'n4', 'n5', 'n6']);
    // Only the 64 row.
    expect(ids(marqueeSelected(d.notes, { beat0: 0, beat1: 8, pitch0: 64, pitch1: 64 }))).toEqual(['n5', 'n6']);
  });

  it('selects all, clears, and prunes ids the document no longer has', () => {
    const d = doc();
    expect(ids(selectAll(d.notes))).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect(ids(clearSelection())).toEqual([]);
    expect(ids(pruneSelection(d.notes, ['n3', 'n1']))).toEqual(['n1', 'n3']); // back to document order
    expect(ids(pruneSelection(d.notes, ['n1', 'n2', 'gone']))).toEqual(['n1', 'n2']);
    // An undo that removed the note, or a track switch: only real ids survive.
    expect(ids(pruneSelection(d.notes, ['gone', 'also-gone']))).toEqual([]);
    expect(ids(pruneSelection(d.notes, []))).toEqual([]);
    // A stable selection is returned as-is, not rebuilt differently.
    expect(ids(pruneSelection(d.notes, ['n1', 'n3']))).toEqual(ids(pruneSelection(d.notes, ['n1', 'n3'])));
  });

  it('never duplicates a note inside one operation', () => {
    const d = doc();
    // A Ctrl-click of an already-selected note cannot double it, even mixed
    // with a Shift range that also contains it.
    const toggled = toggleSelected(['n1', 'n2'], d.notes, 'n1');
    expect(toggled.selection.filter((id) => id === 'n1')).toHaveLength(0);
    const ranged = rangeSelected(['n1', 'n2'], d.notes, 'n1', 'n2');
    expect(new Set(ranged.selection).size).toBe(ranged.selection.length);
    expect(ids(ranged.selection)).toEqual(['n1', 'n2']);
  });

  it('reports membership for rendering', () => {
    expect(isSelected(['n1', 'n4'], 'n4')).toBe(true);
    expect(isSelected(['n1', 'n4'], 'n2')).toBe(false);
  });
});

describe('grid coordinates under scroll and zoom', () => {
  // The grid's own bounding box already accounts for scroll, so the same client
  // point maps to a *later* beat once the container has scrolled left.
  const box = { left: 100, top: 50, width: 400, height: 200 };

  it('maps a client point to beats and semitones at a given zoom', () => {
    expect(gridPoint(100, 50, box, 88, 20, 72)).toEqual({ beat: 0, pitch: 72 });
    expect(gridPoint(276, 90, box, 88, 20, 72)).toEqual({ beat: 2, pitch: 70 });
    expect(gridPoint(100 + 88 * 2.5, 50 + 20 * 3, box, 88, 20, 72)).toEqual({ beat: 2.5, pitch: 69 });
  });

  it('follows the scroll position instead of a stored scrollLeft', () => {
    // Scrolled 880 px right: the same client x is two beats earlier on screen.
    const scrolled = { ...box, left: 100 - 880 };
    expect(gridPoint(100, 50, scrolled, 88, 20, 72).beat).toBe(10);
    // Zooming changes the mapping too, without touching the box.
    expect(gridPoint(276, 50, box, 44, 20, 72).beat).toBe(4);
  });

  it('clamps to the MIDI range and never goes before the clip', () => {
    expect(gridPoint(50, 50, box, 88, 20, 72).beat).toBe(0);
    expect(gridPoint(100, -1000, box, 88, 20, 72).pitch).toBe(125); // far above the top row
    expect(gridPoint(100, 100_000, box, 88, 20, 72).pitch).toBe(0); // far below the bottom row
  });
});

describe('batch edits', () => {
  it('moves the whole selection by one delta and keeps its shape', () => {
    const d = doc();
    const moved = moveSelection(d, ['n1', 'n2', 'n5'], 1, 2);
    const byId = (doc: RollDoc, id: string) => doc.notes.find((n) => n.id === id)!;
    expect(byId(moved, 'n1')).toMatchObject({ start: 1, note: 62 });
    expect(byId(moved, 'n2')).toMatchObject({ start: 2, note: 62 });
    expect(byId(moved, 'n5')).toMatchObject({ start: 2, note: 66 });
    // Notes outside the selection are untouched…
    expect(byId(moved, 'n4')).toMatchObject({ start: 2, note: 67 });
    // …and the same relative gaps survive.
    expect(byId(moved, 'n2').start - byId(moved, 'n1').start).toBe(byId(d, 'n2').start - byId(d, 'n1').start);
    // The input document is never mutated.
    expect(byId(d, 'n1').start).toBe(0);
  });

  it('clamps the group, not each note, at the top and bottom of the range', () => {
    const low: RollDoc = { name: '', bpm: 120, beats: 4, notes: [note('a', 0, 0), note('b', 2, 1)] };
    const down = moveSelection(low, ['a', 'b'], 0, -5);
    // Both notes stop together: the shape is preserved, nothing is squashed.
    expect(down.notes.map((n) => n.note)).toEqual([0, 2]);
    const up = moveSelection(low, ['a', 'b'], 0, 200);
    expect(up.notes.map((n) => n.note)).toEqual([125, 127]);

    const chord: RollDoc = { name: '', bpm: 120, beats: 4, notes: [note('a', 60, 0), note('b', 64, 0.5)] };
    expect(clampSelectionDelta(chord.notes, 0, -100)).toEqual({ beats: 0, notes: -60 });
    // Nothing may start before the clip: the earliest note decides the shift.
    // A group sitting on beat 0 cannot move left at all, and the clamp is
    // sign-normal: a blocked move is `+0`, not `-0`.
    expect(clampSelectionDelta(chord.notes, -4, 0)).toEqual({ beats: 0, notes: 0 });
    expect(clampSelectionDelta(chord.notes, -0.25, 0)).toEqual({ beats: 0, notes: 0 });
    // With room to the left, the same move goes through untouched (this is the
    // case a `Math.max(delta, -earliest)` clamp gets wrong: `-0` compares equal
    // to `0` but is not the delta the caller asked for).
    const roomy = [note('a', 60, 1), note('b', 64, 1.5)];
    expect(clampSelectionDelta(roomy, -0.25, 0).beats).toBeCloseTo(-0.25);
    expect(clampSelectionDelta(roomy, -1, 0).beats).toBeCloseTo(-1);
    expect(clampSelectionDelta(roomy, -1.5, 0)).toEqual({ beats: -1, notes: 0 });
    // An empty selection has nothing to clamp.
    expect(clampSelectionDelta([], -4, -100)).toEqual({ beats: -4, notes: -100 });
  });

  it('does nothing at all when the whole group is already against the edge', () => {
    const d: RollDoc = { name: '', bpm: 120, beats: 4, notes: [note('a', 0, 0), note('b', 2, 1)] };
    expect(moveSelection(d, ['a', 'b'], 0, -3)).toBe(d);
    expect(moveSelection(d, ['a', 'b'], -5, 0)).toBe(d);
    expect(moveSelection(d, [], 4, 4)).toBe(d);
    expect(moveSelection(d, ['gone'], 4, 4)).toBe(d);
  });

  it('removes the whole selection in one replacement', () => {
    const d = doc();
    const left = removeSelection(d, ['n1', 'n2', 'n3']);
    expect(left.notes.map((n) => n.id)).toEqual(['n4', 'n5', 'n6']);
    expect(left.beats).toBe(d.beats); // the clip keeps its length
    expect(d.notes).toHaveLength(6);
    expect(removeSelection(d, [])).toBe(d);
    expect(removeSelection(d, ['gone'])).toBe(d);
  });

  it('copies relative to the earliest note and pastes with fresh ids', () => {
    const d = doc();
    const clip = copySelection(d, ['n1', 'n5'])!;
    expect(clip.notes.map((n) => [n.id, n.note, n.start])).toEqual([
      ['n1', 60, 0],
      ['n5', 64, 1],
    ]);
    let seed = 0;
    const pasted = pasteSelection(d, clip, 4, () => `c${(seed += 1)}`);
    expect(pasted.doc.notes).toHaveLength(8);
    const copies = selectedNotes(pasted.doc, pasted.selection);
    expect(copies.map((n) => n.id)).toEqual(['c1', 'c2']);
    expect(copies.map((n) => [n.note, n.start])).toEqual([
      [60, 4],
      [64, 5],
    ]);
    // The copies are the new selection and the originals are untouched.
    expect(pasted.selection).toEqual(['c1', 'c2']);
    expect(d.notes).toHaveLength(6);
    // Editing a copy must not move the original: different ids, different object.
    const moved = moveSelection(pasted.doc, ['c1'], 0, 3);
    expect(moved.notes.find((n) => n.id === 'c1')!.note).toBe(63);
    expect(moved.notes.find((n) => n.id === 'n1')!.note).toBe(60);
  });

  it('reports an invisible paste instead of hiding notes under the original', () => {
    const d = doc();
    const clip = copySelection(d, ['n1', 'n5'])!;
    expect(pasteCollides(d, clip, 0)).toBe(true); // back on top of itself
    // Past the end of the clip is the one place nothing can be hidden.
    expect(pasteCollides(d, clip, 5)).toBe(false);
    expect(pasteCollides(d, clip, 0.5)).toBe(true); // n1's copy lands on n2's lane seat
    expect(pasteCollides({ ...d, notes: [] }, clip, 0)).toBe(false);
  });

  it('scales a whole selection around one beat', () => {
    const d = doc();
    // Drag the end of the group to beat 3: every note ends there, so the notes
    // that started earlier get longer and keep their relative starts.
    const scaled = scaleSelection(d, ['n1', 'n2'], 3);
    const byId = (id: string) => scaled.notes.find((n) => n.id === id)!;
    expect(byId('n1')).toMatchObject({ start: 0, length: 3 });
    expect(byId('n2')).toMatchObject({ start: 1, length: 2 });
    expect(byId('n3')).toMatchObject({ start: 4, length: 1 }); // not selected
    // A note before the target keeps at least the minimum length.
    const tiny = scaleSelection(d, ['n2'], 1);
    expect(tiny.notes.find((n) => n.id === 'n2')).toMatchObject({ start: 1, length: 0.0625 });
    // The anchor cannot pull a note before the start of the clip.
    const left = scaleSelection({ ...d, notes: [note('x', 60, 0, 2)] }, ['x'], 1);
    expect(left.notes[0]).toMatchObject({ start: 0, length: 1 });
  });

  it('quantises the selection only', () => {
    const d: RollDoc = {
      name: '',
      bpm: 120,
      beats: 8,
      notes: [note('a', 60, 0.3, 0.6), note('b', 62, 1.4, 0.9)],
    };
    const q = quantizeSelection(d, ['a'], 0.25);
    expect(q.notes.find((n) => n.id === 'a')).toMatchObject({ start: 0.25, length: 0.5 });
    expect(q.notes.find((n) => n.id === 'b')).toMatchObject({ start: 1.4, length: 0.9 });
    expect(quantizeSelection(d, ['a'], 0)).toBe(d);
    expect(quantizeSelection(d, [], 0.25)).toBe(d);
  });

  it('sets one velocity for the whole selection', () => {
    const d = doc();
    const v = setSelectionVelocity(d, ['n1', 'n4'], 0.2);
    expect(v.notes.find((n) => n.id === 'n1')!.velocity).toBe(0.2);
    expect(v.notes.find((n) => n.id === 'n4')!.velocity).toBe(0.2);
    expect(v.notes.find((n) => n.id === 'n2')!.velocity).toBe(0.8);
    expect(setSelectionVelocity(d, ['n1'], 9).notes[0].velocity).toBe(1);
    expect(setSelectionVelocity(d, [], 0.2)).toBe(d);
  });
});
