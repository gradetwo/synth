/**
 * MIDI library: the built-in demo playlist plus imported files and recordings.
 *
 * One shared instance so the player panel and the signal-flow performance bar
 * always see the same track list and transport state.
 */

import { getLang } from '@/i18n';
import { midiPlayer } from './player';
import { DEMO_SONGS, specToSong } from './songs';
import type { MidiSong } from './smf';

export type TrackGroup = 'builtin' | 'imported' | 'clip';

export interface Track {
  id: string;
  /** Bilingual title; imported/clip tracks repeat the same string. */
  title: [string, string];
  composer: string;
  song: MidiSong;
  group: TrackGroup;
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

class MidiLibrary {
  private tracks: Track[] = builtinTracks();
  private currentId: string;
  private listeners = new Set<() => void>();

  constructor() {
    this.currentId = this.tracks.find((track) => track.id === 'demo:arpeggio')?.id ?? this.tracks[0].id;
    midiPlayer.load(this.getCurrent()!.song);
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
    if (options.autoplay !== false) midiPlayer.play();
    this.emit();
  }

  /** Add or replace an imported file / recording (never auto-plays). */
  put(track: Track): void {
    this.tracks = [...this.tracks.filter((tr) => tr.id !== track.id), track];
    this.currentId = track.id;
    midiPlayer.load(track.song);
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
    this.emit();
  }

  /** Remove a track; the built-ins cannot be removed. */
  remove(id: string): void {
    if (id.startsWith('demo:')) return;
    this.tracks = this.tracks.filter((tr) => tr.id !== id);
    if (this.currentId === id) this.setCurrent(this.tracks[0]?.id ?? '', { autoplay: false });
    else this.emit();
  }
}

export const midiLibrary = new MidiLibrary();
