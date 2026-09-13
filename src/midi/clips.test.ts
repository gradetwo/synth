import { describe, expect, it } from 'vitest';
import type { MidiNote, MidiSong } from './smf';
import {
  CLIP_MAX_REPEAT,
  clipAt,
  clipsOf,
  clipsOfLayer,
  clipWithNotes,
  copyClipToLayer,
  duplicateClip,
  expandClips,
  foldClipsInto,
  foldLayer,
  makeClip,
  moveClip,
  normalizeClips,
  removeClip,
  renameClip,
  repeatClip,
  resizeClip,
  withClips,
} from './clips';

/**
 * The arrangement model.
 *
 * The acceptance criterion for this batch is a rounding one — "expanded to a
 * note list, aligned to within a millisecond" — so the timing tests here are
 * exact rather than approximate wherever the maths is exact, and use a
 * millisecond bound where the seconds-to-beats round trip is involved.
 */

const note = (n: number, start: number, duration = 0.5, velocity = 0.8): MidiNote => ({
  note: n,
  velocity,
  start,
  duration,
});

const song = (notes: MidiNote[]): MidiSong => ({
  name: 'test',
  bpm: 120,
  duration: 1,
  notes,
});

describe('clip expansion', () => {
  it('places a clip where it starts, at its own times', () => {
    const clip = makeClip('one', [note(60, 0, 0.5), note(64, 0.5, 0.5)], { start: 2, length: 2, bpm: 120 });
    const { notes } = expandClips([clip]);
    expect(notes.map((n) => [n.note, n.start, n.duration])).toEqual([
      [60, 2, 0.5],
      [64, 2.5, 0.5],
    ]);
  });

  it('repeats the window back to back, exactly as many times as asked', () => {
    const clip = makeClip('loop', [note(60, 0, 0.25), note(62, 0.5, 0.25)], { start: 0, length: 1, repeat: 4 });
    const { notes, duration } = expandClips([clip]);
    expect(notes).toHaveLength(8);
    const starts = notes.map((n) => n.start);
    expect(starts).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    // Four passes, each exactly one window later — within a millisecond, which
    // is the bar the batch is measured against.
    for (let pass = 0; pass < 4; pass += 1) {
      for (const at of [0, 0.5]) {
        const want = pass * 1 + at;
        const got = starts.find((value) => Math.abs(value - want) < 0.05);
        expect(got, `pass ${pass}, offset ${at}`).toBeDefined();
        expect(Math.abs((got as number) - want) * 1000).toBeLessThan(1);
      }
    }
    // The last repeat ends the arrangement: the last note starts at 3.5 and is
    // a sixteenth long, so the song ends at 3.75 plus the usual tail.
    expect(duration).toBeCloseTo(4.15, 6);
  });

  it('matches the same performance whether a layer is played flat or folded', () => {
    // Folding is a copy, not a rearrangement: this is the invariant that lets a
    // folded song keep sounding exactly as it did.
    const notes = [note(60, 0, 0.5), note(64, 1, 0.5), note(67, 2.5, 1)];
    // 120 BPM: the last note ends at 3.5 s, so the window rounds up to 4 s.
    const folded = foldLayer(song(notes), 0, { name: 'Layer', bpm: 120 });
    expect(folded.clip.length).toBe(4);
    expect(folded.song.notes).toEqual(notes);
    expect(folded.song.clips).toHaveLength(1);
  });

  it('trims a note that sticks out of the window instead of bleeding into the loop', () => {
    // The note runs 0.5..1.5 in a 1 s window: the first pass keeps the first
    // half, and the second pass starts a fresh note at 1.0.
    const clip = makeClip('bleed', [note(60, 0.5, 1)], { start: 0, length: 1, repeat: 2 });
    const { notes } = expandClips([clip]);
    expect(notes.map((n) => [n.start, n.duration])).toEqual([
      [0.5, 0.5],
      [1.5, 0.5],
    ]);
  });

  it('drops a note that starts outside the window', () => {
    const clip = makeClip('late', [note(60, 0, 0.25), note(67, 3, 0.25)], { start: 0, length: 1, repeat: 1 });
    expect(expandClips([clip]).notes.map((n) => n.note)).toEqual([60]);
  });

  it('sums overlapping clips, in time order', () => {
    const a = makeClip('a', [note(60, 0, 1)], { start: 0, length: 2, repeat: 1 });
    // The second clip's note is at its own zero, so it lands on the timeline at
    // the clip's start — half a second in, over the first note's tail.
    const b = makeClip('b', [note(67, 0, 1)], { start: 0.5, length: 2, repeat: 1 });
    const { notes } = expandClips([a, b]);
    expect(notes.map((n) => [n.start, n.note])).toEqual([
      [0, 60],
      [0.5, 67],
    ]);
    // Both sound: the arrangement is a sum, exactly like layers.
    expect(notes).toHaveLength(2);
  });

  it('bounds the work a clip can ask for', () => {
    const clip = makeClip('huge', [note(60, 0, 0.25)], { start: 0, length: 1, repeat: 10_000 });
    const { notes } = expandClips([clip]);
    expect(notes).toHaveLength(CLIP_MAX_REPEAT);
  });

  it('answers what is playing at a moment', () => {
    const clip = makeClip('a', [note(60, 0, 0.5)], { start: 1, length: 2, repeat: 2 });
    const clips = [clip];
    expect(clipAt(clips, 0)).toBeNull();
    expect(clipAt(clips, 1.5)?.id).toBe(clip.id);
    expect(clipAt(clips, 4.9)?.id).toBe(clip.id);
    expect(clipAt(clips, 5)).toBeNull();
  });
});

