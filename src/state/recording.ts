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
  layerFoldedIntoClips,
  mergeTakes,
  overdubTake,
  removeTake,
  renameTake as renameTakeInList,
  syncTakeFromLayer,
  takesOf,
  takesOfLayer,
  withTakes,
  type MergeStrategy,
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
  const layer = recordingLayer();
  const take = saveRecordingTake(clip.notes, { grid });
  if (!take) return null;
  // The saved-take message is the one the recorder has always shown, with the
  // already-localised grid label appended: a second string that says the same
  // thing would be one more thing to keep in step in two languages. A folded
  // layer gets the folded note appended for the same reason: the pass is kept
  // as material (losing a performance is the one thing the model refuses), but
  // it is not what the layer plays, and saying nothing would make the recording
  // look like it vanished (P10.3).
  const gridLabel = grid === 'off' ? '' : ` · ${quantiseLabel(grid, getLang())}`;
  const folded = midiLibrary.getCurrent();
  const arranged = folded && layerFoldedIntoClips(folded.song, layer) ? ` · ${t('take.foldedHint')}` : '';
  toast(`${t('player.clipSaved', { n: String(take.notes.length) })}${gridLabel}${arranged}`);
  return take;
}

/**
 * Select a take: its layer plays it from here on, and every export follows.
 *
 * A folded layer is the one place that promise cannot be kept: its clips are
 * the plan and re-expansion runs last, so writing the take into the layer would
 * be undone in the same call and the user would have switched take with nothing
 * to hear. Say that instead, and change nothing (P10.3). Returns whether the
 * selection was applied, so a caller can keep its own idea of "current" in step.
 */
export function selectTake(takeId: string): boolean {
  const current = midiLibrary.getCurrent();
  if (!current) return false;
  const takes = takesOf(current.song);
  const take = takes.find((entry) => entry.id === takeId);
  if (!take) return false;
  if (layerFoldedIntoClips(current.song, take.layer)) {
    toast(t('take.foldedHint'));
    return false;
  }
  commitSong(withTakes(current.song, takes, takeId));
  return true;
}

/**
 * Merge the current layer's takes into one. `union` lays every pass on top of
 * the others; `overwrite` lets each newer pass replace the older notes it plays
 * over. A folded layer is refused with the same reason a take switch is: the
 * merged take would be stored material the layer does not play, and the user
 * would have merged "successfully" and heard nothing.
 */
export function mergeLayerTakes(strategy: MergeStrategy = 'union'): void {
  const current = midiLibrary.getCurrent();
  if (!current) return;
  const layer = recordingLayer();
  if (layerFoldedIntoClips(current.song, layer)) {
    toast(t('take.foldedHint'));
    return;
  }
  const name = strategy === 'overwrite' ? t('take.mergeOverwrite') : t('take.mergeUnion');
  const { takes, take } = mergeTakes(takesOf(current.song), layer, { name, strategy });
  if (!take) return;
  commitSong(withTakes(current.song, takes, take.id));
}

/**
 * Rename one take. Naming is material, not arrangement, so it is allowed on a
 * folded layer too — it changes nothing anyone hears, and the name is exactly
 * what identifies the take as material. One call is one undo step, and an empty
 * or unchanged name records nothing at all.
 */
export function renameTake(takeId: string, name: string): boolean {
  const current = midiLibrary.getCurrent();
  if (!current) return false;
  const takes = takesOf(current.song);
  const before = takes.find((take) => take.id === takeId);
  if (!before) return false;
  const clean = name.trim().slice(0, 60);
  if (!clean || clean === before.name) return false;
  commitSong({ ...current.song, takes: renameTakeInList(takes, takeId, clean) });
  return true;
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
