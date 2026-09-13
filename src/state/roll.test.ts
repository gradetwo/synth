import { beforeEach, describe, expect, it } from 'vitest';
import { midiLibrary, type Track } from '@/midi/library';
import { midiPlayer } from '@/midi/player';
import { addNote, removeNote, type RollDoc } from '@/midi/roll';
import {
  copySelection,
  moveSelection,
  pasteSelection,
  quantizeSelection,
  removeSelection,
  scaleSelection,
} from '@/midi/selection';
import { clipsOf, foldLayer, makeClip, withClips } from '@/midi/clips';
import type { MidiSong } from '@/midi/smf';
import { rollSession } from './roll';
import { store } from './store';

/**
 * The editing session is the piece that makes the layer strip and the piano roll
 * one editor. What matters is what it does to the *library* — one document, one
 * history, edits written out as soon as a gesture ends — so these tests look at
 * the song that ends up stored, not at the React state drawn from it.
 */

const twoLayerSong = (): MidiSong => ({
  name: 'two layers',
  bpm: 120,
  duration: 2,
  notes: [
    { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
    { note: 67, velocity: 0.8, start: 1, duration: 0.5 },
  ],
  tracks: [
    { name: 'Lead', notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }] },
    { name: 'Bass', notes: [{ note: 67, velocity: 0.8, start: 1, duration: 0.5 }] },
  ],
});

/** A user track the session can edit in place (a demo would become a copy). */
function putUserTrack(song: MidiSong): string {
  const track: Track = {
    id: 'clip:test',
    title: ['Test clip', 'Test clip'],
    composer: 'test',
    song,
    group: 'clip',
  };
  return midiLibrary.put(track);
}

/** The notes of the current track's first layer, in seconds. */
const storedLayer = (index = 0) => midiLibrary.getCurrent()?.song.tracks?.[index].notes ?? [];