describe('arranging clips', () => {
  const clip = makeClip('a', [note(60, 0, 0.5)], { start: 0, length: 2, repeat: 1 });

  it('moves, resizes and repeats without touching the material', () => {
    const moved = moveClip([clip], clip.id, 3);
    expect(moved[0].start).toBe(3);
    expect(moved[0].notes).toEqual(clip.notes);
    const longer = resizeClip(moved, clip.id, 4);
    expect(longer[0].length).toBe(4);
    const many = repeatClip(longer, clip.id, 8);
    expect(many[0].repeat).toBe(8);
    expect(many[0].notes).toEqual(clip.notes);
    // The window is a view: widening it again brings the material back.
    expect(resizeClip(many, clip.id, 2)[0].notes).toEqual(clip.notes);
    // Clamped, so a drag cannot ask for an hour or a thousand repeats.
    expect(repeatClip([clip], clip.id, 0)[0].repeat).toBe(1);
    expect(repeatClip([clip], clip.id, 9999)[0].repeat).toBe(CLIP_MAX_REPEAT);
  });

  it('duplicates a clip right after itself, with its own notes', () => {
    const two = duplicateClip([clip], clip.id);
    expect(two).toHaveLength(2);
    expect(two[1].start).toBe(2);
    expect(two[1].id).not.toBe(clip.id);
    // The copy is independent: editing one must not edit the other.
    const edited = clipWithNotes(two, two[1].id, [note(72, 0, 0.25)]);
    expect(edited[0].notes).toEqual(clip.notes);
    expect(edited[1].notes.map((n) => n.note)).toEqual([72]);
  });

  it('removes and renames', () => {
    expect(removeClip([clip], clip.id)).toEqual([]);
    expect(removeClip([clip], 'missing')).toEqual([clip]);
    expect(renameClip([clip], clip.id, '  B section  ')[0].name).toBe('B section');
    expect(renameClip([clip], clip.id, '   ')[0].name).toBe('a');
  });

  it('writes the arrangement back into the flat list', () => {
    const base = song([note(60, 0, 0.5)]);
    const clip2 = makeClip('loop', base.notes, { start: 0, length: 1, repeat: 3 });
    const arranged = withClips(base, [clip2]);
    expect(arranged.notes).toHaveLength(3);
    expect(arranged.notes.map((n) => n.start)).toEqual([0, 1, 2]);
    // Three windows of 1 s, the last note half a second long, plus the tail.
    expect(arranged.duration).toBeCloseTo(2.9, 6);
    // Emptying the arrangement forgets the key entirely, so a song that never
    // had clips is stored without one — and what was playing keeps playing as a
    // flat performance, rather than vanishing with the last clip.
    const plain = withClips(arranged, []);
    expect(plain.clips).toBeUndefined();
    expect(plain.notes).toEqual(arranged.notes);
    expect(plain.notes).toHaveLength(3);
  });
});

