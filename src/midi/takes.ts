/**
 * Recorded takes (P5.4) — the stored shape and its reader.
 *
 * A take is one performance of one layer: the notes it plays, in absolute
 * seconds, plus a name. The layer's *content* is the take that is selected;
 * every other take is an alternate the user can switch back to. That is what
 * makes recording non-destructive: a second pass over the same bars does not
 * erase the first one, it becomes a new take whose notes are the previous
 * take's notes with the new ones overlaid.
 *
 * The model is deliberately the same shape the arrangement clips use (P5.2):
 * `song.notes` and every `tracks[].notes` are the *expansion*, so the player,
 * the piano roll, the share code and every export keep reading one flat list
 * and none of them has to learn what a take is. Only the selected take is
 * written into its layer — a take belongs to the layer it was recorded on, and
 * recording in a DAW is always "the take of the layer I am on".
 *
 * One invariant keeps edits and takes from fighting each other: while a take is
 * selected, its notes and its layer's notes are the same material. Every writer
 * of a layer keeps them that way (`syncTakeFromLayer`), which is also why this
 * reader validates the stored takes but does not re-expand them: the layer
 * notes *are* the take that was selected when the file was written. A layer
 * that is arranged with clips is the exception — an arrangement is a *plan* for
 * the layer, so the clips win and the take stays untouched material.
 *
 * Everything that reads or changes a live take — the accessors, the selected
 * take, overdub, merge, delete — lives in `take-edit.ts`. That split is for the
 * first-load bundle, not for taste: the library validates the takes of every
 * stored song at boot, while the rest is only ever reached from the recording
 * session and the take chips, which are lazy chunks.
 */

import { normalizeStoredNotes } from './smf';
import type { MidiNote } from './smf';

export interface MidiTake {
  id: string;
  /** Shown on the take chip; the recording path gives it a localised name. */
  name: string;
  /** Which layer of the song the take replaces. */
  layer: number;
  /** Notes in absolute seconds, in song time (already quantised when asked). */
  notes: MidiNote[];
  /** When it was recorded (ms since epoch), for ordering and display. */
  createdAt?: number;
}

/**
 * Most takes one layer may hold. Every take stores the whole layer's notes, so
 * this is also the memory bound; at the cap the oldest take of that layer is
 * retired rather than refusing a recording, because losing the session's most
 * recent performance to a full list is the one outcome a player cannot undo.
 */
export const TAKE_MAX_PER_LAYER = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const sortNotes = (notes: MidiNote[]): MidiNote[] =>
  [...notes].sort((a, b) => a.start - b.start || a.note - b.note);

/**
 * Read stored takes without trusting their shape. Broken takes are dropped, and
 * per-layer overflow (a file edited by hand) keeps the newest.
 */
export function normalizeTakes(raw: unknown): MidiTake[] {
  if (!Array.isArray(raw)) return [];
  const out: MidiTake[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const take = entry as Partial<MidiTake>;
    if (typeof take.id !== 'string' || !take.id || seen.has(take.id)) continue;
    if (!Array.isArray(take.notes)) continue;
    const notes = normalizeStoredNotes(take.notes, true);
    const layer = clamp(Math.round(Number(take.layer) || 0), 0, 15);
    // A take with no notes is not a performance: dropping it also keeps the
    // list from filling with empty chips a corrupt file left behind.
    if (notes.length === 0) continue;
    seen.add(take.id);
    out.push({
      id: take.id,
      name: typeof take.name === 'string' && take.name.trim() ? take.name.trim().slice(0, 60) : 'Take',
      layer,
      notes: sortNotes(notes),
      ...(Number.isFinite(take.createdAt) ? { createdAt: Number(take.createdAt) } : {}),
    });
  }
  // The per-layer cap is enforced on read as well as on write, so a hand-edited
  // file cannot make the strip unbounded. Retiring the oldest is done by id and
  // the original order is kept, so importing and re-storing is stable.
  const retired = new Set<string>();
  for (const layer of new Set(out.map((take) => take.layer))) {
    const mine = out.filter((take) => take.layer === layer);
    for (const take of mine.slice(0, Math.max(0, mine.length - TAKE_MAX_PER_LAYER))) retired.add(take.id);
  }
  return out.filter((take) => !retired.has(take.id));
}