describe('editing session', () => {
  beforeEach(() => {
    localStorage.clear();
    putUserTrack(twoLayerSong());
    rollSession.open(0);
  });

  it('opens the requested layer of the current track', () => {
    expect(rollSession.getTrackId()).toBe('clip:test');
    expect(rollSession.getLayerIndex()).toBe(0);
    expect(rollSession.getDoc().notes.map((n) => n.note)).toEqual([60]);
    rollSession.setLayer(1);
    expect(rollSession.getLayerIndex()).toBe(1);
    expect(rollSession.getDoc().notes.map((n) => n.note)).toEqual([67]);
    // An out-of-range layer clamps instead of pointing at nothing.
    rollSession.setLayer(9);
    expect(rollSession.getLayerIndex()).toBe(1);
  });

  it('writes an edit into the track, the player and the undo stack', () => {
    const before = rollSession.getDoc();
    const added = addNote(before, 72, 2, 1);
    rollSession.commit(added.doc, { sync: true });

    // The track keeps its id: a user track is edited, not duplicated.
    expect(rollSession.getTrackId()).toBe('clip:test');
    expect(midiLibrary.getCurrent()?.id).toBe('clip:test');
    expect(rollSession.getState().justCopied).toBe(false);
    // The layer grew, the other layer did not, and the player is playing it.
    expect(storedLayer(0)).toHaveLength(2);
    expect(storedLayer(1)).toHaveLength(1);
    expect(midiPlayer.getSong()?.notes).toHaveLength(3);

    expect(rollSession.getState().canUndo).toBe(true);
    rollSession.undo();
    expect(storedLayer(0)).toHaveLength(1);
    expect(midiPlayer.getSong()?.notes).toHaveLength(2);
    expect(rollSession.getState().canRedo).toBe(true);
    rollSession.redo();
    expect(storedLayer(0)).toHaveLength(2);
  });

  it('edits only the layer it is pointed at', () => {
    rollSession.setLayer(1);
    const bass = rollSession.getDoc();
    rollSession.commit(addNote(bass, 64, 0, 0.5).doc, { sync: true });
    expect(storedLayer(1).map((n) => n.note)).toEqual([64, 67]);
    expect(storedLayer(0).map((n) => n.note)).toEqual([60]);
  });

  it('records one undo step for a drag, however many moves it had', () => {
    const from = rollSession.getDoc();
    const note = from.notes[0];
    // Two live updates (a pointermove each) and one settle (pointerup).
    rollSession.live({ ...from, notes: [{ ...note, start: 0.5 }] });
    rollSession.live({ ...from, notes: [{ ...note, start: 1 }] });
    expect(rollSession.getState().canUndo).toBe(false);
    rollSession.settle(from);
    expect(rollSession.getState().canUndo).toBe(true);
    expect(rollSession.getDoc().notes[0].start).toBe(1);
    rollSession.undo();
    expect(rollSession.getDoc().notes[0].start).toBe(0);
    expect(storedLayer(0)[0].start).toBe(0);
  });

  it('gives a built-in demo a copy to edit, and says so once', () => {
    midiLibrary.setCurrent('demo:arpeggio', { autoplay: false });
    rollSession.open(0);
    const demoCount = rollSession.getDoc().notes.length;
    rollSession.setCopyTitle('Arpeggio · edit');
    rollSession.commit(addNote(rollSession.getDoc(), 60, 0, 0.25).doc, { sync: true });

    const state = rollSession.getState();
    expect(state.justCopied).toBe(true);
    expect(state.copiedName).toBe('Arpeggio · edit');
    const id = rollSession.getTrackId() ?? '';
    expect(id.startsWith('clip:')).toBe(true);
    expect(midiLibrary.getCurrent()?.id).toBe(id);
    expect(storedLayer(0)).toHaveLength(demoCount + 1);
    // Acknowledging clears the flag; a second edit does not make a new copy.
    rollSession.acknowledgeCopy();
    expect(rollSession.getState().justCopied).toBe(false);
    rollSession.commit(addNote(rollSession.getDoc(), 62, 1, 0.25).doc, { sync: true });
    expect(rollSession.getTrackId()).toBe(id);
    expect(rollSession.getState().justCopied).toBe(false);
  });

  it('follows a change made outside the session', () => {
    const id = rollSession.getTrackId();
    // Something else writes a different song to the library: an undo, a share
    // import, a track switch. The document has to follow it.
    midiLibrary.restore(
      [
        {
          id: 'clip:other',
          title: ['Other', 'Other'],
          composer: 'test',
          song: { ...twoLayerSong(), name: 'other' },
          group: 'clip',
        },
      ],
      'clip:other',
    );
    expect(id).not.toBe(rollSession.getTrackId());
    expect(rollSession.getTrackId()).toBe('clip:other');
    expect(rollSession.getDoc().name).toBe('other');
    // …and the undo stack starts over: it belonged to the old document.
    expect(rollSession.getState().canUndo).toBe(false);
  });

  it('keeps the song when an editor syncs the transport', () => {
    midiPlayer.setLayer(0, { muted: true, volume: 0.25, offset: 1.5, pan: -0.5 });
    const before = midiPlayer.getState();
    rollSession.commit(removeNote(rollSession.getDoc(), rollSession.getDoc().notes[0].id), {
      sync: true,
    });
    const layer = midiPlayer.getLayers()[0];
    expect(layer).toMatchObject({ muted: true, volume: 0.25, offset: 1.5, pan: -0.5 });
    // A preview reload must not throw the listener back to the top of the song.
    expect(midiPlayer.getState().time).toBe(before.time);
  });

  it('does not record history for a live update alone', () => {
    const from: RollDoc = rollSession.getDoc();
    rollSession.live(addNote(from, 70, 1, 0.5).doc);
    expect(rollSession.getState().canUndo).toBe(false);
    expect(rollSession.getState().pendingSync).toBe(true);
    // Settling on the same document it already has is not a step either.
    rollSession.settle(rollSession.getDoc());
    expect(rollSession.getState().canUndo).toBe(false);
  });
});

