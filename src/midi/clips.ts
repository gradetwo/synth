/**
 * Arrangement clips (P5.2).
 *
 * A flat note list is a performance; an arrangement is a *plan*. A clip is one
 * figure — a handful of notes — placed on the timeline and repeated, which is how
 * most music that is not played by hand is actually built: one bar, laid down
 * eight times, then a variation copied to the second half.
 *
 * The model is deliberately flat and additive:
 *
 *   * a clip holds its own notes, relative to its own start, so folding a layer
 *     into a clip never loses anything and unfolding is a copy;
 *   * the clip's *window* (`length`) is what repeats `repeat` times, and a note
 *     that sticks out of the window is trimmed at it — a loop must not bleed
 *     into its own next repeat;
 *   * overlapping clips all sound (they sum), the same rule layers follow.
 *
 * `song.notes` stays the *expansion*: the flat, time-ordered list that the
 * player, the piano roll, the share code and every export already speak. That is
 * the whole trick — the arrangement is a new authoring layer on top of a format
 * nothing else has to learn.
 */

import { songTracks } from './smf';
import type { MidiNote, MidiSong, MidiTrack } from './smf';

export interface MidiClip {
  id: string;
  /** Shown in the strip; the user can rename it. */
  name: string;
  /**
   * Which layer of a multi-track song the clip arranges. Defaults to the first:
   * a clip holds its own notes, so the layer is what decides whose mix and
   * timbre it plays through.
   */
  layer: number;
  /** Where the clip starts on the song timeline, in seconds. */
  start: number;
  /** The loop window, in seconds. What repeats, and what notes are trimmed to. */
  length: number;
  /** How many times the window plays back to back, at least 1. */
  repeat: number;
  /** Notes relative to the clip's own start, in seconds. */
  notes: MidiNote[];
}

/** Shortest loop window, so a clip cannot be squeezed to nothing by a drag. */
export const CLIP_MIN_LENGTH = 0.25;
/** Most repeats one clip may have. The expansion is built per repeat. */
export const CLIP_MAX_REPEAT = 64;
/** Longest a clip may be, so a typo cannot make an expansion of hours. */
export const CLIP_MAX_LENGTH = 600;

/** Round to 1/10000 s, the grid the rest of the MIDI model stores. */
const tidy = (v: number): number => Math.round(v * 10000) / 10000;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

let seed = 0;
function nextId(): string {
  seed += 1;
  return `clip${seed.toString(36)}${Date.now().toString(36).slice(-3)}`;
}

/** The clips of a song, or an empty list: a song without them is a song. */
export function clipsOf(song: MidiSong | null | undefined): MidiClip[] {
  return song?.clips ?? [];
}

/** Does this song have an arrangement? */
export function hasClips(song: MidiSong | null | undefined): boolean {
  return clipsOf(song).length > 0;
}

/**
 * The flat note list an arrangement plays, plus the length of the result.
 *
 * Notes are placed once per repeat and trimmed at the window end; a note that
 * starts outside the window is not part of the clip at all. The result is sorted
 * the way the player and the SMF writer expect.
 */
