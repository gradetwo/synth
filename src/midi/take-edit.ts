/**
 * Live takes: which one is playing, and the operations a user drives (P5.4).
 *
 * `takes.ts` holds the stored shape and the reader that validates it; this
 * module holds everything else — the accessors the UI reads, recording a pass
 * over what is there, merging the alternates, deleting one, and writing the
 * selected take back into its song. It is a separate module for the first-load
 * bundle, not for taste: the library has to validate stored takes on every
 * boot, but nothing here is reachable until the recording session or the take
 * chips load, and both are lazy chunks.
 *
 * The same-pitch rule lives here because it is the one musical decision the
 * overdub makes: two strikes of the same pitch at the same grid slot are the
 * same note played again, so the incoming one *replaces* its twin instead of
 * doubling it — keeping both would add the velocities and flam every attack,
 * and a player who records the same line twice wants the second pass to be the
 * one that sounds. Anything else is layered as written: two pitches at the same
 * moment are a chord, and the same pitch at a clearly different time is a
 * repeat.
 */

import { clipsOf, clipsOfLayer, withClips } from './clips';
import { layerNotes, songTracks } from './smf';
import type { MidiNote, MidiSong } from './smf';
import { TAKE_MAX_PER_LAYER, type MidiTake } from './takes';

/**
 * Two strikes of the same pitch closer than this are the same note played
 * again. The recorder quantises to the grid, so a re-recorded line lands on
 * exactly the same start; the window is only here to absorb an unquantised
 * pass.
 */
export const TAKE_RESTRIKE = 0.05;