/**
 * Batch edits (P10.1) at the session level: what the *library* ends up holding,
 * and how many undo steps it took to get there.
 */
describe('batch edits and the undo history', () => {
  beforeEach(() => {
    localStorage.clear();
    const song: MidiSong = {
      name: 'chord',
      bpm: 120,
      duration: 2,
      notes: [],
      tracks: [
        {
          name: 'Lead',
          notes: [
            { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
            { note: 64, velocity: 0.8, start: 0, duration: 0.5 },
            { note: 67, velocity: 0.8, start: 0, duration: 0.5 },
          ],
        },
        { name: 'Bass', notes: [{ note: 36, velocity: 0.8, start: 1, duration: 0.5 }] },
      ],
    };
    song.notes = [...song.tracks![0].notes, ...song.tracks![1].notes];
    putUserTrack(song);
    rollSession.open(0);
  });

  const ids = () => rollSession.getDoc().notes.map((n) => n.id);
  const starts = () => storedLayer(0).map((n) => n.start);
  const pitches = (index = 0) => storedLayer(index).map((n) => n.note);

  it('moves a whole selection in one undo step', () => {
    expect(starts()).toEqual([0, 0, 0]);
    rollSession.commit(moveSelection(rollSession.getDoc(), ids(), 1, 2), { sync: true });

    // The three notes moved together: same relative timing, +2 semitones.
    expect(pitches()).toEqual([62, 66, 69]);
    expect(starts()).toEqual([0.5, 0.5, 0.5]);
    // The other layer is untouched, and the song still has both layers.
    expect(pitches(1)).toEqual([36]);
    expect(midiLibrary.getCurrent()?.song.tracks).toHaveLength(2);

    // Exactly one step back, and everything is where it was.
    expect(rollSession.getState().canUndo).toBe(true);
    rollSession.undo();
    expect(pitches()).toEqual([60, 64, 67]);
    expect(starts()).toEqual([0, 0, 0]);
    expect(rollSession.getState().canUndo).toBe(false);
  });

  it('deletes a selection in one undo step', () => {
    rollSession.commit(removeSelection(rollSession.getDoc(), ids().slice(0, 2)), { sync: true });
    expect(pitches()).toEqual([67]);
    expect(midiPlayer.getSong()?.notes).toHaveLength(2); // 67 + the bass note
    rollSession.undo();
    expect(pitches()).toEqual([60, 64, 67]);
    // One pop, not three.
    expect(rollSession.getState().canUndo).toBe(false);
  });

  it('pastes a copied group as one undo step, with fresh ids', () => {
    const originals = ids().slice(0, 2);
    const clip = copySelection(rollSession.getDoc(), originals)!;
    let seed = 0;
    const pasted = pasteSelection(rollSession.getDoc(), clip, 2, () => `copy${(seed += 1)}`);
    rollSession.commit(pasted.doc, { sync: true });

    expect(pitches()).toEqual([60, 64, 67, 60, 64]);
    // The copies are new notes, so editing them cannot move the originals.
    expect(pasted.selection.every((id) => !originals.includes(id))).toBe(true);
    rollSession.commit(moveSelection(rollSession.getDoc(), pasted.selection, 0, 5), { sync: true });
    expect(pitches()).toEqual([60, 64, 67, 65, 69]);
    rollSession.undo();
    expect(pitches()).toEqual([60, 64, 67, 60, 64]);
    rollSession.undo();
    expect(pitches()).toEqual([60, 64, 67]);
    expect(rollSession.getState().canUndo).toBe(false);
  });

  it('scales a selection as one undo step', () => {
    // At 120 BPM one beat is 0.5 s, so scaling the three quarter-second notes
    // out to beat 4 gives each a two-second end.
    rollSession.commit(scaleSelection(rollSession.getDoc(), ids(), 4), { sync: true });
    expect(storedLayer(0).map((n) => n.start + n.duration)).toEqual([2, 2, 2]);
    rollSession.undo();
    expect(storedLayer(0).map((n) => n.start + n.duration)).toEqual([0.5, 0.5, 0.5]);
    expect(rollSession.getState().canUndo).toBe(false);
  });

  it('quantises a selection in one undo step', () => {
    // Put the group slightly off the grid first; that is its own step, so the
    // quantise is the one under test.
    // 0.1 beat is 0.05 s at 120 BPM, which is what the library stores.
    rollSession.commit(moveSelection(rollSession.getDoc(), ids(), 0.1, 0), { sync: true });
    expect(starts()).toEqual([0.05, 0.05, 0.05]);
    rollSession.commit(quantizeSelection(rollSession.getDoc(), ids(), 0.25), { sync: true });
    expect(starts()).toEqual([0, 0, 0]);
    // One pop returns the off-grid document with the earlier step still there…
    rollSession.undo();
    expect(starts()).toEqual([0.05, 0.05, 0.05]);
    expect(rollSession.getState().canUndo).toBe(true);
    // …and the second pop is the nudge that made it off-grid.
    rollSession.undo();
    expect(starts()).toEqual([0, 0, 0]);
    expect(rollSession.getState().canUndo).toBe(false);
  });

  it('cannot leak a batch edit across layers', () => {
    // The cross-layer decision (P10.1) is "refuse, visibly" rather than
    // implement, so a batch edit on layer 0 has to leave layer 1 identical,
    // whatever the selection contains.
    const bass = storedLayer(1).map((n) => ({ ...n }));
    rollSession.commit(moveSelection(rollSession.getDoc(), ids(), 2, 7), { sync: true });
    expect(storedLayer(1)).toEqual(bass);
    // …and the session stays pointed at the layer it was editing.
    expect(rollSession.getLayerIndex()).toBe(0);
    expect(pitches()).toEqual([67, 71, 74]);
    rollSession.setLayer(1);
    expect(pitches(1)).toEqual([36]);
  });

  it('settles a multi-step gesture as one step from the pre-gesture document', () => {
    const from = rollSession.getDoc();
    const group = from.notes.map((n) => n.id);
    const base = moveSelection(from, group, 1, 0);
    // Two live updates, as a drag emits them…
    rollSession.live(moveSelection(base, group, 1, 0));
    rollSession.live(moveSelection(base, group, 2, 0));
    expect(rollSession.getState().canUndo).toBe(false);
    // …then the gesture settles: the result is rebuilt from the pre-drag
    // document, and one undo takes the whole group home.
    rollSession.applyGesture(from, (before) => moveSelection(before, group, 2, 0));
    expect(starts()).toEqual([1, 1, 1]);
    expect(rollSession.getState().canUndo).toBe(true);
    rollSession.undo();
    expect(starts()).toEqual([0, 0, 0]);
    expect(rollSession.getState().canUndo).toBe(false);
  });
});

describe('editing a clip', () => {
  const arranged = (): MidiSong => {
    const clip = makeClip('loop', [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }], {
      start: 0,
      length: 1,
      repeat: 3,
    });
    return withClips(twoLayerSong(), [clip]);
  };

  it('edits the clip a layer is arranged with, and re-expands it', () => {
    putUserTrack(arranged());
    rollSession.open(0);
    // The session is pointed at the clip, not at the expansion: its document is
    // the material, which is where an edit belongs.
    expect(rollSession.getState().clipId).not.toBeNull();
    expect(rollSession.getDoc().notes.map((n) => n.note)).toEqual([60]);
    expect(storedLayer(0).map((n) => n.note)).toEqual([60, 60, 60]);

    rollSession.commit(addNote(rollSession.getDoc(), 72, 0, 0.5).doc, { sync: true });
    // The clip grew, so every repeat grew with it…
    expect(storedLayer(0).map((n) => n.note)).toEqual([60, 72, 60, 72, 60, 72]);
    rollSession.undo();
    expect(storedLayer(0).map((n) => n.note)).toEqual([60, 60, 60]);
  });

  it('follows the layer when there is no arrangement', () => {
    putUserTrack(twoLayerSong());
    rollSession.open(0);
    expect(rollSession.getState().clipId).toBeNull();
    expect(rollSession.getDoc().notes).toHaveLength(1);
  });

  it('keeps the other layers playing when one is arranged', () => {
    const song = twoLayerSong();
    song.notes = [...song.tracks![0].notes, ...song.tracks![1].notes];
    const folded = foldLayer(song, 0, { name: 'Lead', bpm: 120 });
    putUserTrack(folded.song);
    rollSession.open(0);
    expect(rollSession.getState().clipId).toBe(folded.clip.id);
    // The bass layer has no clips, so its note is still the layer's own.
    expect(storedLayer(1).map((n) => n.note)).toEqual([67]);
  });
});