export function expandClips(clips: MidiClip[]): { notes: MidiNote[]; duration: number } {
  const notes: MidiNote[] = [];
  for (const clip of clips) {
    const length = clamp(clip.length, CLIP_MIN_LENGTH, CLIP_MAX_LENGTH);
    const repeat = Math.max(1, Math.min(CLIP_MAX_REPEAT, Math.round(clip.repeat)));
    for (let pass = 0; pass < repeat; pass += 1) {
      const offset = clip.start + pass * length;
      for (const note of clip.notes) {
        const from = note.start;
        if (from >= length) continue; // outside the window: not in this clip
        const to = Math.min(from + note.duration, length);
        const duration = to - from;
        if (duration <= 0) continue;
        notes.push({
          note: note.note,
          velocity: note.velocity,
          start: tidy(offset + from),
          duration: tidy(duration),
        });
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  let end = 0;
  for (const note of notes) end = Math.max(end, note.start + note.duration);
  return { notes, duration: tidy(end + 0.4) };
}

/**
 * Write an arrangement back into a song: every layer's notes, the flat list the
 * player schedules from, and the length all follow it.
 *
 * A layer with clips plays its arrangement — that is the point of folding one —
 * and a layer without any keeps playing its notes as written, so folding one
 * layer of a two-layer song never silences the other.
 */
export function withClips(song: MidiSong, clips: MidiClip[]): MidiSong {
  if (clips.length === 0) {
    const { clips: _drop, ...rest } = song;
    return rest;
  }
  const arranged = songTracks(song).map((track, index) => {
    const mine = clipsOfLayer(clips, index);
    return mine.length ? { ...track, notes: expandClips(mine).notes } : { ...track, notes: [...track.notes] };
  });
  const notes = arranged
    .flatMap((track) => track.notes)
    .sort((a, b) => a.start - b.start || a.note - b.note);
  let end = 0;
  for (const note of notes) end = Math.max(end, note.start + note.duration);
  return { ...song, clips, notes, tracks: arranged, duration: tidy(end + 0.4) };
}

/** The clips that arrange one layer. */
export function clipsOfLayer(clips: MidiClip[], layer: number): MidiClip[] {
  return clips.filter((clip) => (clip.layer ?? 0) === layer);
}

/** The clip whose window contains `time`, or null. */
export function clipAt(clips: MidiClip[], time: number): MidiClip | null {
  return (
    clips.find((clip) => time >= clip.start && time < clip.start + clip.length * clip.repeat) ?? null
  );
}

/** The end of the arrangement, for the strip's scale. */
export function clipsDuration(clips: MidiClip[]): number {
  let end = 0;
  for (const clip of clips) {
    end = Math.max(end, clip.start + clamp(clip.length, CLIP_MIN_LENGTH, CLIP_MAX_LENGTH) * Math.max(1, clip.repeat));
  }
  return end;
}

// ---------------------------------------------------------------- arrangement

export function moveClip(clips: MidiClip[], id: string, start: number): MidiClip[] {
  const next = Math.max(0, tidy(start));
  return clips.map((clip) => (clip.id === id ? { ...clip, start: next } : clip));
}

/**
 * Set a clip's window length.
 *
 * The content is *not* rewritten: what is inside the new window plays, what is
 * outside it stops playing. That is what makes "one bar of notes, loop it" a
 * two-click move, and it is reversible — widening the window brings the notes
 * back, because the clip still holds them.
 */
export function resizeClip(clips: MidiClip[], id: string, length: number): MidiClip[] {
  const next = clamp(tidy(length), CLIP_MIN_LENGTH, CLIP_MAX_LENGTH);
  return clips.map((clip) => (clip.id === id ? { ...clip, length: next } : clip));
}

export function repeatClip(clips: MidiClip[], id: string, repeat: number): MidiClip[] {
  const next = clamp(Math.round(repeat), 1, CLIP_MAX_REPEAT);
  return clips.map((clip) => (clip.id === id ? { ...clip, repeat: next } : clip));
}

/** Copy a clip, by default straight after the original. */
export function duplicateClip(clips: MidiClip[], id: string, start?: number): MidiClip[] {
  const source = clips.find((clip) => clip.id === id);
  if (!source) return clips;
  const at = start === undefined ? source.start + source.length * Math.max(1, source.repeat) : Math.max(0, start);
  return [
    ...clips,
    {
      ...source,
      id: nextId(),
      notes: source.notes.map((note) => ({ ...note })),
      start: tidy(at),
    },
  ];
}

export function removeClip(clips: MidiClip[], id: string): MidiClip[] {
  return clips.filter((clip) => clip.id !== id);
}

export function renameClip(clips: MidiClip[], id: string, name: string): MidiClip[] {
  const clean = name.trim().slice(0, 60);
  return clips.map((clip) => (clip.id === id ? { ...clip, name: clean || clip.name } : clip));
}

/** Replace one clip's notes (the piano roll's write-back). */
export function clipWithNotes(clips: MidiClip[], id: string, notes: MidiNote[]): MidiClip[] {
  return clips.map((clip) =>
    clip.id === id
      ? {
          ...clip,
          notes: notes
            .map((note) => ({
              note: Math.max(0, Math.min(127, Math.round(note.note))),
              velocity: clamp(note.velocity, 0.05, 1),
              start: tidy(Math.max(0, note.start)),
              duration: tidy(Math.max(0.01, note.duration)),
            }))
            .sort((a, b) => a.start - b.start || a.note - b.note),
        }
      : clip,
  );
}

// -------------------------------------------------------------------- folding

/** A clip window long enough for a layer, rounded up to a bar (4 beats). */
function barLength(notes: MidiNote[], bpm: number, from = 0): number {
  const beat = 60 / (bpm > 0 ? bpm : 120);
  const bar = beat * 4;
  let end = 0;
  for (const note of notes) end = Math.max(end, note.start + note.duration - from);
  return Math.max(CLIP_MIN_LENGTH, Math.ceil(end / bar) * bar);
}

/**
 * Fold a layer into one clip starting at `start` (0 by default).
 *
 * The window covers the whole layer rounded up to a bar, so folding a layer and
 * playing the result is *the same performance* — the invariant the tests pin
 * down. Everything the user does next (drag, loop, copy) changes the
 * arrangement, never the material.
 */
export function foldLayer(
  song: MidiSong,
  layerIndex: number,
  options: { name?: string; start?: number; bpm?: number } = {},
): { song: MidiSong; clip: MidiClip } {
  const tracks: MidiTrack[] = song.tracks && song.tracks.length ? song.tracks : [{ name: 'Track 1', notes: song.notes }];
  const index = layerIndex >= 0 && layerIndex < tracks.length ? layerIndex : 0;
  const layer = tracks[index];
  const start = Math.max(0, options.start ?? 0);
  const inside = layer.notes.filter((note) => note.start >= start);
  const bpm = options.bpm ?? song.bpm;
  const length = barLength(inside, bpm, start);
  const clip: MidiClip = {
    id: nextId(),
    name: options.name?.trim() || layer.name || 'Clip',
    layer: index,
    start: tidy(start),
    length: tidy(length),
    repeat: 1,
    // Relative to the clip: the same notes, re-based on the window's start.
    notes: inside
      .map((note) => ({
        note: note.note,
        velocity: note.velocity,
        start: tidy(note.start - start),
        duration: note.duration,
      }))
      .sort((a, b) => a.start - b.start || a.note - b.note),
  };
  // The layer's notes become the first clip's content, so a folded layer sounds
  // exactly as it did — the flat list is the expansion from here on.
  const clips = [...clipsOf(song), clip];
  return { song: withClips(song, clips), clip };
}

// ---------------------------------------------------------------- persistence

/** Read stored clips without trusting their shape. Broken clips are dropped. */
export function normalizeClips(raw: unknown): MidiClip[] {
  if (!Array.isArray(raw)) return [];
  const out: MidiClip[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const clip = entry as Partial<MidiClip>;
    if (typeof clip.id !== 'string' || !clip.id) continue;
    if (typeof clip.start !== 'number' || !Number.isFinite(clip.start) || clip.start < 0) continue;
    if (typeof clip.length !== 'number' || !Number.isFinite(clip.length)) continue;
    if (!Array.isArray(clip.notes)) continue;
    const notes: MidiNote[] = [];
    for (const note of clip.notes) {
      if (!note || typeof note !== 'object') continue;
      const entryNote = note as Partial<MidiNote>;
      if (
        !Number.isFinite(entryNote.note) ||
        !Number.isFinite(entryNote.start) ||
        !Number.isFinite(entryNote.duration) ||
        !Number.isFinite(entryNote.velocity)
      ) {
        continue;
      }
      notes.push({
        note: clamp(Math.round(entryNote.note as number), 0, 127),
        velocity: clamp(entryNote.velocity as number, 0.05, 1),
        start: Math.max(0, entryNote.start as number),
        duration: Math.max(0.01, entryNote.duration as number),
      });
    }
    out.push({
      id: clip.id,
      name: typeof clip.name === 'string' && clip.name.trim() ? clip.name.trim().slice(0, 60) : 'Clip',
      layer: clamp(Math.round(clip.layer ?? 0), 0, 15),
      start: tidy(clip.start),
      length: clamp(tidy(clip.length), CLIP_MIN_LENGTH, CLIP_MAX_LENGTH),
      repeat: clamp(Math.round(clip.repeat ?? 1), 1, CLIP_MAX_REPEAT),
      notes: notes.sort((a, b) => a.start - b.start || a.note - b.note),
    });
  }
  return out;
}

/**
 * Build a clip in one call. `notes` are in the clip's own frame, exactly like
 * `MidiClip.notes`: where the clip sits on the timeline is `start`, and the
 * notes do not move when it does.
 */
export function makeClip(
  name: string,
  notes: MidiNote[],
  options: { start?: number; length?: number; repeat?: number; bpm?: number; layer?: number } = {},
): MidiClip {
  const start = Math.max(0, options.start ?? 0);
  const length = options.length ?? barLength(notes, options.bpm ?? 120, 0);
  return {
    id: nextId(),
    name,
    layer: Math.max(0, Math.round(options.layer ?? 0)),
    start: tidy(start),
    length: tidy(clamp(length, CLIP_MIN_LENGTH, CLIP_MAX_LENGTH)),
    repeat: clamp(Math.round(options.repeat ?? 1), 1, CLIP_MAX_REPEAT),
    notes: notes
      .map((note) => ({ ...note, start: tidy(note.start) }))
      .sort((a, b) => a.start - b.start || a.note - b.note),
  };
}
