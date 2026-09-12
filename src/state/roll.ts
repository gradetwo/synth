/**
 * The editing session shared by the piano roll and the layer strip.
 *
 * Both views edit the *same* song: the strip is a zoomed-out view of one layer,
 * the roll is the detailed one. They therefore cannot each own a working copy —
 * a note dragged on the strip has to appear in the roll, and undo has to mean
 * the same thing in both. This module owns that single document plus its undo
 * history, and the two components only render it.
 *
 * The document is one *layer* of the current track (in beats, at the song's
 * tempo), because that is the smallest thing a user edits; writing it back goes
 * through `withLayerNotes`, which keeps every other layer and the flat note list
 * the transport schedules from in step.
 *
 * Persistence is deliberately eager: an edit lands in the library (and so in
 * localStorage) as soon as the gesture ends, which is what makes "reload and the
 * note is still moved" true. It also records one store history entry per edit,
 * so the app-wide undo covers arrangement changes, not just patch changes.
 *
 * The player is reloaded on a short debounce during a drag and immediately when a
 * gesture ends. A reload is not free (it rebuilds every scheduled event), and a
 * drag emits one per pointermove without that debounce.
 */
import { useSyncExternalStore } from 'react';
import {
  CLIP_MIN_LENGTH,
  clipWithNotes,
  clipsOf,
  clipsOfLayer,
  duplicateClip,
  foldLayer,
  moveClip,
  removeClip,
  repeatClip,
  resizeClip,
  withClips,
  type MidiClip,
} from '@/midi/clips';
import { midiLibrary } from '@/midi/library';
import { midiPlayer } from '@/midi/player';
import { syncTakeFromLayer } from '@/midi/take-edit';
import {
  emptyDoc,
  notesToRoll,
  rollToNotes,
  secondsPerBeat,
  songLayerToRoll,
  updateNote,
  withLayerNotes,
  type RollDoc,
} from '@/midi/roll';
import type { MidiSong } from '@/midi/smf';
import { store } from '@/state/store';

/** Fields a caller may patch on a note through `nudge`. */
export type NotePatch = Parameters<typeof updateNote>[2];

/** Grid the strip snaps to: a sixteenth note, i.e. a quarter of a beat. */
export const STRIP_SNAP = 0.25;
/** Undo depth. Deep enough for a session's worth of note edits, bounded. */
const MAX_HISTORY = 80;

export interface RollState {
  doc: RollDoc;
  /** Track the document belongs to, or null when the library is empty. */
  trackId: string | null;
  /** Which layer of that track is loaded. */
  layerIndex: number;
  /**
   * Which of that layer's arrangement clips is loaded, when the layer has any
   * (P5.2). Null means the layer's notes themselves are the document.
   */
  clipId: string | null;
  /** Grid in beats, shared by both editors. */
  snap: number;
  canUndo: boolean;
  canRedo: boolean;
  /** True when the document has edits that are not written to the library yet. */
  pendingSync: boolean;
  /**
   * An edit could not go to the built-in demo and became a copy. The editors
   * show this once, so a silent track switch never happens without a word.
   */
  justCopied: boolean;
  /** Name of the copy that was just created, for that message. */
  copiedName: string;
}

class RollSession {
  private doc: RollDoc = emptyDoc();
  private base: MidiSong | null = null;
  private trackId: string | null = null;
  private layerIndex = 0;
  private clipId: string | null = null;
  private snap = STRIP_SNAP;
  private past: RollDoc[] = [];
  private future: RollDoc[] = [];
  private timer: number | undefined;
  /** Set while this session is the one writing to the library. */
  private writing = false;
  /** Localised title for a copy that an edit to a built-in demo creates. */
  private copyTitle = '';
  private justCopied = false;
  private copiedName = '';
  /** Where the next preview should start, set by step input and its kin. */
  private seekBeats: number | undefined;
  private listeners = new Set<() => void>();
  private cache: RollState;
  /** Song object identity the document was built from, to spot outside edits. */
  private source: MidiSong | null = null;

  constructor() {
    this.cache = this.build();
    // An undo, a share-code import or a track switch replaces the song behind
    // our back; the working copy has to follow or the strip would keep drawing
    // notes that are no longer in the song.
    midiLibrary.subscribe(() => this.follow());
  }