describe('stored arrangements', () => {
  it('reads back what it wrote', () => {
    const clip = makeClip('a', [note(60, 0, 0.5)], { start: 1, length: 2, repeat: 3 });
    expect(normalizeClips(JSON.parse(JSON.stringify([clip])))).toEqual([clip]);
  });

  it('drops anything broken instead of failing the whole song', () => {
    const good = makeClip('good', [note(60, 0, 0.5)], { start: 0, length: 1 });
    const stored = [
      good,
      null,
      'nope',
      { id: 'x' },
      { id: 'y', start: -1, length: 1, notes: [] },
      { id: 'z', start: 0, length: Number.NaN, notes: [] },
      { id: 'w', start: 0, length: 1, notes: 'no' },
      // A note with a broken field is dropped, the clip survives.
      { id: 'v', start: 0, length: 1, notes: [note(60, 0, 0.5), { note: 'x' }, null] },
    ];
    const clips = normalizeClips(stored);
    expect(clips.map((c) => c.id)).toEqual([good.id, 'v']);
    expect(clips[1].notes).toHaveLength(1);
  });

  it('clamps absurd stored values', () => {
    const clips = normalizeClips([
      { id: 'a', start: 0, length: 100000, repeat: 100000, notes: [] },
      { id: 'b', start: 0, length: -5, repeat: -3, notes: [] },
    ]);
    expect(clips[0].repeat).toBe(CLIP_MAX_REPEAT);
    expect(clips[0].length).toBeLessThanOrEqual(600);
    expect(clips[1].repeat).toBe(1);
    expect(clips[1].length).toBeGreaterThan(0);
  });

  it('treats a song without clips as a song with none', () => {
    expect(clipsOf(song([]))).toEqual([]);
    expect(clipsOf(null)).toEqual([]);
  });
});

describe('clips and layers', () => {
  const twoLayers = (): MidiSong => ({
    name: 'two',
    bpm: 120,
    duration: 2,
    notes: [],
    tracks: [
      { name: 'Lead', notes: [note(60, 0, 0.5)] },
      { name: 'Bass', notes: [note(36, 1, 0.5)] },
    ],
  });

  it('folding one layer arranges that layer and leaves the other alone', () => {
    const base = twoLayers();
    base.notes = [...base.tracks![0].notes, ...base.tracks![1].notes];
    const folded = foldLayer(base, 0, { name: 'Lead', bpm: 120 });
    expect(folded.clip.layer).toBe(0);
    const arranged = folded.song;
    // The bass layer has no clips, so it plays as written…
    expect(arranged.tracks?.[1].notes).toEqual([note(36, 1, 0.5)]);
    // …and the flat list the player schedules from is the sum of both.
    expect(arranged.notes.map((n) => n.note)).toEqual([60, 36]);
    // Looping the lead clip repeats only the lead.
    const looped = withClips(arranged, repeatClip(clipsOf(arranged), folded.clip.id, 3));
    expect(looped.tracks?.[0].notes).toHaveLength(3);
    expect(looped.tracks?.[1].notes).toHaveLength(1);
    expect(looped.notes).toHaveLength(4);
  });

  it('expands the clips of each layer into that layer', () => {
    const clips = [
      makeClip('lead', [note(60, 0, 0.5)], { start: 0, length: 1, repeat: 2, layer: 0 }),
      makeClip('bass', [note(36, 0, 0.5)], { start: 0.5, length: 2, layer: 1 }),
    ];
    expect(clipsOfLayer(clips, 0).map((c) => c.name)).toEqual(['lead']);
    expect(clipsOfLayer(clips, 1).map((c) => c.name)).toEqual(['bass']);
    const arranged = withClips(twoLayers(), clips);
    expect(arranged.tracks?.[0].notes.map((n) => n.start)).toEqual([0, 1]);
    expect(arranged.tracks?.[1].notes.map((n) => n.start)).toEqual([0.5]);
    expect(arranged.notes.map((n) => n.start)).toEqual([0, 0.5, 1]);
  });
});

/**
 * P10.2: the figure is portable across layers.
 *
 * The hard acceptance criterion of this batch is an equality, so these tests
 * assert equality of whole arrays rather than field by field: "copy the clip to
 * the other layer" and "copy every note across and fold that layer" have to
 * produce the *same* expansion — the same pitches, starts, durations and
 * velocities, in the same stable order — and the copy has to be independent of
 * whatever it was made from.
 */
