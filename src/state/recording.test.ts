/**
 * The recording commit path (P5.4).
 *
 * `midi/takes.ts` covers the model; this covers what the panel actually calls:
 * a finished pass lands on the current track as a take, immediately on disk,
 * and switching, merging and deleting are one undo step each, because all four
 * write the same document the app-level undo already restores.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { foldLayer } from '@/midi/clips';
import { midiLibrary } from '@/midi/library';
import type { MidiNote } from '@/midi/smf';
import { layerFoldedIntoClips, takesOf } from '@/midi/take-edit';
import { store } from '@/state/store';
import {
  deleteTake,
  mergeLayerTakes,
  renameTake,
  saveRecordingTake,
  selectTake,
} from './recording';

const LIBRARY_KEY = 'gs1:library:v1';

const note = (n: number, start: number, duration = 0.5, velocity = 0.8): MidiNote => ({
  note: n,
  velocity,
  start,
  duration,
});

/** The takes as they were written to storage, not just as they sit in memory. */
const storedTakes = (): { id: string; name: string }[] => {
  const raw = localStorage.getItem(LIBRARY_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw) as {
    data: { tracks: { id: string; song: { takes?: { id: string; name: string }[] } }[] };
  };
  return data.data.tracks.flatMap((track) => track.song.takes ?? []);
};

/** A fresh two-note track of the user's own, selected in the library. */
function seedTrack(): void {
  midiLibrary.put({
    id: 'clip:seed',
    title: ['seed', 'seed'],
    composer: 'GS-1',
    group: 'clip',
    song: { name: 'seed', bpm: 120, duration: 1, notes: [note(60, 0)] },
  });
}

beforeEach(() => {
  localStorage.clear();
  seedTrack();
});

describe('recording into takes', () => {
  it('saves a pass as a take over what is already there, on disk at once', () => {
    const first = saveRecordingTake([note(64, 1)], { grid: 'off' });
    expect(first).not.toBeNull();
    const song = midiLibrary.getCurrent()!.song;
    expect(takesOf(song)).toHaveLength(1);
    expect(song.notes.map((n) => n.note)).toEqual([60, 64]);
    // Written straight away: a reload reads the take back (midi/takes.test.ts
    // pins the read side; here it is the write side).
    expect(storedTakes()).toHaveLength(1);

    // A second pass overdubs the first: both takes, three notes in the selected
    // one.
    const second = saveRecordingTake([note(67, 2)], { grid: 'off' });
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(2);
    expect(second!.notes.map((n) => n.note)).toEqual([60, 64, 67]);
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual([60, 64, 67]);
  });

  it('follows the quantise setting, exactly as the old recorder did', () => {
    // 120 BPM, 1/16 grid: one sixteenth is 0.125 s, so a note played 0.2 s
    // after the first lands on the grid line at 0.25 s.
    const take = saveRecordingTake([note(60, 0), note(64, 0.2)], { grid: '1/16' });
    expect(take!.notes[1].start).toBeCloseTo(0.25, 6);
  });

  it('switches take, merges and deletes, and each is one undo step', () => {
    const first = saveRecordingTake([note(64, 1)], { grid: 'off' })!;
    const second = saveRecordingTake([note(67, 2)], { grid: 'off' })!;
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual([60, 64, 67]);

    // Undo the second recording: the first take is what is left.
    expect(store.undo()).toBe(true);
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(1);
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual([60, 64]);
    expect(store.redo()).toBe(true);
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual([60, 64, 67]);

    // Switching take is a document change like any other: undo brings the
    // selection back.
    selectTake(first.id);
    expect(midiLibrary.getCurrent()!.song.takeId).toBe(first.id);
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual([60, 64]);
    store.undo();
    expect(midiLibrary.getCurrent()!.song.takeId).toBe(second.id);

    // Merge, then undo it: the alternates come back.
    mergeLayerTakes();
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(1);
    store.undo();
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(2);

    // Delete, then undo it: the same.
    const current = midiLibrary.getCurrent()!.song;
    deleteTake(current.takeId!);
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(1);
    store.undo();
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(2);
  });

  it('records nothing when there is nothing to save', () => {
    expect(saveRecordingTake([], { grid: 'off' })).toBeNull();
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(0);
  });
});

describe('takes on the take row (P10.3)', () => {
  it('renames in one undo step, on disk, without touching the notes', () => {
    const take = saveRecordingTake([note(64, 1)], { grid: 'off' })!;
    const before = takesOf(midiLibrary.getCurrent()!.song)[0];
    expect(renameTake(take.id, '  verse  ')).toBe(true);
    const renamed = takesOf(midiLibrary.getCurrent()!.song)[0];
    expect(renamed.name).toBe('verse');
    expect(renamed.notes.map((n) => n.note)).toEqual(before.notes.map((n) => n.note));
    expect(storedTakes()[0].name).toBe('verse');

    // One undo takes it back, including the id and the notes.
    expect(store.undo()).toBe(true);
    const back = takesOf(midiLibrary.getCurrent()!.song)[0];
    expect(back.name).toBe(before.name);
    expect(back.notes.map((n) => n.note)).toEqual(before.notes.map((n) => n.note));

    // An empty or unchanged name is not an edit at all.
    expect(renameTake(take.id, '   ')).toBe(false);
    expect(renameTake(take.id, before.name)).toBe(false);
    expect(storedTakes()[0].name).toBe(before.name);
  });

  it('merges with either strategy, and the two produce different takes', () => {
    // A branched history, the only shape where the two merges differ: take 2
    // grows from take 1, then take 3 grows from take 1 again, so each holds a
    // note the other does not, played at the same moment.
    const first = saveRecordingTake([note(64, 0.01, 0.12)], { grid: 'off' })!;
    saveRecordingTake([note(67, 0.01, 0.12)], { grid: 'off' });
    selectTake(first.id);
    saveRecordingTake([note(71, 0.01, 0.12)], { grid: 'off' });

    mergeLayerTakes('union');
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(1);
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual([60, 64, 67, 71]);
    store.undo();

    mergeLayerTakes('overwrite');
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(1);
    // The newest pass plays at ~0.01 s, so the older 64 and 67 there are gone.
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual([60, 64, 71]);
    store.undo();
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(3);
  });

  it('refuses to switch or merge on a folded layer, and changes nothing', () => {
    const first = saveRecordingTake([note(64, 1)], { grid: 'off' })!;
    const second = saveRecordingTake([note(67, 2)], { grid: 'off' })!;
    const before = midiLibrary.getCurrent()!;
    midiLibrary.put({ ...before, song: foldLayer(before.song, 0, { bpm: 120 }).song });
    const folded = midiLibrary.getCurrent()!;
    expect(layerFoldedIntoClips(folded.song, 0)).toBe(true);
    const playing = folded.song.notes.map((n) => n.note);

    // The switch is refused, not performed silently: the selection, the clips
    // expansion and the take list all stay exactly as they were.
    expect(selectTake(first.id)).toBe(false);
    expect(midiLibrary.getCurrent()!.song.takeId).toBe(second.id);
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual(playing);

    mergeLayerTakes('union');
    expect(takesOf(midiLibrary.getCurrent()!.song)).toHaveLength(2);
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual(playing);

    // Renaming is material, not arrangement, so it is still allowed there.
    expect(renameTake(second.id, 'material')).toBe(true);
    expect(takesOf(midiLibrary.getCurrent()!.song).map((t) => t.name)).toContain('material');
    expect(midiLibrary.getCurrent()!.song.notes.map((n) => n.note)).toEqual(playing);
  });
});
