/**
 * Recording into takes (P5.4).
 *
 * The recorder itself stays what it was — a subscriber that turns played notes
 * into seconds. What lives here is the *commit* half, shared by the three
 * places that stop a recording (the player panel, the performance bar and the
 * roll's "edit" button used to each keep their own copy of this):
 *
 *   * which layer is being recorded into,
 *   * the quantise choice, applied as the take is saved exactly as before,
 *   * the write to the library plus one app-wide undo step,
 *   * the transport reload, so what was just played is what is heard.
 *
 * A finished recording becomes a *new take* whose notes are the current take's
 * notes with the new pass overlaid — an overdub that loses nothing and leaves
 * the take it grew out of in the list to compare against. See `midi/takes.ts`
 * for the model and the same-pitch rule.
 */

import { getLang, t } from '@/i18n';
import { toast } from '@/components/Toast';
import { midiLibrary, trackTitle } from '@/midi/library';
import { midiPlayer } from '@/midi/player';
import { quantiseLabel, quantiseNotes, type QuantiseGrid } from '@/midi/quantise';
import type { MidiNote, MidiSong } from '@/midi/smf';
import {
  mergeTakes,
  overdubTake,
  removeTake,
  syncTakeFromLayer,
  takesOf,
  takesOfLayer,
  withTakes,
} from '@/midi/take-edit';
import type { MidiTake } from '@/midi/takes';
import { store } from '@/state/store';
import { rollSession } from '@/state/roll';

/**
 * The layer a recording lands on: the one the strip and the roll are pointed
 * at. A session that is looking at a different track (or at nothing yet) means
 * the first layer, which is also the only layer of a plain one-track song.
 */
export function recordingLayer(): number {
  const current = midiLibrary.getCurrent();
  if (!current) return 0;
  return rollSession.getTrackId() === current.id ? rollSession.getLayerIndex() : 0;
}

/**
 * Write a song back to the current track: library, undo history and transport.
 *
 * A built-in demo cannot be overwritten — it comes from the build — so the
 * first take recorded over one becomes a copy, the same trade the roll makes
 * for an edit. The player is reloaded with the mix and the listener's place
 * kept, and only resumed if it was already running.
 */
function commitSong(song: MidiSong): void {
  const current = midiLibrary.getCurrent();
  if (!current) return;
  const copy = current.id.startsWith('demo:');
  // The selected take and its layer are written as one: a take that is selected
  // *is* the layer's content, and every writer keeps them that way (P5.4).
  const stored = syncTakeFromLayer(song);
  midiLibrary.putSong(stored, copy ? { copyOf: trackTitle(current) } : {});
  store.mark();
  const state = midiPlayer.getState();
  midiPlayer.load(stored, { keepMix: true });
  if (state.time > 0) midiPlayer.seek(Math.min(state.time, midiPlayer.getState().duration));
  if (state.playing) midiPlayer.play();
}

/**
 * Save a finished recording as a new take over the current layer. Returns the
 * take (for the panel's message) or null when there is nothing to save.
 */
export function saveRecordingTake(notes: MidiNote[], options: { grid: QuantiseGrid }): MidiTake | null {
  const current = midiLibrary.getCurrent();
  if (!current || notes.length === 0) return null;
  // Quantising is a per-recording decision, applied as the take is saved — and
  // only to the pass that just arrived: the take it overlays is already tidy.
  const quantised =
    options.grid === 'off' ? notes.map((note) => ({ ...note })) : quantiseNotes(notes, options.grid, current.song.bpm);
  const layer = recordingLayer();
  const n = takesOfLayer(takesOf(current.song), layer).length + 1;
  const { song, take } = overdubTake(current.song, layer, quantised, {
    name: t('take.defaultName', { n: String(n) }),
  });
  commitSong(song);
  return take;
}

/**
 * Commit a finished recording and say what was saved.
 *
 * This is the one call the three places that stop a recording make, so the
 * quantise setting, the take's name and the message the player sees cannot
 * drift apart between the transport, the performance bar and the roll.
 */
export function finishRecording(clip: MidiSong): MidiTake | null {
  const grid = store.getSnapshot().layout.recordQuantise as QuantiseGrid;
  const take = saveRecordingTake(clip.notes, { grid });
  if (!take) return null;
  // The saved-take message is the one the recorder has always shown, with the
  // already-localised grid label appended: a second string that says the same
  // thing would be one more thing to keep in step in two languages.
  const gridLabel = grid === 'off' ? '' : ` · ${quantiseLabel(grid, getLang())}`;
  toast(`${t('player.clipSaved', { n: String(take.notes.length) })}${gridLabel}`);
  return take;
}

/** Select a take: its layer plays it from here on, and every export follows. */
export function selectTake(takeId: string): void {
  const current = midiLibrary.getCurrent();
  if (!current) return;
  const takes = takesOf(current.song);
  if (!takes.some((take) => take.id === takeId)) return;
  commitSong(withTakes(current.song, takes, takeId));
}

/**
 * Merge the current layer's takes into one, oldest material first. This is how
 * a pile of passes becomes a single performance without anything being lost.
 */
export function mergeLayerTakes(): void {
  const current = midiLibrary.getCurrent();
  if (!current) return;
  const layer = recordingLayer();
  const { takes, take } = mergeTakes(takesOf(current.song), layer, { name: t('take.merge') });
  if (!take) return;
  commitSong(withTakes(current.song, takes, take.id));
}

/**
 * Delete one take. When it was the selected one the newest take left on that
 * layer takes over; deleting the last take leaves the layer playing what it
 * already played, so the material is never lost by tidying up.
 */
export function deleteTake(takeId: string): void {
  const current = midiLibrary.getCurrent();
  if (!current) return;
  const { takes, takeId: next } = removeTake(takesOf(current.song), takeId, current.song.takeId);
  commitSong(withTakes(current.song, takes, next));
}
