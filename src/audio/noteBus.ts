/**
 * Note display bus — the keyboard publishes, the monitor panel subscribes.
 */

import { engine } from './engine';

export interface NoteInfo {
  note: number | null;
  velocity: number;
  voices: number;
}

type Listener = (info: NoteInfo) => void;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function noteToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

class NoteBus {
  private listeners = new Set<Listener>();
  private held = new Set<number>();
  private last: NoteInfo = { note: null, velocity: 1, voices: 0 };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.last);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.last = { note: this.lastNote(), velocity: this.last.velocity, voices: this.held.size };
    for (const fn of this.listeners) fn(this.last);
  }

  private lastNote(): number | null {
    if (this.held.size === 0) return null;
    return Math.max(...this.held);
  }

  noteOn(note: number, velocity = 0.9) {
    // A note is always triggered by a gesture; use it to un-suspend iOS audio.
    void engine.resumeIfSuspended();
    if (this.held.has(note)) return;
    this.held.add(note);
    this.last.velocity = velocity;
    engine.noteOn(note, velocity);
    this.emit();
  }

  noteOff(note: number) {
    if (!this.held.has(note)) return;
    this.held.delete(note);
    engine.noteOff(note);
    this.emit();
  }

  allOff() {
    this.held.clear();
    engine.allNotesOff();
    this.emit();
  }

  isHeld(note: number): boolean {
    return this.held.has(note);
  }

  heldNotes(): number[] {
    return [...this.held];
  }
}

export const noteBus = new NoteBus();
