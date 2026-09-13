/**
 * Recorded takes and overdubbing (P5.4).
 *
 * The acceptance criteria for this batch are behavioural: an overdub must not
 * lose what was already there, switching take must change what the player and
 * every export see, the list must have a bound, and a take must survive a
 * round trip through storage. Each of those is one case here, plus the
 * same-pitch rule the model has to pick a side on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TAKE_MAX_PER_LAYER, normalizeTakes, type MidiTake } from './takes';
import {
  TAKE_RESTRIKE,
  activeTake,
  activeTakeOfLayer,
  layerFoldedIntoClips,
  mergeNotes,
  mergeNotesOverwrite,
  mergeTakes,
  overdubTake,
  removeTake,
  renameTake,
  syncTakeFromLayer,
  takesOf,
  takesOfLayer,
  withTakes,
} from './take-edit';
import { foldLayer } from './clips';
import { writeMidi, type MidiNote, type MidiSong } from './smf';

const note = (n: number, start: number, duration = 0.5, velocity = 0.8): MidiNote => ({
  note: n,
  velocity,
  start,
  duration,
});

const song = (notes: MidiNote[], extra: Partial<MidiSong> = {}): MidiSong => ({
  name: 'test',
  bpm: 120,
  duration: 4,
  notes,
  ...extra,
});

const key = (note: MidiNote) => `${note.note}@${note.start.toFixed(4)}/${note.duration.toFixed(4)}`;

beforeEach(() => {
  localStorage.clear();
});

describe('overdub', () => {
  it('keeps every note that was already there', () => {
    const bed = song([note(60, 0), note(64, 1)]);
    const { song: next, take } = overdubTake(bed, 0, [note(67, 2)], { name: 'Take 2' });

    // The new take is the union, and the take it grew out of is still there.
    expect(take.notes.map(key)).toEqual(['60@0.0000/0.5000', '64@1.0000/0.5000', '67@2.0000/0.5000']);
    expect(next.notes.map(key)).toEqual(take.notes.map(key));
    expect(takesOf(next)).toHaveLength(1);
    const second = overdubTake(next, 0, [note(72, 3)], { name: 'Take 3' });
    expect(takesOf(second.song)).toHaveLength(2);
    expect(second.take.notes.map(key)).toEqual([
      '60@0.0000/0.5000',
      '64@1.0000/0.5000',
      '67@2.0000/0.5000',
      '72@3.0000/0.5000',
    ]);
  });

  it('replaces a re-strike of the same pitch instead of doubling it', () => {
    // The second pass plays the same line again: the incoming note is the one
    // that sounds, because keeping both would add the velocities and flam the
    // attack every time round.
    const merged = mergeNotes([note(60, 1, 0.5, 0.4)], [note(60, 1 + TAKE_RESTRIKE / 2, 0.25, 0.9)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ note: 60, velocity: 0.9, start: 1 + TAKE_RESTRIKE / 2, duration: 0.25 });
  });

  it('keeps the same pitch at a clearly different time, and different pitches together', () => {
    const merged = mergeNotes([note(60, 0, 0.5, 0.5)], [note(60, 1, 0.5, 0.5), note(64, 0, 0.5, 0.5)]);
    // A repeat (a second later) and a chord (a second pitch now) both survive.
    expect(merged.map(key)).toEqual(['60@0.0000/0.5000', '64@0.0000/0.5000', '60@1.0000/0.5000']);
  });

  it('lays the new pass over the selected take, not over the layer', () => {
    // Two takes exist; the second is selected. Overdubbing grows out of the
    // selected one, which is what "the take I am hearing" means.
    const first = overdubTake(song([note(60, 0)]), 0, [], { name: 'Take 1' });
    const second = overdubTake(first.song, 0, [note(64, 1)], { name: 'Take 2' });
    const back = withTakes(second.song, takesOf(second.song), first.take.id);
    const grown = overdubTake(back, 0, [note(67, 2)], { name: 'Take 3' });
    expect(grown.take.notes.map(key)).toEqual(['60@0.0000/0.5000', '67@2.0000/0.5000']);
  });

  it('retires the oldest take at the cap instead of refusing the recording', () => {
    let current = song([note(60, 0)]);
    const ids: string[] = [];
    for (let pass = 0; pass < TAKE_MAX_PER_LAYER + 1; pass += 1) {
      const grown = overdubTake(current, 0, [note(60 + pass, pass + 1)], { name: `Take ${pass}` });
      current = grown.song;
      ids.push(grown.take.id);
    }
    const kept = takesOfLayer(takesOf(current), 0);
    expect(kept).toHaveLength(TAKE_MAX_PER_LAYER);
    expect(kept.map((take) => take.id)).not.toContain(ids[0]);
    expect(kept.map((take) => take.id)).toContain(ids[ids.length - 1]);
    // The newest pass stays selected: the recording that just ended is never
    // the one that gets thrown away.
    expect(activeTake(current)?.id).toBe(ids[ids.length - 1]);
  });
});

describe('the selected take drives the song', () => {
  it('writes the selected take into its layer, and only that layer', () => {
    const twoLayers = song([note(60, 0)], {
      tracks: [
        { name: 'lead', notes: [note(60, 0)] },
        { name: 'bass', notes: [note(36, 0)] },
      ],
      notes: [note(60, 0), note(36, 0)],
    });
    const first = overdubTake(twoLayers, 0, [note(64, 1)], { name: 'A' });
    const second = overdubTake(first.song, 0, [note(67, 2)], { name: 'B' });

    const back = withTakes(second.song, takesOf(second.song), first.take.id);
    expect(back.tracks?.[0].notes.map((n) => n.note)).toEqual([60, 64]);
    // The other layer is untouched: a take belongs to the layer it was recorded
    // on, and switching take never silences a different one.
    expect(back.tracks?.[1].notes.map((n) => n.note)).toEqual([36]);
    expect(back.notes.map((n) => n.note)).toEqual([36, 60, 64]);
    expect(activeTakeOfLayer(back, 0)?.name).toBe('A');
    expect(activeTakeOfLayer(back, 1)).toBeNull();
  });

  it('changes the notes and the exported bytes a switch hands to the writer', () => {
    const first = overdubTake(song([note(60, 0)]), 0, [], { name: 'A' });
    const second = overdubTake(first.song, 0, [note(67, 2)], { name: 'B' });
    const asA = withTakes(second.song, takesOf(second.song), first.take.id);
    const asB = withTakes(second.song, takesOf(second.song), second.take.id);

    expect(asA.notes.map((n) => n.note)).toEqual([60]);
    expect(asB.notes.map((n) => n.note)).toEqual([60, 67]);
    // What every export goes through: the same flat note list, so the bytes
    // differ exactly as the performances do.
    const bytesA = writeMidi(asA.notes, { bpm: 120, name: 't' });
    const bytesB = writeMidi(asB.notes, { bpm: 120, name: 't' });
    expect(Buffer.from(bytesA).equals(Buffer.from(bytesB))).toBe(false);
    // And the song keeps both takes, so the switch is reversible.
    expect(takesOf(asB)).toHaveLength(2);
  });

  it('drops the take fields when the last take goes', () => {
    const grown = overdubTake(song([note(60, 0)]), 0, [note(64, 1)]);
    const stripped = withTakes(grown.song, [], undefined);
    expect(stripped.takes).toBeUndefined();
    expect(stripped.takeId).toBeUndefined();
    expect(stripped.tracks?.[0].notes.map((n) => n.note)).toEqual([60, 64]);
  });

  it('writes a piano-roll edit back into the selected take', () => {
    // The roll edits tracks[].notes; while a take is selected those notes are
    // the take's, so a save has to land in the take too — otherwise switching
    // away and back would re-apply the take from before the edit.
    const grown = overdubTake(song([note(60, 0)]), 0, [note(64, 1)], { name: 'A' });
    const edited: MidiSong = {
      ...grown.song,
      tracks: [{ name: 'Track 1', notes: [note(60, 0), note(65, 1)] }],
    };
    const synced = syncTakeFromLayer(edited);
    expect(takesOf(synced)[0].notes.map((n) => n.note)).toEqual([60, 65]);
    // Re-expanding from the stored takes now reproduces the edit, which is what
    // a reload does.
    const reloaded = withTakes(synced, takesOf(synced), synced.takeId);
    expect(reloaded.notes.map((n) => n.note)).toEqual([60, 65]);
  });
});

describe('a layer folded into clips (P10.3)', () => {
  it('is detected, and switching take there does not change what plays', () => {
    const grown = overdubTake(song([note(60, 0)]), 0, [note(64, 1)], { name: 'A' });
    const folded = foldLayer(grown.song, 0, { bpm: 120 });
    expect(layerFoldedIntoClips(folded.song, 0)).toBe(true);
    expect(layerFoldedIntoClips(folded.song, 1)).toBe(false);
    expect(layerFoldedIntoClips(song([note(60, 0)]), 0)).toBe(false);

    // The clips expand last, so a take selected on that layer is discarded in
    // the same call: this is the silent no-op P10.3 refuses to keep.
    const other: MidiTake = { id: 't2', name: 'B', layer: 0, notes: [note(72, 0)] };
    const switched = withTakes({ ...folded.song, takes: [other], takeId: 't2' }, [other], 't2');
    expect(switched.takeId).toBe('t2');
    expect(switched.notes.map((n) => n.note)).toEqual([60, 64]);
    expect(switched.tracks?.[0].notes.map((n) => n.note)).toEqual([60, 64]);
  });

  it('keeps a clip the user built by hand out of the take rebuild', () => {
    // A clip's window is the user's plan: folding rounds it up to a bar and the
    // expansion trims at the window edge. Rebuilding from a take would have to
    // guess which clip to rewrite and would silently drop that edit — the
    // second reason the take stays material instead of becoming a source.
    const folded = foldLayer(song([note(60, 0, 3)]), 0, { bpm: 120 });
    const clip = folded.clip;
    expect(clip.length).toBeGreaterThan(2.5);
    expect(folded.song.notes[0].duration).toBe(3);
    const cut = { ...folded.song, clips: [{ ...clip, length: 1 }] };
    const trimmed = withTakes(cut, [{ id: 't2', name: 'B', layer: 0, notes: [note(72, 0)] }], 't2');
    // The window still decides: the 3 s note is trimmed to the 1 s window and
    // the take's 72 is nowhere.
    expect(trimmed.notes.map((n) => n.note)).toEqual([60]);
    expect(trimmed.notes[0].duration).toBeCloseTo(1, 6);
  });
});

describe('merging and deleting', () => {
  it('merges the layer into one take that plays everything', () => {
    const first = overdubTake(song([note(60, 0)]), 0, [], { name: 'A' });
    const second = overdubTake(first.song, 0, [note(64, 1)], { name: 'B' });
    const third = overdubTake(second.song, 0, [note(67, 2)], { name: 'C' });

    const { takes, take } = mergeTakes(takesOf(third.song), 0, { name: 'Merged' });
    expect(take).not.toBeNull();
    expect(takes).toHaveLength(1);
    expect(take!.notes.map((n) => n.note)).toEqual([60, 64, 67]);
    const merged = withTakes(third.song, takes, take!.id);
    expect(merged.notes.map((n) => n.note)).toEqual([60, 64, 67]);
  });

  it('is a no-op with fewer than two takes', () => {
    const one = overdubTake(song([note(60, 0)]), 0, []);
    const before = takesOf(one.song);
    expect(mergeTakes(before, 0, {}).take).toBeNull();
    expect(mergeTakes(before, 0, {}).takes).toBe(before);
  });

  it('overwrite lets a newer take replace the older material it plays over (P10.3)', () => {
    // Two alternates of the same bars, built by hand so the clash is explicit:
    // A plays a C and then an E; B plays a D at the same moment as the C.
    const takes: MidiTake[] = [
      { id: 'a', name: 'A', layer: 0, notes: [note(60, 0), note(64, 1)] },
      { id: 'b', name: 'B', layer: 0, notes: [note(62, 0)] },
    ];
    const union = mergeTakes(takes, 0, { strategy: 'union' });
    expect(union.take!.notes.map(key)).toEqual([
      '60@0.0000/0.5000',
      '62@0.0000/0.5000',
      '64@1.0000/0.5000',
    ]);
    const overwritten = mergeTakes(takes, 0, { strategy: 'overwrite' });
    // B sounds at 0.0, so A's C there is replaced; A's E at 1.0 is untouched.
    expect(overwritten.take!.notes.map(key)).toEqual(['62@0.0000/0.5000', '64@1.0000/0.5000']);
    // Both strategies consume the alternates into exactly one take.
    expect(union.takes).toHaveLength(1);
    expect(overwritten.takes).toHaveLength(1);
    // Union is the default, so a caller that does not choose keeps the old rule.
    expect(mergeTakes(takes, 0, {}).take!.notes.map(key)).toEqual(union.take!.notes.map(key));
  });

  it('overwrite counts a touching edge as clear, not as a clash', () => {
    // A ends exactly where B begins: that is a repeat, so both survive.
    const merged = mergeNotesOverwrite([note(60, 0, 0.5)], [note(64, 0.5, 0.5)]);
    expect(merged.map(key)).toEqual(['60@0.0000/0.5000', '64@0.5000/0.5000']);
  });

  it('falls back to the newest take left, and keeps the notes when none is', () => {
    const first = overdubTake(song([note(60, 0)]), 0, [], { name: 'A' });
    const second = overdubTake(first.song, 0, [note(64, 1)], { name: 'B' });

    const oneLeft = removeTake(takesOf(second.song), second.take.id, second.take.id);
    expect(oneLeft.takeId).toBe(first.take.id);
    expect(oneLeft.takes).toHaveLength(1);

    const noneLeft = removeTake(takesOf(second.song), first.take.id, first.take.id);
    expect(noneLeft.takeId).toBe(second.take.id);

    // Deleting something that is not selected leaves the selection alone.
    const other = removeTake(takesOf(second.song), first.take.id, second.take.id);
    expect(other.takeId).toBe(second.take.id);
  });

  it('renames without touching the notes', () => {
    const grown = overdubTake(song([note(60, 0)]), 0, [note(64, 1)]);
    const renamed = renameTake(takesOf(grown.song), grown.take.id, '  verse  ');
    expect(renamed[0].name).toBe('verse');
    expect(renameTake(renamed, grown.take.id, '   ')[0].name).toBe('verse');
  });
});

describe('stored takes', () => {
  it('drops broken entries and empties, and keeps the newest at the cap', () => {
    const many = Array.from({ length: TAKE_MAX_PER_LAYER + 3 }, (_, index) => ({
      id: `t${index}`,
      name: `T${index}`,
      layer: 0,
      notes: [note(60 + index, index)],
    }));
    const raw = [
      ...many,
      { id: 'empty', name: 'empty', layer: 0, notes: [] },
      { id: 'junk', name: 'junk', layer: 0, notes: 'not notes' },
      null,
      { id: 't1', name: 'duplicate id', layer: 0, notes: [note(60, 0)] },
    ];
    const out = normalizeTakes(raw);
    expect(out).toHaveLength(TAKE_MAX_PER_LAYER);
    expect(out.map((take) => take.id)).toEqual(
      Array.from({ length: TAKE_MAX_PER_LAYER }, (_, index) => `t${index + 3}`),
    );
    // A broken note inside an otherwise fine take is dropped, not the take.
    const partly = normalizeTakes([
      { id: 'p', name: 'p', layer: 0, notes: [{ note: 60, velocity: 0.5, start: 0, duration: 0.5 }, { note: 61 }] },
    ]);
    expect(partly[0].notes).toHaveLength(1);
  });

  it('keeps the takes, the selection and the notes across a reload', async () => {
    const { wrap } = await import('@/state/persist');
    const grown = overdubTake(song([note(60, 0)]), 0, [note(64, 1)], { name: 'A' });
    const second = overdubTake(grown.song, 0, [note(67, 2)], { name: 'B' });
    localStorage.setItem(
      'gs1:library:v1',
      JSON.stringify(
        wrap({
          tracks: [
            {
              id: 'clip:1',
              title: ['mine', 'mine'],
              composer: 'GS-1',
              group: 'clip',
              song: second.song,
            },
          ],
          currentId: 'clip:1',
        }),
      ),
    );
    vi.resetModules();
    const { MidiLibrary } = await import('./library');
    const reloaded = new MidiLibrary().getCurrent()!;
    expect(reloaded.song.takes).toHaveLength(2);
    expect(reloaded.song.takeId).toBe(second.take.id);
    expect(reloaded.song.notes.map((n) => n.note)).toEqual([60, 64, 67]);

    // Selecting the older take after the reload brings back the older
    // performance, which is the whole point of keeping them.
    const back = withTakes(reloaded.song, takesOf(reloaded.song), grown.take.id);
    expect(back.notes.map((n) => n.note)).toEqual([60, 64]);
  });
});
