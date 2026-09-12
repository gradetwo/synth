/**
 * MIDI library: the built-in demo playlist plus imported files and recordings.
 *
 * One shared instance so the player panel and the signal-flow performance bar
 * always see the same track list and transport state.
 */

import { getLang } from '@/i18n';
import { midiPlayer } from './player';
import { DEMO_SONGS, specToSong } from './songs';
import { normalizeClips, withClips } from './clips';
import type { MidiSong } from './smf';
import { unwrap, wrap } from '@/state/persist';

const KEY = 'gs1:library:v1';
/** Most user tracks kept on disk; the newest win (a phone's storage is finite). */
const MAX_STORED_TRACKS = 12;
/** A track whose JSON is larger than this stays in memory for the session. */
const MAX_STORED_BYTES = 512 * 1024;

export type TrackGroup = 'builtin' | 'imported' | 'clip';

export interface Track {
  id: string;
  /** Bilingual title; imported/clip tracks repeat the same string. */
  title: [string, string];
  composer: string;
  song: MidiSong;
  group: TrackGroup;
  /**
   * Per-layer mute/solo/level for a multi-track song. A mix is part of the
   * song you loaded, not of this listening session, so it is stored with it.
   */
  mix?: {
    muted?: boolean;
    soloed?: boolean;
    volume?: number;
    offset?: number;
    pan?: number;
  }[];
}

export function trackTitle(track: Track): string {
  return getLang() === 'zh' ? track.title[0] : track.title[1];
}

function builtinTracks(): Track[] {
  return DEMO_SONGS.map((spec) => ({
    id: `demo:${spec.id}`,
    title: spec.title,
    composer: spec.composer,
    song: specToSong(spec),
    group: 'builtin' as const,
  }));
}

/** Validate a stored song: a broken one is dropped rather than played. */
function validSong(value: unknown): value is MidiSong {
  if (!value || typeof value !== 'object') return false;
  const song = value as MidiSong;
  if (!Array.isArray(song.notes) || typeof song.bpm !== 'number' || !Number.isFinite(song.bpm)) return false;
  return song.notes.every(
    (note) =>
      note &&
      typeof note === 'object' &&
      Number.isFinite(note.note) &&
      Number.isFinite(note.start) &&
      Number.isFinite(note.duration) &&
      Number.isFinite(note.velocity),
  );
}

/**
 * A song as it comes off disk.
 *
 * A stored arrangement is re-expanded rather than trusted: the flat note list is
 * what plays, and if a file was edited by hand (or written by a build with a
 * different expansion rule) the clips are the source of truth. Broken clips are
 * dropped, and a song whose clips all turn out to be broken keeps the flat list
 * it was stored with.
 */
function readSong(value: MidiSong): MidiSong {
  if (!value.clips) return value;
  const clips = normalizeClips(value.clips);
  return clips.length ? withClips(value, clips) : { ...value, clips: undefined };
}

function readStoredTracks(): Track[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const unwrapped = unwrap(JSON.parse(raw));
    if (!unwrapped) return [];
    const data = unwrapped.data as { tracks?: unknown };
    if (!Array.isArray(data.tracks)) return [];
    const out: Track[] = [];
    for (const entry of data.tracks) {
      if (!entry || typeof entry !== 'object') continue;
      const track = entry as Track;
      // Built-ins are not stored, and a track without a playable song is not a
      // track: skip it rather than adding a row that does nothing.
      if (typeof track.id !== 'string' || track.id.startsWith('demo:')) continue;
      if (!Array.isArray(track.title) || track.title.length < 2) continue;
      if (!validSong(track.song)) continue;
      const song = readSong(track.song);
      const mix = Array.isArray(track.mix)
        ? track.mix
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
              muted: entry.muted === true,
              soloed: entry.soloed === true,
              volume:
                typeof entry.volume === 'number' && Number.isFinite(entry.volume)
                  ? Math.max(0, Math.min(1, entry.volume))
                  : 1,
              offset:
                typeof entry.offset === 'number' && Number.isFinite(entry.offset)
                  ? Math.max(-60, Math.min(60, entry.offset))
                  : 0,
              pan:
                typeof entry.pan === 'number' && Number.isFinite(entry.pan)
                  ? Math.max(-1, Math.min(1, entry.pan))
                  : 0,
            }))
        : undefined;
      out.push({ ...track, song, mix, group: track.id.startsWith('clip') ? 'clip' : 'imported' });
    }
    return out;
  } catch {
    return [];
  }
}

function readStoredId(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const unwrapped = unwrap(JSON.parse(raw));
    const data = unwrapped?.data as { currentId?: unknown };
    return typeof data?.currentId === 'string' ? data.currentId : null;
  } catch {
    return null;
  }
}

/** Exported for the migration tests, which build one over a stored document. */
export class MidiLibrary {
  private tracks: Track[] = builtinTracks();
  private currentId: string;
  private listeners = new Set<() => void>();

  constructor() {
    // Imported files and recordings are the player's own work: bringing them
    // back after a reload is the difference between a toy and a tool. Built-ins
    // always come from the build, never from storage.
    this.tracks = [...this.tracks, ...readStoredTracks()];
    const stored = readStoredId();
    const fallback = this.tracks.find((track) => track.id === 'demo:arpeggio')?.id ?? this.tracks[0].id;
    this.currentId = stored && this.tracks.some((track) => track.id === stored) ? stored : fallback;
    const current = this.getCurrent();
    midiPlayer.load(current?.song ?? null);
    // The song's mix comes back with the song, not with the session.
    if (current) this.applyMix(current);
    // Anything that could not be stored is dropped here rather than lingering
    // in memory as a track that silently disappears on the next reload.
    this.persist();
  }

