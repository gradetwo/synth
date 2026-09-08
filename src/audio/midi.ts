/**
 * Web MIDI input.
 *
 * Decoding is a pure function so it can be unit-tested without a browser;
 * the manager only wires it to the note bus and engine.
 */

import { store } from '@/state/store';
import { Param } from './params';
import { engine } from './engine';
import { noteBus } from './noteBus';

export type MidiAction =
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'pitchBend'; value: number }
  | { type: 'modWheel'; value: number }
  | { type: 'sustain'; value: number }
  | { type: 'allNotesOff' };

/** Decode a raw MIDI message. Returns null for messages we ignore. */
export function decodeMidi(data: ArrayLike<number>): MidiAction | null {
  if (!data || data.length < 2) return null;
  const status = data[0] & 0xf0;
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;
  switch (status) {
    case 0x90:
      return d2 > 0
        ? { type: 'noteOn', note: d1, velocity: d2 / 127 }
        : { type: 'noteOff', note: d1 };
    case 0x80:
      return { type: 'noteOff', note: d1 };
    case 0xb0:
      if (d1 === 1) return { type: 'modWheel', value: d2 / 127 };
      if (d1 === 64) return { type: 'sustain', value: d2 / 127 };
      if (d1 === 120 || d1 === 123) return { type: 'allNotesOff' };
      return null;
    case 0xe0:
      return { type: 'pitchBend', value: ((d2 << 7) | d1) / 8192 - 1 };
    default:
      return null;
  }
}

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MidiSnapshot {
  supported: boolean;
  enabled: boolean;
  error: string | null;
  devices: MidiDeviceInfo[];
}

class MidiManager {
  private access: MIDIAccess | null = null;
  private inputs: MIDIInput[] = [];
  private listeners = new Set<() => void>();
  private sustain = false;
  private sustained = new Set<number>();
  private state: MidiSnapshot = {
    supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
    enabled: false,
    error: null,
    devices: [],
  };

  snapshot(): MidiSnapshot {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  async enable(): Promise<void> {
    if (!this.state.supported) {
      this.state = { ...this.state, error: '此浏览器不支持 Web MIDI' };
      this.emit();
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.bindInputs();
      this.state = { ...this.state, enabled: true, error: null };
      this.bindInputs();
    } catch (err) {
      this.state = {
        ...this.state,
        enabled: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this.emit();
    }
  }

  disable() {
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = [];
    this.access = null;
    this.sustain = false;
    this.sustained.clear();
    this.state = { ...this.state, enabled: false, devices: [] };
    this.emit();
  }

  private bindInputs() {
    if (!this.access) return;
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = Array.from(this.access.inputs.values());
    for (const input of this.inputs) {
      input.onmidimessage = (event) => this.handle(event);
    }
    this.state = {
      ...this.state,
      devices: this.inputs.map((i) => ({
        id: i.id,
        name: i.name ?? '未命名设备',
        manufacturer: i.manufacturer ?? '',
      })),
    };
    this.emit();
  }

  private handle(event: MIDIMessageEvent) {
    if (!event.data) return;
    const action = decodeMidi(event.data);
    if (!action) return;
    switch (action.type) {
      case 'noteOn':
        this.sustained.delete(action.note);
        noteBus.noteOn(action.note, action.velocity);
        break;
      case 'noteOff':
        if (this.sustain) this.sustained.add(action.note);
        else noteBus.noteOff(action.note);
        break;
      case 'sustain': {
        const on = action.value > 0.5;
        if (this.sustain && !on) {
          for (const note of this.sustained) noteBus.noteOff(note);
          this.sustained.clear();
        }
        this.sustain = on;
        break;
      }
      case 'pitchBend':
        engine.pitchBend(action.value * store.getParam(Param.PITCH_BEND_RANGE));
        break;
      case 'modWheel':
        engine.modWheel(action.value);
        break;
      case 'allNotesOff':
        this.sustained.clear();
        noteBus.allOff();
        break;
      default:
        break;
    }
  }
}

export const midi = new MidiManager();
