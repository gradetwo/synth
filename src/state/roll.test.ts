import { beforeEach, describe, expect, it } from 'vitest';
import { midiLibrary, type Track } from '@/midi/library';
import { midiPlayer } from '@/midi/player';
import { addNote, removeNote, type RollDoc } from '@/midi/roll';
import type { MidiSong } from '@/midi/smf';
import { rollSession } from './roll';

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