describe('copying a clip to another layer', () => {
  /** Two layers, the lead arranged with one clip. */
  const twoLayerArrangement = (): { song: MidiSong; clipId: string } => {
    const base: MidiSong = {
      name: 'two',
      bpm: 120,
      duration: 4,
      notes: [],
      tracks: [
        { name: 'Lead', notes: [note(60, 0, 0.5), note(64, 1, 0.5)] },
        { name: 'Bass', notes: [] },
      ],
    };
    base.notes = [...base.tracks![0].notes];
    const folded = foldLayer(base, 0, { name: 'Lead', bpm: 120 });
    return { song: folded.song, clipId: folded.clip.id };
  };

  it('expands to the same notes whether the clip is copied or its notes are', () => {
    const { song, clipId } = twoLayerArrangement();
    const clips = clipsOf(song);

    // Path A: copy the clip itself onto the bass layer.
    const copied = copyClipToLayer(clips, clipId, 1)!;
    const copy = copied.clip;
    expect(copy.layer).toBe(1);
    expect(copy.id).not.toBe(clipId);
    expect(copied.clips).toHaveLength(clips.length + 1);

    // Path B: copy every note of the expansion across by hand and fold the
    // bass layer — the long way round, which has to agree to the bit.
    const otherCopy = copyClipToLayer(clips, clipId, 1)!.clip;
    const byHand = foldLayer(
      { ...song, tracks: [{ ...song.tracks![0] }, { name: 'Bass', notes: expandClips([copy]).notes }] },
      1,
      { name: copy.name, bpm: song.bpm },
    ).clip;

    expect(byHand.notes).toEqual(copy.notes);
    expect(expandClips([byHand]).notes).toEqual(expandClips([copy]).notes);
    // …and both are the source's performance, note for note.
    expect(expandClips([copy]).notes).toEqual(expandClips(clipsOfLayer(clips, 0)).notes);
    // Two copies of the same source are the same figure.
    expect(otherCopy.notes).toEqual(copy.notes);
    expect(otherCopy.id).not.toBe(copy.id);
  });

  it('folds an arrangement back into one clip with the same expansion', () => {
    // Repeated and trimmed material on purpose: the fold has to read the
    // *timeline*, not the notes as written.
    const clip = makeClip('loop', [note(60, 0, 0.5), note(62, 0.75, 0.75)], {
      start: 0.5,
      length: 1,
      repeat: 3,
      layer: 0,
    });
    const before = expandClips([clip]).notes;
    const folded = foldClipsInto([clip], { sourceLayer: 0, layer: 0, name: 'whole', bpm: 120 });
    expect(expandClips([folded]).notes).toEqual(before);
    // The flat list is the same performance in both readings, too: replacing
    // the source layer's arrangement with the collapsed block changes nothing.
    const twoLayers = {
      name: 'two',
      bpm: 120,
      duration: 4,
      notes: [],
      tracks: [{ name: 'Lead', notes: [] }, { name: 'Bass', notes: [] }],
    };
    const ordered = withClips(twoLayers, [clip]);
    const whole = withClips(ordered, [folded]);
    expect(whole.notes).toEqual(ordered.notes);
    expect(whole.tracks?.[0].notes).toEqual(ordered.tracks?.[0].notes);
    // Folding onto another layer keeps the source's notes playing as written,
    // and adds the same figure there — the cross-layer reading.
    const across = withClips(ordered, [clip, foldClipsInto([clip], { sourceLayer: 0, layer: 1, bpm: 120 })]);
    expect(across.notes).toHaveLength(12);
    expect(across.tracks?.[1].notes).toEqual(ordered.tracks?.[0].notes);
    // An explicit start moves the block without changing its internal timing:
    // `before` starts at 0.5, so a block placed at 2 sits 1.5 s later.
    const moved = foldClipsInto([clip], { sourceLayer: 0, layer: 1, start: 2, name: 'whole', bpm: 120 });
    expect(expandClips([moved]).notes.map((n) => [n.note, n.start, n.duration])).toEqual(
      before.map((n) => [n.note, n.start + 1.5, n.duration]),
    );
  });

  it('gives the copy its own note objects, so editing one cannot move the other', () => {
    const { song, clipId } = twoLayerArrangement();
    const clips = clipsOf(song);
    const copied = copyClipToLayer(clips, clipId, 1)!;
    const source = copied.clips.find((clip) => clip.id === clipId)!;
    const copy = copied.clip;

    // The deep-copy evidence: not the array, not the note objects.
    expect(copy.notes).not.toBe(source.notes);
    expect(copy.notes[0]).not.toBe(source.notes[0]);
    // Both are separate objects with the same bits.
    expect(copy.notes.map((n) => [n.note, n.start, n.duration, n.velocity])).toEqual(
      source.notes.map((n) => [n.note, n.start, n.duration, n.velocity]),
    );

    // Rewriting the copy leaves the original's fields untouched…
    const bits = source.notes.map((n) => ({ ...n }));
    const edited = clipWithNotes(copied.clips, copy.id, [note(36, 0, 2)]);
    const afterSource = edited.find((clip) => clip.id === clipId)!;
    expect(afterSource.notes).toEqual(bits);
    expect(edited.find((clip) => clip.id === copy.id)!.notes.map((n) => n.note)).toEqual([36]);

    // …and rewriting the original leaves the copy untouched.
    const backEdited = clipWithNotes(copied.clips, clipId, [note(72, 0, 0.25)]);
    expect(backEdited.find((clip) => clip.id === copy.id)!.notes).toEqual(copy.notes);
  });
});
