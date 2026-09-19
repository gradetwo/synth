/**
 * Note display bus — the keyboard publishes, the monitor panel subscribes.
 *
 * Also re-broadcasts individual note-on/off events so the recorder can capture
 * any performance source (screen keyboard, computer keyboard, MIDI input) with
 * one subscription.
 */

import { engine } from './engine';
import { midiOut } from '@/midi/output';

export interface NoteInfo {
  note: number | null;
  velocity: number;
  voices: number;
}

export interface NoteEvent {
  note: number;
  velocity: number;
  on: boolean;
}

type Listener = (info: NoteInfo) => void;
type EventListener = (event: NoteEvent) => void;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function noteToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

class NoteBus {
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private held = new Set<number>();
  private last: NoteInfo = { note: null, velocity: 1, voices: 0 };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.last);
    return () => this.listeners.delete(fn);
  }

  /** Observe raw note events (used by the recorder). */
  subscribeEvents(fn: EventListener): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private emit() {
    this.last = { note: this.lastNote(), velocity: this.last.velocity, voices: this.held.size };
    for (const fn of this.listeners) fn(this.last);
  }

  private emitEvent(event: NoteEvent) {
    for (const fn of this.eventListeners) fn(event);
  }

  private lastNote(): number | null {
    if (this.held.size === 0) return null;
    return Math.max(...this.held);
  }

  noteOn(note: number, velocity = 0.9, pan = 0) {
    // A note is always triggered by a gesture; use it to un-suspend iOS audio.
    void engine.resumeIfSuspended();
    if (this.held.has(note)) return;
    this.held.add(note);
    this.last.velocity = velocity;
    engine.noteOn(note, velocity, pan);
    if (midiOutOn()) midiOut.noteOn(note, velocity);
    this.emit();
    this.emitEvent({ note, velocity, on: true });
  }

  noteOff(note: number) {
    if (!this.held.has(note)) return;
    this.held.delete(note);
    engine.noteOff(note);
    if (midiOutOn()) midiOut.noteOff(note);
    this.emit();
    this.emitEvent({ note, velocity: this.last.velocity, on: false });
  }

  allOff() {
    for (const note of this.held) this.emitEvent({ note, velocity: this.last.velocity, on: false });
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

/** Sending to an external device is opt-in (see the audio-settings panel). */
const midiOutOn = () => activeMidiOut;
let activeMidiOut = false;

export function setMidiOutEnabled(enabled: boolean) {
  if (activeMidiOut && !enabled) midiOut.allNotesOff();
  activeMidiOut = enabled;
}

export const noteBus = new NoteBus();
