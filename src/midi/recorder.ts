/**
 * Live performance recorder.
 *
 * Subscribes to `noteBus` once and turns raw note events into a `MidiSong`.
 * Playback from the demo player is ignored, so recording captures only what the
 * user actually plays (screen keyboard, computer keyboard or MIDI input).
 */

import { noteBus } from '@/audio/noteBus';
import { midiPlayer } from './player';
import type { MidiNote, MidiSong } from './smf';

export interface RecorderState {
  recording: boolean;
  /** Notes captured so far (closed notes only, while recording). */
  notes: number;
  /** Seconds since the recording started. */
  elapsed: number;
}

class Recorder {
  private notes: MidiNote[] = [];
  private open = new Map<number, { start: number; velocity: number }>();
  private startWall = 0;
  private timer = 0;
  private clip: MidiSong | null = null;
  private listeners = new Set<(s: RecorderState) => void>();
  private state: RecorderState = { recording: false, notes: 0, elapsed: 0 };

  constructor() {
    noteBus.subscribeEvents((event) => this.capture(event));
  }

  private capture(event: { note: number; velocity: number; on: boolean }): void {
    if (!this.state.recording) return;
    // Never fold the demo player's own output into the recording.
    if (midiPlayer.getState().playing) return;
    const time = (performance.now() - this.startWall) / 1000;
    if (event.on) {
      this.open.set(event.note, { start: time, velocity: event.velocity });
      return;
    }
    const held = this.open.get(event.note);
    if (!held) return;
    this.open.delete(event.note);
    this.notes.push({
      note: event.note,
      velocity: held.velocity,
      start: held.start,
      duration: Math.max(0.03, time - held.start),
    });
    this.state = { ...this.state, notes: this.notes.length };
    this.publish();
  }

  private tick = (): void => {
    if (!this.state.recording) return;
    this.state = { ...this.state, elapsed: (performance.now() - this.startWall) / 1000 };
    this.publish();
  };

  start(): void {
    if (this.state.recording) return;
    this.notes = [];
    this.open.clear();
    this.clip = null;
    this.startWall = performance.now();
    this.state = { recording: true, notes: 0, elapsed: 0 };
    this.timer = window.setInterval(this.tick, 100);
    this.publish();
  }

  /** Finish the take and store it as the current clip. Returns the clip. */
  stop(): MidiSong | null {
    if (!this.state.recording) return this.clip;
    const time = (performance.now() - this.startWall) / 1000;
    for (const [note, held] of this.open) {
      this.notes.push({
        note,
        velocity: held.velocity,
        start: held.start,
        duration: Math.max(0.03, time - held.start),
      });
    }
    this.open.clear();
    window.clearInterval(this.timer);
    this.timer = 0;
    this.notes.sort((a, b) => a.start - b.start || a.note - b.note);
    let duration = 0;
    for (const n of this.notes) duration = Math.max(duration, n.start + n.duration);
    this.clip =
      this.notes.length > 0
        ? {
            name: `Take ${new Date().toLocaleTimeString()}`,
            bpm: 120,
            duration: duration + 0.4,
            notes: this.notes.map((n) => ({ ...n })),
          }
        : null;
    this.state = { recording: false, notes: this.notes.length, elapsed: duration };
    this.publish();
    return this.clip;
  }

  clear(): void {
    this.notes = [];
    this.open.clear();
    this.clip = null;
    this.state = { recording: false, notes: 0, elapsed: 0 };
    this.publish();
  }

  getClip(): MidiSong | null {
    return this.clip;
  }

  getState(): RecorderState {
    return this.state;
  }

  subscribe(fn: (s: RecorderState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private publish(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const recorder = new Recorder();