  private build(): RollState {
    return {
      doc: this.doc,
      trackId: this.trackId,
      layerIndex: this.layerIndex,
      clipId: this.clipId,
      snap: this.snap,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      pendingSync: this.timer !== undefined,
      justCopied: this.justCopied,
      copiedName: this.copiedName,
    };
  }

  private emit(): void {
    this.cache = this.build();
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): RollState => this.cache;

  /** The document as it should be rendered right now. */
  getDoc(): RollDoc {
    return this.doc;
  }

  /** The song the document belongs to, with the edit written back. */
  getSong(): MidiSong | null {
    if (!this.base) return null;
    if (this.clipId) {
      const clips = clipWithNotes(clipsOf(this.base), this.clipId, rollToNotes(this.doc));
      // A clip that vanished (an undo, a track switch) falls back to the layer:
      // the document is still the user's music, it just has nowhere else to go.
      if (clips.some((clip) => clip.id === this.clipId)) return withClips(this.base, clips);
    }
    return withLayerNotes(this.base, this.layerIndex, this.doc);
  }

  getTrackId(): string | null {
    return this.trackId;
  }

  getLayerIndex(): number {
    return this.layerIndex;
  }

  /**
   * Load the current library track (called when an editor opens). `layerIndex`
   * is clamped to the song's layers, so a stale index from a previous song
   * cannot point at nothing.
   */
  open(layerIndex = this.layerIndex, clipId?: string | null): void {
    const track = midiLibrary.getCurrent();
    this.base = track?.song ?? null;
    this.source = track?.song ?? null;
    this.trackId = track?.id ?? null;
    const layers = this.layerCount(track?.song ?? null);
    this.layerIndex = Math.max(0, Math.min(layerIndex, layers - 1));
    // A layer with an arrangement is edited through its clips: the flat note
    // list is their expansion, and editing that would be editing a copy.
    const mine = this.base ? clipsOfLayer(clipsOf(this.base), this.layerIndex) : [];
    const chosen =
      clipId === null
        ? null
        : clipId !== undefined
          ? (mine.find((clip) => clip.id === clipId) ?? null)
          : (mine[0] ?? null);
    this.clipId = chosen?.id ?? null;
    this.doc = this.base ? this.documentFor() : emptyDoc();
    this.past = [];
    this.future = [];
    this.emit();
  }

  /** The document the session is pointed at: a clip's notes, or the layer's. */
  private documentFor(): RollDoc {
    if (!this.base) return emptyDoc();
    if (this.clipId) {
      const clip = clipsOf(this.base).find((entry) => entry.id === this.clipId);
      if (clip) return notesToRoll(clip.notes, this.base.bpm, clip.name);
    }
    return songLayerToRoll(this.base, this.layerIndex);
  }

  /** Switch to another clip of the current layer (the strip and the roll both do). */
  setClip(clipId: string | null): void {
    if (clipId === this.clipId) return;
    this.clipId = clipId;
    this.doc = this.documentFor();
    // The document changed wholesale, so the history starts over, exactly as it
    // does across a layer switch.
    this.past = [];
    this.future = [];
    this.emit();
  }

  private layerCount(song: MidiSong | null): number {
    if (!song) return 1;
    return song.tracks && song.tracks.length ? song.tracks.length : 1;
  }

  /** Switch to another layer of the same song (the strip's rows, the roll's picker). */
  setLayer(index: number): void {
    if (index === this.layerIndex) return;
    const limit = this.layerCount(this.base);
    const next = Math.max(0, Math.min(index, limit - 1));
    this.layerIndex = next;
    // Each layer is edited through its own clips, if it has any.
    this.clipId = this.base ? (clipsOfLayer(clipsOf(this.base), next)[0]?.id ?? null) : null;
    if (this.base) this.doc = this.documentFor();
    // Undo across a layer switch would drop the user into another layer's
    // history; the document changed wholesale, so the stack starts over.
    this.past = [];
    this.future = [];
    this.emit();
  }

  setSnap(snap: number): void {
    if (snap === this.snap) return;
    this.snap = snap;
    this.emit();
  }