/**
 * P10.2: the arrangement is portable, and editing inside a clip stays a *plan*
 * edit.
 *
 * The model-level equalities are in `midi/clips.test.ts`; what these cases pin
 * down is the session: one user action is one undo step, the copy is written to
 * the library and played, and a clip edit never rewrites the take it was folded
 * from (P10.3's rule — the clip is the plan, the take is the material).
 */
describe('clips across layers and templates', () => {
  const arranged = (): { song: MidiSong; clipId: string } => {
    const base = twoLayerSong();
    base.takes = [{ id: 'takeA', name: 'Take A', layer: 0, notes: base.tracks![0].notes.map((n) => ({ ...n })) }];
    base.takeId = 'takeA';
    const folded = foldLayer(base, 0, { name: 'Lead', bpm: 120 });
    return { song: folded.song, clipId: folded.clip.id };
  };

  it('copies a clip to another layer, keeps both, and undoes in one store step', () => {
    const { song, clipId } = arranged();
    putUserTrack(song);
    rollSession.open(0);
    const laid = rollSession.copyToLayer(clipId, 1);
    expect(laid).not.toBeNull();
    // The copy is the document now, and the copy landed on layer 1.
    expect(rollSession.getLayerIndex()).toBe(1);
    expect(rollSession.getState().clipId).toBe(laid);
    expect(rollSession.clip(laid!)?.layer).toBe(1);

    const stored = midiLibrary.getCurrent()!.song;
    expect(clipsOf(stored)).toHaveLength(2);
    // Both layers now play the figure — the same notes, twice.
    expect(stored.tracks![0].notes.map((n) => n.note)).toEqual([60]);
    expect(stored.tracks![1].notes.map((n) => n.note)).toEqual([60]);

    // An arrangement change is one *app-wide* undo step (`store`), which is the
    // history the strip and the roll both live in; the session's own stack is
    // for note edits, exactly as it was for move/repeat/resize before this.
    // Exactly one step: one undo removes the copy and leaves the source layer
    // playing exactly as it did.
    expect(store.undo()).toBe(true);
    expect(clipsOf(midiLibrary.getCurrent()!.song)).toHaveLength(1);
    expect(midiLibrary.getCurrent()!.song.tracks![1].notes).toEqual(song.tracks![1].notes);
    store.redo();
    expect(clipsOf(midiLibrary.getCurrent()!.song)).toHaveLength(2);
  });

  it('applies a template as a new clip without touching the clip it came from', () => {
    const { song, clipId } = arranged();
    putUserTrack(song);
    rollSession.open(0);
    const source = rollSession.clip(clipId)!;
    const template = store.saveClipTemplate(source, 'Figure');
    expect(template.notes).toEqual(source.notes);
    expect(template.notes).not.toBe(source.notes);

    const applied = rollSession.applyTemplate(template, 1);
    expect(applied).not.toBeNull();
    expect(rollSession.getLayerIndex()).toBe(1);
    const stored = midiLibrary.getCurrent()!.song;
    expect(clipsOf(stored)).toHaveLength(2);
    // The applied clip is the document; editing every note of it must leave the
    // template — and the clip it was captured from — exactly as they were.
    const doc = rollSession.getDoc();
    rollSession.commit(
      { ...doc, notes: doc.notes.map((note) => ({ ...note, note: 36 })) },
      { sync: true },
    );
    const after = midiLibrary.getCurrent()!.song;
    expect(clipsOf(after).find((clip) => clip.id === clipId)!.notes.map((n) => n.note)).toEqual([60]);
    expect(clipsOf(after).find((clip) => clip.id === applied)!.notes.map((n) => n.note)).toEqual([36]);
    expect(store.getSnapshot().layout.clipTemplates[0].notes.map((n) => n.note)).toEqual([60]);
  });

  it('follows a clip onto its own layer when the strip selects it', () => {
    // The strip draws every layer's lanes at once, so a block on another layer
    // has to take the session to that layer as well as to the clip: otherwise
    // the new clip's notes would be drawn against the old layer's rows (P10.2).
    const { song, clipId } = arranged();
    putUserTrack(song);
    rollSession.open(0);
    const applied = rollSession.applyTemplate(
      store.saveClipTemplate(rollSession.clip(clipId)!, 'Figure'),
      1,
    )!;
    expect(rollSession.getLayerIndex()).toBe(1);
    // Selecting the original's block by hand returns the session to layer 0…
    rollSession.setClip(clipId, rollSession.clip(clipId)!.layer);
    expect(rollSession.getLayerIndex()).toBe(0);
    expect(rollSession.getDoc().notes.map((n) => n.note)).toEqual([60]);
    // …and back to the applied one, without inventing a second document.
    rollSession.setClip(applied, 1);
    expect(rollSession.getLayerIndex()).toBe(1);
    expect(rollSession.getState().clipId).toBe(applied);
  });

  it('edits inside a clip as exactly one undo step, and never rewrites the take', () => {
    const { song, clipId } = arranged();
    putUserTrack(song);
    rollSession.open(0);
    const before = rollSession.getDoc();
    const note = before.notes[0];
    // A batch move of the whole selection, applied through the session the way
    // P10.1's marquee drag does: one commit, one document replacement.
    rollSession.commit(
      moveSelection(before, [note.id], 1, 2),
      { sync: true },
    );
    expect(rollSession.getState().canUndo).toBe(true);

    const arrangedSong = midiLibrary.getCurrent()!.song;
    // The clip's own material moved…
    const clip = clipsOf(arrangedSong).find((entry) => entry.id === clipId)!;
    expect(clip.notes[0].start).toBeGreaterThan(note.start);
    expect(clip.notes[0].note).toBe(note.note + 2);
    // …and the layer plays the moved figure.
    expect(arrangedSong.tracks![0].notes.map((n) => n.note)).toEqual([62]);
    // …while the take it was folded from is untouched: the clip is the plan,
    // the take is the material (P10.3, `syncTakeFromLayer`).
    expect(arrangedSong.takes![0].notes.map((n) => n.note)).toEqual([60]);
    expect(arrangedSong.takes![0].notes[0]).toEqual({ note: 60, velocity: 0.8, start: 0, duration: 0.5 });

    // One edit, one undo step: one undo puts the whole figure back.
    rollSession.undo();
    expect(clipsOf(midiLibrary.getCurrent()!.song).find((entry) => entry.id === clipId)!.notes[0].start).toBe(
      note.start,
    );
    expect(rollSession.getState().canUndo).toBe(false);
    // …and the take is still the performance it always was.
    expect(midiLibrary.getCurrent()!.song.takes![0].notes[0].start).toBe(0);
  });
});
