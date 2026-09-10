/**
 * Web MIDI input.
 *
 * Decoding is a pure function so it can be unit-tested without a browser;
 * the manager only wires it to the note bus and engine.
 */

import { store } from '@/state/store';
import { Param, type ParamId } from './params';
import { ccToParamValue, paramForCc } from './ccmap';
import { shapeVelocity } from './velocity';
import { midiOut } from '@/midi/output';
import { MpeRouter } from './mpe';
import { engine } from './engine';
import { noteBus } from './noteBus';
import { t } from '@/i18n';

export type MidiAction =
  | { type: 'noteOn'; note: number; channel: number; velocity: number }
  | { type: 'noteOff'; note: number; channel: number }
  | { type: 'pitchBend'; channel: number; value: number }
  | { type: 'aftertouch'; channel: number; value: number }
  | { type: 'allNotesOff' }
  | { type: 'cc'; controller: number; value: number }
  | { type: 'noteBend'; note: number; channel: number; value: number };

/** Decode a raw MIDI message. Returns null for messages we ignore. */
export function decodeMidi(data: ArrayLike<number>): MidiAction | null {
  if (!data || data.length < 2) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;
  switch (status) {
    case 0x90:
      return d2 > 0
        ? { type: 'noteOn', note: d1, channel, velocity: d2 / 127 }
        : { type: 'noteOff', note: d1, channel };
    case 0x80:
      return { type: 'noteOff', note: d1, channel };
    case 0xb0:
      // Control changes we do not interpret ourselves are still interesting:
      // CC Learn binds them, and a mapped CC drives its parameter.
      if (d1 === 1) return { type: 'cc', controller: 1, value: d2 / 127 };
      if (d1 === 64) return { type: 'cc', controller: 64, value: d2 / 127 };
      if (d1 === 120 || d1 === 123) return { type: 'allNotesOff' };
      return { type: 'cc', controller: d1, value: d2 / 127 };
    case 0xa0:
      // Polyphonic key pressure: treat it as channel pressure, which is what
      // the single AFTERTOUCH modulation source expects.
      return { type: 'aftertouch', channel, value: d2 / 127 };
    case 0xd0:
      return { type: 'aftertouch', channel, value: d1 / 127 };
    case 0xe0:
      return { type: 'pitchBend', channel, value: ((d2 << 7) | d1) / 8192 - 1 };
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
  private mpe = new MpeRouter(false);
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

  /** MPE mode: per-note bend and pressure from a channel-per-note controller. */
  setMpe(enabled: boolean) {
    for (const event of this.mpe.setEnabled(enabled)) {
      engine.noteBend(event.note, event.semitones);
    }
  }

  isMpe(): boolean {
    return this.mpe.isEnabled();
  }

  async enable(): Promise<void> {
    if (!this.state.supported) {
      this.state = { ...this.state, error: t('err.midiUnsupported') };
      this.emit();
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      // The output side shares this access object: one permission prompt, one
      // device list.
      midiOut.attach(this.access);
      if (store.getSnapshot().layout.midiOut) {
        midiOut.selectPort(store.getSnapshot().layout.midiOutPort);
      }
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
    midiOut.detach();
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
        name: i.name ?? t('err.midiDevice'),
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
      case 'noteOn': {
        this.sustained.delete(action.note);
        // MPE first: a note that lands on a channel inherits that channel's
        // current bend, so a controller that bends before pressing still works.
        for (const event of this.mpe.handle(action)) {
          if (event.type === 'bend') engine.noteBend(event.note, event.semitones);
        }
        noteBus.noteOn(
          action.note,
          shapeVelocity(action.velocity, store.getSnapshot().layout.velocityCurve as never),
        );
        break;
      }
      case 'noteOff': {
        if (this.sustain) {
          this.sustained.add(action.note);
          break;
        }
        // Release the per-note bend before the note ends, so the slot is clean
        // for whatever note lands on that channel next.
        for (const event of this.mpe.handle(action)) {
          if (event.type === 'bend') engine.noteBend(event.note, event.semitones);
        }
        noteBus.noteOff(action.note);
        break;
      }
      case 'cc': {
        // Learn first: while armed, the next control change becomes the binding.
        const learning = store.getSnapshot().midiLearn;
        if (learning != null) {
          store.bindMidiCc(learning, action.controller);
          break;
        }
        const mapped = paramForCc(store.getSnapshot().layout.ccMap, action.controller);
        if (mapped != null) {
          const value = ccToParamValue(mapped, action.value);
          if (value != null) store.setParam(mapped as ParamId, value);
        }
        // CC1 and CC64 are also hard-wired; they keep working when unmapped.
        if (action.controller === 1 && mapped == null) engine.modWheel(action.value);
        if (action.controller === 64) {
          const on = action.value > 0.5;
          if (this.sustain && !on) {
            for (const note of this.sustained) noteBus.noteOff(note);
            this.sustained.clear();
          }
          this.sustain = on;
        }
        break;
      }
      case 'pitchBend': {
        const events = this.mpe.handle(action);
        if (events.length === 0) {
          // No MPE: the wheel bends the whole synth.
          engine.pitchBend(action.value * store.getParam(Param.PITCH_BEND_RANGE));
          break;
        }
        for (const event of events) engine.noteBend(event.note, event.semitones);
        break;
      }
      case 'aftertouch': {
        const events = this.mpe.handle(action);
        // Per-note pressure would need a per-voice modulation source; until
        // then channel pressure drives the global aftertouch either way.
        void events;
        engine.aftertouch(action.value);
        break;
      }
      case 'allNotesOff':
        this.sustained.clear();
        for (const event of this.mpe.handle({ type: 'reset' })) {
          engine.noteBend(event.note, event.semitones);
        }
        this.mpe.reset();
        noteBus.allOff();
        break;
      default:
        break;
    }
  }
}

export const midi = new MidiManager();