  /**
   * The library changed under us. Two cases matter: this session wrote it (then
   * the working copy is already correct), and something else did — an undo, a
   * share import, a different track — where the only safe move is to reload.
   */
  private follow(): void {
    if (this.writing) return;
    const track = midiLibrary.getCurrent();
    if (!track) return;
    // Same song object and same track: our own previews do not touch the
    // library, so nothing to do. A different object means new content.
    if (track.id === this.trackId && track.song === this.source) return;
    this.open(this.layerIndex);
  }

  /**
   * Replace the document. `record` keeps an undo step, `persist` writes it to the
   * library (and the store's history), `sync` reloads the player now instead of
   * after the debounce.
   */
  commit(
    next: RollDoc,
    options: { record?: boolean; persist?: boolean; sync?: boolean; seekBeats?: number } = {},
  ): void {
    const { record = true, persist = true, sync = false, seekBeats } = options;
    this.seekBeats = seekBeats;
    if (next === this.doc) return;
    if (record) {
      this.past.push(this.doc);
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
    }
    this.doc = next;
    if (persist) this.persist();
    if (sync || seekBeats !== undefined) this.syncNow();
    else this.scheduleSync();
    this.emit();
  }

  /** Force a write to the library (the roll's save button). */
  saveNow(): void {
    if (!this.base) return;
    this.persist();
    this.emit();
  }

  /** A live drag: the document follows the pointer, history waits for the end. */
  live(next: RollDoc): void {
    if (next === this.doc) return;
    this.doc = next;
    this.scheduleSync();
    this.emit();
  }

  /**
   * End a gesture: write the document out and reload the player once. Called on
   * pointerup, so a drag costs one history entry and one preview.
   */
  settle(from: RollDoc): void {
    if (from === this.doc) return;
    this.past.push(from);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.persist();
    this.syncNow();
    this.emit();
  }

  private persist(): void {
    if (!this.base) return;
    const song = this.getSong();
    if (!song) return;
    // While a take is selected its notes *are* the layer's notes, so an edit
    // made here has to land in the take as well or the take the chips show
    // (and switch back to) would be the one from before the edit (P5.4).
    const stored = syncTakeFromLayer(song);
    this.writing = true;
    try {
      // A built-in demo is not ours to overwrite; the library makes a copy, and
      // the friendly name for it comes from the caller's translated title, so
      // the fallback here is the song's own name.
      const before = this.trackId;
      // Only a built-in demo needs a copy name; after the first edit the track
      // is ours and later edits go straight into it.
      const current = midiLibrary.getCurrent();
      const needsCopy = !current || current.id.startsWith('demo:');
      this.trackId = midiLibrary.putSong(
        stored,
        needsCopy && this.copyTitle ? { copyOf: this.copyTitle } : {},
      );
      // What was written is what the next edit builds on, arrangement and all.
      this.base = stored;
      if (this.trackId !== before) {
        this.justCopied = true;
        this.copiedName = midiLibrary.getCurrent()?.title[0] ?? song.name;
      }
      this.source = midiLibrary.getCurrent()?.song ?? null;
    } finally {
      this.writing = false;
    }
    store.mark();
  }

  private syncNow(): void {
    if (typeof window === 'undefined') {
      this.syncPlayer(this.seekBeats);
      this.seekBeats = undefined;
      return;
    }
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.syncPlayer(this.seekBeats);
    this.seekBeats = undefined;
  }