let seed = 0;
function nextId(): string {
  seed += 1;
  return `take${seed.toString(36)}${Date.now().toString(36).slice(-3)}`;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const sortNotes = (notes: MidiNote[]): MidiNote[] =>
  [...notes].sort((a, b) => a.start - b.start || a.note - b.note);

const cloneNotes = (notes: MidiNote[]): MidiNote[] => notes.map((note) => ({ ...note }));

/**
 * Write a set of takes into a song: the selected take replaces its layer, and
 * the flat note list and the length follow, so the player and every export see
 * the take that is selected.
 *
 * An empty list removes the take fields entirely, leaving the layer's own notes
 * alone: a song with no takes is a song that is played as written. A layer that
 * is arranged plays its arrangement — folding a layer is an explicit act, and
 * the clips are the plan the user asked for — so the clips expansion runs last
 * and keeps the take fields.
 */
export function withTakes(song: MidiSong, takes: MidiTake[], takeId: string | undefined): MidiSong {
  if (takes.length === 0) {
    if (!song.takes && !song.takeId) return song;
    const { takes: _drop, takeId: _dropId, ...rest } = song;
    return rest;
  }
  const selected = takes.find((take) => take.id === takeId) ?? null;
  const tracks = songTracks(song).map((track, index) => {
    const mine = selected && selected.layer === index;
    return { ...track, notes: mine ? cloneNotes(selected.notes) : [...track.notes] };
  });
  const notes = sortNotes(tracks.flatMap((track) => track.notes));
  let end = 0;
  for (const note of notes) end = Math.max(end, note.start + note.duration);
  // The tail is the same 0.4 s the recorder and the clip expansion add, so a
  // take does not shorten the song it was recorded into. An id that matches no
  // take clears the selection rather than leaving a dangling one behind.
  const next: MidiSong = {
    ...song,
    takes,
    takeId: selected?.id,
    notes,
    tracks,
    duration: Math.round((end + 0.4) * 10000) / 10000,
  };
  const clips = clipsOf(next);
  return clips.length ? withClips(next, clips) : next;
}

/**
 * Write a layer's current notes back into its selected take.
 *
 * The piano roll and the layer strip edit `tracks[layer].notes`; while a take
 * is selected those notes *are* the take's, so an edit has to land in the take
 * too. The layer notes are what plays either way, but the take is what the
 * chips show and what switching back to re-applies — a stale one there would
 * quietly undo the edit on the next take switch. An arranged layer is skipped
 * on purpose: its clips are the plan, and the take is the material they were
 * built from.
 */
export function syncTakeFromLayer(song: MidiSong): MidiSong {
  const take = activeTake(song);
  if (!take) return song;
  if (clipsOfLayer(clipsOf(song), take.layer).length) return song;
  // The copy is unconditional: a save already builds a fresh song object, and
  // comparing first would only buy an allocation back on the common path.
  const notes = layerNotes(song, take.layer).map((note) => ({ ...note }));
  return {
    ...song,
    takes: takesOf(song).map((entry) => (entry.id === take.id ? { ...entry, notes } : entry)),
  };
}

/** The takes of a song, or an empty list: a song without them is a song. */
export function takesOf(song: MidiSong | null | undefined): MidiTake[] {
  return song?.takes ?? [];
}

/** The takes recorded on one layer, oldest first. */
export function takesOfLayer(takes: MidiTake[], layer: number): MidiTake[] {
  return takes.filter((take) => take.layer === layer);
}

/** The take the song is playing, when its id still points at one. */
export function activeTake(song: MidiSong | null | undefined): MidiTake | null {
  const takes = takesOf(song);
  const id = song?.takeId;
  return (id ? takes.find((take) => take.id === id) : undefined) ?? null;
}

/**
 * The take that decides one layer's notes: only a take selected *and* recorded
 * on that layer replaces anything. A take on another layer is stored material,
 * not a rewrite of this one.
 */
export function activeTakeOfLayer(song: MidiSong | null | undefined, layer: number): MidiTake | null {
  const take = activeTake(song);
  return take && take.layer === layer ? take : null;
}

/** The notes a layer is playing: its selected take's, or its own. */
export function layerTakeNotes(song: MidiSong, layer: number): MidiNote[] {
  const take = activeTakeOfLayer(song, layer);
  return take ? cloneNotes(take.notes) : layerNotes(song, layer);
}

/**
 * Is this layer arranged with clips?
 *
 * A folded layer is the one case where a take is *not* the layer's content: the
 * clips are the plan and the take stays material. `withTakes` re-expands the
 * clips last for exactly that reason, which also means selecting a take there
 * would change nothing anyone can hear. The callers use this to say so instead
 * of performing a switch that is silently inaudible (P10.3).
 */
export function layerFoldedIntoClips(song: MidiSong | null | undefined, layer: number): boolean {
  return !song ? false : clipsOfLayer(clipsOf(song), layer).length > 0;
}

/** How a merge combines the layer's alternates. */
export type MergeStrategy = 'union' | 'overwrite';

/** Lay `incoming` over `base` with the same-pitch rule above. */
export function mergeNotes(base: MidiNote[], incoming: MidiNote[]): MidiNote[] {
  const out = cloneNotes(base);
  for (const note of incoming) {
    const at = out.findIndex(
      (existing) => existing.note === note.note && Math.abs(existing.start - note.start) <= TAKE_RESTRIKE,
    );
    if (at >= 0) out[at] = { ...note };
    else out.push({ ...note });
  }
  return sortNotes(out);
}

/**
 * Does a note of `base` sound at the same time as any note of `incoming`?
 *
 * Two windows overlap when each starts before the other ends. Touching edges
 * count as clear: a note that ends exactly where the next begins is a repeat,
 * not a clash, so the earlier one is not overwritten.
 */
function overlapsAny(base: MidiNote, incoming: MidiNote[]): boolean {
  return incoming.some(
    (fresh) => base.start < fresh.start + fresh.duration && fresh.start < base.start + base.duration,
  );
}

/**
 * Lay `incoming` over `base` so the newer material wins: every older note that
 * sounds at the same time as any note of `incoming` is dropped, and the rest of
 * the older material stays. This is the "comp a line out of two passes" rule —
 * the opposite trade from `mergeNotes`, which keeps both.
 *
 * Overlap is judged on the notes themselves, not on pitch: a C at 1.0 s is
 * replaced by an E at 1.0 s, because at that moment the newer pass is the one
 * that is meant to sound.
 */
export function mergeNotesOverwrite(base: MidiNote[], incoming: MidiNote[]): MidiNote[] {
  const kept = base.filter((old) => !overlapsAny(old, incoming));
  return sortNotes([...kept, ...incoming].map((note) => ({ ...note })));
}

/**
 * Record one pass on one layer: a new take whose content is the selected take's
 * notes (or the layer's, when no take is selected) with the new notes overlaid.
 * The new take becomes the selected one, so what was just played is what is
 * heard — and the take it grew out of is still in the list.
 */
export function overdubTake(
  song: MidiSong,
  layer: number,
  incoming: MidiNote[],
  options: { name?: string; at?: number } = {},
): { song: MidiSong; take: MidiTake } {
  const index = clamp(Math.round(layer), 0, 15);
  const takes = takesOf(song);
  const bed = layerTakeNotes(song, index);
  const mine = takesOfLayer(takes, index);
  const take: MidiTake = {
    id: nextId(),
    name: options.name?.trim().slice(0, 60) || `Take ${mine.length + 1}`,
    layer: index,
    notes: mergeNotes(bed, incoming),
    createdAt: options.at ?? Date.now(),
  };
  let list = [...takes, take];
  if (mine.length + 1 > TAKE_MAX_PER_LAYER) {
    // Oldest first: the list is in recording order, so the retired takes are
    // the front of this layer's slice. The pass that just ended is never one.
    const retired = new Set(mine.slice(0, mine.length + 1 - TAKE_MAX_PER_LAYER).map((entry) => entry.id));
    list = list.filter((entry) => !retired.has(entry.id));
  }
  return { song: withTakes(song, list, take.id), take };
}

/**
 * Merge every take of one layer into a single take, oldest material first.
 *
 * `union` (the default, and the only strategy P5.4 had) overlays every pass, so
 * the result plays everything any of them played. `overwrite` lets each newer
 * pass replace the older material that sounds at the same time, which is how a
 * player comps one line out of two tries without keeping both strikes. The two
 * differ exactly when an older take holds a note the newer one plays over; with
 * straight-line overdubs, where each take already contains the one before it,
 * they agree — which is why the chooser explains the difference instead of
 * pretending it is always audible.
 *
 * Fewer than two takes is a no-op: there is nothing to merge.
 */
export function mergeTakes(
  takes: MidiTake[],
  layer: number,
  options: { name?: string; at?: number; strategy?: MergeStrategy } = {},
): { takes: MidiTake[]; take: MidiTake | null } {
  const mine = takesOfLayer(takes, layer);
  if (mine.length < 2) return { takes, take: null };
  const strategy = options.strategy ?? 'union';
  let notes: MidiNote[] = [];
  for (const take of mine) {
    notes =
      strategy === 'overwrite' ? mergeNotesOverwrite(notes, take.notes) : mergeNotes(notes, take.notes);
  }
  const merged: MidiTake = {
    id: nextId(),
    name: options.name?.trim().slice(0, 60) || 'Merged',
    layer,
    notes,
    createdAt: options.at ?? Date.now(),
  };
  return { takes: [...takes.filter((take) => take.layer !== layer), merged], take: merged };
}

/**
 * Drop one take. When the selected take goes, the newest take left on that
 * layer becomes the selected one — and when none is left, the layer keeps the
 * notes it was playing, so deleting the last take never silences the layer.
 */
export function removeTake(
  takes: MidiTake[],
  id: string,
  takeId: string | undefined,
): { takes: MidiTake[]; takeId: string | undefined } {
  const gone = takes.find((take) => take.id === id);
  const list = takes.filter((take) => take.id !== id);
  if (takeId !== id || !gone) return { takes: list, takeId };
  const fallback = takesOfLayer(list, gone.layer).pop();
  return { takes: list, takeId: fallback?.id };
}

export function renameTake(takes: MidiTake[], id: string, name: string): MidiTake[] {
  const clean = name.trim().slice(0, 60);
  if (!clean) return takes;
  return takes.map((take) => (take.id === id ? { ...take, name: clean } : take));
}