  private persist(): void {
    const userTracks = this.tracks.filter((track) => !track.id.startsWith('demo:'));
    const kept: Track[] = [];
    let bytes = 0;
    for (let index = userTracks.length - 1; index >= 0 && kept.length < MAX_STORED_TRACKS; index--) {
      const track = userTracks[index];
      const size = JSON.stringify(track.song).length;
      if (bytes + size > MAX_STORED_BYTES * MAX_STORED_TRACKS) break;
      bytes += size;
      kept.unshift(track);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(wrap({ tracks: kept, currentId: this.currentId })));
    } catch {
      // Storage full or unavailable: the library still works for this session.
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  getTracks(): Track[] {
    return this.tracks;
  }

  getCurrent(): Track | null {
    return this.tracks.find((track) => track.id === this.currentId) ?? this.tracks[0] ?? null;
  }

  getCurrentId(): string {
    return this.currentId;
  }

  /**
   * Select a track, load it and (unless disabled) start playback. Called from a
   * tap/click, so the audio context can be resumed inside the same gesture.
   */
  setCurrent(id: string, options: { autoplay?: boolean } = {}): void {
    const track = this.tracks.find((tr) => tr.id === id);
    if (!track) return;
    this.currentId = id;
    midiPlayer.load(track.song);
    this.applyMix(track);
    if (options.autoplay !== false) midiPlayer.play();
    this.persist();
    this.emit();
  }

  /** Add or replace an imported file / recording (never auto-plays). */
  put(track: Track): string {
    this.tracks = [...this.tracks.filter((tr) => tr.id !== track.id), track];
    this.currentId = track.id;
    midiPlayer.load(track.song);
    this.applyMix(track);
    this.persist();
    this.emit();
    return track.id;
  }

  /** Put a song's stored layer mix back onto the player. */
  private applyMix(track: Track): void {
    track.mix?.forEach((entry, index) => midiPlayer.setLayer(index, entry));
  }

  /**
   * Store an edited song on the current track.
   *
   * The piano roll and the layer strip edit a song in place, so this is the
   * write half of that loop: the track keeps its id, its mix and its place in
   * the list. A built-in demo cannot be edited — it comes from the build — so
   * an edit to one becomes a copy, the same trade the roll's save button makes.
   *
   * The player is deliberately *not* reloaded here: the caller is mid-gesture
   * and owns the transport, so a reload would stop playback and reset the
   * playhead on every drag.
   */
  putSong(song: MidiSong, options: { copyOf?: string } = {}): string {
    const current = this.getCurrent();
    const copy = options.copyOf !== undefined || !current || current.id.startsWith('demo:');
    if (!copy && current) {
      this.tracks = this.tracks.map((track) => (track.id === current.id ? { ...track, song } : track));
      this.persist();
      this.emit();
      return current.id;
    }
    const layers = midiPlayer.getLayers();
    const name = options.copyOf ?? song.name;
    const track: Track = {
      id: `clip:${Date.now()}`,
      title: [name, name],
      composer: current?.composer ?? 'GS-1',
      song,
      group: 'clip',
      // The arrangement you were listening to comes along with the copy.
      mix:
        layers.length > 1
          ? layers.map((layer) => ({
              muted: layer.muted,
              soloed: layer.soloed,
              volume: layer.volume,
              offset: layer.offset,
              pan: layer.pan,
            }))
          : undefined,
    };
    this.tracks = [...this.tracks, track];
    this.currentId = track.id;
    this.persist();
    this.emit();
    return track.id;
  }

  /** Save the player's current layer mix into the selected track. */
  saveMix(): void {
    const layers = midiPlayer.getLayers();
    if (layers.length < 2) return;
    const mix = layers.map((layer) => ({
      muted: layer.muted,
      soloed: layer.soloed,
      volume: layer.volume,
      offset: layer.offset,
      pan: layer.pan,
    }));
    this.tracks = this.tracks.map((track) =>
      track.id === this.currentId ? { ...track, mix } : track,
    );
    this.persist();
    // The strip reads the player's layers on every library change; without this
    // a mix applied from outside (a share code, an undo) left it showing the
    // values the track had before.
    this.emit();
  }

  /**
   * Non-built-in tracks plus the selection, for the store's undo history.
   * Songs are treated as immutable values (the roll always saves a fresh one),
   * so sharing the references is safe and keeps snapshots cheap.
   */
  snapshot(): { clips: Track[]; currentId: string } {
    return {
      clips: this.tracks.filter((track) => !track.id.startsWith('demo:')).map((t) => ({ ...t })),
      currentId: this.currentId,
    };
  }

  /** Put the user's tracks back exactly as they were (undo/redo). */
  restore(clips: Track[], currentId: string): void {
    const builtins = this.tracks.filter((track) => track.id.startsWith('demo:'));
    this.tracks = [...builtins, ...clips.map((t) => ({ ...t }))];
    const next = this.tracks.find((track) => track.id === currentId) ?? this.tracks[0] ?? null;
    this.currentId = next?.id ?? '';
    midiPlayer.load(next?.song ?? null);
    this.persist();
    this.emit();
  }

  /** Remove a track; the built-ins cannot be removed. */
  remove(id: string): void {
    if (id.startsWith('demo:')) return;
    this.tracks = this.tracks.filter((tr) => tr.id !== id);
    if (this.currentId === id) this.setCurrent(this.tracks[0]?.id ?? '', { autoplay: false });
    else {
      this.persist();
      this.emit();
    }
  }
}

export const midiLibrary = new MidiLibrary();
