/**
 * MIDI player.
 *
 * Drives `noteBus` from a flat note list. A requestAnimationFrame loop advances
 * song time and fires the note-on/off events whose timestamps have passed; the
 * resolution (~16 ms) is fine for a demo player and keeps the scheduler simple
 * and dependency-free.
 */

import { engine } from '@/audio/engine';
import { noteBus } from '@/audio/noteBus';
import type { MidiSong } from './smf';

interface TimedEvent {
  t: number;
  note: number;
  on: boolean;
  velocity: number;
}

export interface PlayerState {
  playing: boolean;
  /** Song position in seconds. */
  time: number;
  duration: number;
  loop: boolean;
  /** Tempo multiplier, 1 = as written. */
  rate: number;
  /** Semitone transposition applied at playback. */
  transpose: number;
}

function buildEvents(song: MidiSong | null): TimedEvent[] {
  if (!song) return [];
  const events: TimedEvent[] = [];
  for (const n of song.notes) {
    events.push({ t: n.start, note: n.note, on: true, velocity: n.velocity });
    events.push({ t: n.start + n.duration, note: n.note, on: false, velocity: n.velocity });
  }
  events.sort((a, b) => a.t - b.t || Number(b.on) - Number(a.on));
  return events;
}

export class MidiPlayer {
  private events: TimedEvent[] = [];
  private cursor = 0;
  private active = new Set<number>();
  private raf = 0;
  private resumeElapsed = 0;
  private resumeWall = 0;
  private listeners = new Set<(s: PlayerState) => void>();
  private state: PlayerState = { playing: false, time: 0, duration: 0, loop: false, rate: 1, transpose: 0 };

  /** Called when a non-looping song reaches its end. */
  onEnded: (() => void) | null = null;

  load(song: MidiSong | null): void {
    this.stop();
    this.events = buildEvents(song);
    this.cursor = 0;
    this.state = { ...this.state, time: 0, duration: song?.duration ?? 0 };
    this.emit();
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(fn: (s: PlayerState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  play(): void {
    if (this.state.playing || this.events.length === 0) return;
    if (this.state.time >= this.state.duration - 1e-3) this.seek(0);
    // Starting audio is a user gesture; use it to un-suspend iOS.
    void engine.resumeIfSuspended();
    this.resumeElapsed = this.state.time;
    this.resumeWall = performance.now();
    this.state = { ...this.state, playing: true };
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.state.playing) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resumeElapsed = this.state.time;
    this.releaseAll();
    this.state = { ...this.state, playing: false };
    this.emit();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.releaseAll();
    this.cursor = 0;
    this.resumeElapsed = 0;
    this.state = { ...this.state, playing: false, time: 0 };
    this.emit();
  }

  seek(seconds: number): void {
    const time = Math.max(0, Math.min(this.state.duration, seconds));
    this.releaseAll();
    this.resumeElapsed = time;
    this.resumeWall = performance.now();
    this.cursor = 0;
    while (this.cursor < this.events.length && this.events[this.cursor].t < time) this.cursor++;
    this.state = { ...this.state, time };
    this.emit();
  }

  setLoop(loop: boolean): void {
    this.state = { ...this.state, loop };
    this.emit();
  }

  setRate(rate: number): void {
    const clamped = Math.max(0.25, Math.min(2, rate));
    if (this.state.playing) {
      this.resumeElapsed = this.state.time;
      this.resumeWall = performance.now();
    }
    this.state = { ...this.state, rate: clamped };
    this.emit();
  }

  setTranspose(semitones: number): void {
    this.state = { ...this.state, transpose: Math.max(-24, Math.min(24, Math.round(semitones))) };
    this.emit();
  }

  private tick = (): void => {
    if (!this.state.playing) return;
    const now = performance.now();
    const target = this.resumeElapsed + ((now - this.resumeWall) / 1000) * this.state.rate;
    const duration = this.state.duration;

    if (target >= duration) {
      this.fireUpTo(duration);
      if (this.state.loop) {
        this.releaseAll();
        this.cursor = 0;
        this.resumeElapsed = 0;
        this.resumeWall = now;
        this.state = { ...this.state, time: 0 };
        this.emit();
        this.raf = requestAnimationFrame(this.tick);
        return;
      }
      this.state = { ...this.state, playing: false, time: duration };
      this.emit();
      this.onEnded?.();
      return;
    }

    this.fireUpTo(target);
    this.state = { ...this.state, time: target };
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  private fireUpTo(time: number): void {
    while (this.cursor < this.events.length && this.events[this.cursor].t <= time) {
      const event = this.events[this.cursor++];
      const note = Math.max(0, Math.min(127, event.note + this.state.transpose));
      if (event.on) {
        if (!this.active.has(note)) {
          this.active.add(note);
          noteBus.noteOn(note, event.velocity);
        }
      } else if (this.active.delete(note)) {
        noteBus.noteOff(note);
      }
    }
  }

  private releaseAll(): void {
    for (const note of this.active) noteBus.noteOff(note);
    this.active.clear();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const midiPlayer = new MidiPlayer();