  private scheduleSync(): void {
    if (typeof window === 'undefined') {
      this.syncPlayer();
      return;
    }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.syncPlayer();
      this.emit();
    }, 140);
  }

  /**
   * Put the edited song on the transport without losing the listener's place:
   * a preview reload keeps the mix, the playhead and whether it was playing.
   */
  private syncPlayer(seekBeats?: number): void {
    const song = this.getSong();
    if (!song) return;
    const state = midiPlayer.getState();
    const time = seekBeats === undefined ? state.time : seekBeats * secondsPerBeat(song.bpm);
    midiPlayer.load(song, { keepMix: true });
    const duration = midiPlayer.getState().duration;
    if (time > 0) midiPlayer.seek(Math.min(time, duration));
    if (state.playing) midiPlayer.play();
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.doc);
    this.doc = prev;
    this.persist();
    this.syncNow();
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.doc);
    this.doc = next;
    this.persist();
    this.syncNow();
    this.emit();
    return true;
  }

  /** Nudge one note, as the strip's +/- buttons do. Recorded as one step. */
  nudge(id: string, patch: NotePatch, options: { record?: boolean } = {}): void {
    const next = updateNote(this.doc, id, patch);
    this.commit(next, { record: options.record ?? true, sync: true });
  }

  // ------------------------------------------------------------ arrangement

  /**
   * Change the arrangement (move a clip, repeat it, copy it…) and write it out.
   *
   * The clip list is part of the song, so a change goes through the same path a
   * note edit does: persisted at once, one store history entry, the player
   * reloaded with the listener's place kept.
   */
  arrange(mutate: (clips: MidiClip[]) => MidiClip[]): void {
    if (!this.base) return;
    const next = mutate(clipsOf(this.base));
    this.base = withClips(this.base, next);
    // A clip that is gone takes the document with it.
    if (this.clipId && !next.some((clip) => clip.id === this.clipId)) {
      this.clipId = next.find((clip) => (clip.layer ?? 0) === this.layerIndex)?.id ?? null;
      this.doc = this.documentFor();
      this.past = [];
      this.future = [];
    }
    this.persist();
    this.syncNow();
    this.emit();
  }

  /** Fold one layer into a clip: its notes become the arrangement. */
  fold(layerIndex: number, name?: string): string | null {
    if (!this.base) return null;
    const { song, clip } = foldLayer(this.base, layerIndex, { name });
    this.base = song;
    this.layerIndex = Math.max(0, Math.min(layerIndex, this.layerCount(song) - 1));
    this.clipId = clip.id;
    this.doc = this.documentFor();
    this.past = [];
    this.future = [];
    this.persist();
    this.syncNow();
    this.emit();
    return clip.id;
  }

  /** Auto-arrangement helpers, applied to whichever clip is selected. */
  moveClip(id: string, start: number): void {
    this.arrange((clips) => moveClip(clips, id, start));
  }

  nudgeClip(id: string, delta: number): void {
    const clip = this.clip(id);
    if (clip) this.arrange((clips) => moveClip(clips, id, clip.start + delta));
  }

  repeat(id: string, delta: number): void {
    const clip = this.clip(id);
    if (clip) this.arrange((clips) => repeatClip(clips, id, clip.repeat + delta));
  }

  /** Widen or narrow a clip's loop window, by a fraction of its own length. */
  resize(id: string, delta: number): void {
    const clip = this.clip(id);
    if (clip) this.arrange((clips) => resizeClip(clips, id, Math.max(CLIP_MIN_LENGTH, clip.length + delta)));
  }

  copy(id: string): string | null {
    const before = this.base ? clipsOf(this.base).map((clip) => clip.id) : [];
    this.arrange((clips) => duplicateClip(clips, id));
    const added = this.base ? clipsOf(this.base).find((clip) => !before.includes(clip.id)) : undefined;
    if (added) this.setClip(added.id);
    return added?.id ?? null;
  }

  remove(id: string): void {
    this.arrange((clips) => removeClip(clips, id));
  }

  rename(id: string, name: string): void {
    this.arrange((clips) =>
      clips.map((clip) => (clip.id === id ? { ...clip, name: name.trim().slice(0, 60) || clip.name } : clip)),
    );
  }

  /** One clip of the current song, by id. */
  clip(id: string): MidiClip | undefined {
    return this.base ? clipsOf(this.base).find((clip) => clip.id === id) : undefined;
  }

  /** Called once the copy message has been shown. */
  acknowledgeCopy(): void {
    if (!this.justCopied) return;
    this.justCopied = false;
    this.emit();
  }

  /** Title to give a copy when an edit has to create one (see `putSong`). */
  setCopyTitle(title: string): void {
    this.copyTitle = title;
  }

  /** Rename the document (the roll's title field / a save-as). */
  setName(name: string): void {
    if (name === this.doc.name) return;
    this.doc = { ...this.doc, name };
    this.emit();
  }

}

export const rollSession = new RollSession();

/** React binding: the whole session state, re-read on every change. */
export function useRollSession(): RollState {
  return useSyncExternalStore(rollSession.subscribe, rollSession.getState, rollSession.getState);
}
