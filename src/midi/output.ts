/**
 * Web MIDI output.
 *
 * Sending the synth's notes to another device — a hardware synth, a drum module,
 * a DAW — is the other half of "MIDI support": the app can be played *into* gear
 * rather than only played from a keyboard.
 *
 * The message encoding is pure so the byte layout can be tested; the port
 * handling is a thin wrapper over `MIDIAccess.outputs`.
 */

export interface MidiOutPort {
  id: string;
  name: string;
  manufacturer: string;
}

/** Note on, channel 1. Velocity is 0..1 and must never encode as 0 (that is a
 *  note-off), so it is floored at 1. */
export function noteOnBytes(note: number, velocity: number, channel = 0): number[] {
  const key = Math.max(0, Math.min(127, Math.round(note)));
  const value = Math.max(1, Math.min(127, Math.round(velocity * 127)));
  return [0x90 | (channel & 0x0f), key, value];
}

export function noteOffBytes(note: number, channel = 0): number[] {
  const key = Math.max(0, Math.min(127, Math.round(note)));
  return [0x80 | (channel & 0x0f), key, 0];
}

export function controlChangeBytes(controller: number, value: number, channel = 0): number[] {
  const cc = Math.max(0, Math.min(127, Math.round(controller)));
  const amount = Math.max(0, Math.min(127, Math.round(value)));
  return [0xb0 | (channel & 0x0f), cc, amount];
}

/** Pitch bend as a 14-bit value centred at 8192, from a -1..1 input. */
export function pitchBendBytes(value: number, channel = 0): number[] {
  const clamped = Math.max(-1, Math.min(1, value));
  const bend = Math.max(0, Math.min(16383, Math.round(8192 + clamped * 8192)));
  return [0xe0 | (channel & 0x0f), bend & 0x7f, (bend >> 7) & 0x7f];
}

class MidiOutput {
  private access: MIDIAccess | null = null;
  private output: MIDIOutput | null = null;
  private selected = '';

  /** Attach to the access object the input side already opened. */
  attach(access: MIDIAccess): void {
    this.access = access;
    this.bind();
  }

  detach(): void {
    this.access = null;
    this.output = null;
  }

  ports(): MidiOutPort[] {
    if (!this.access) return [];
    return Array.from(this.access.outputs.values()).map((port) => ({
      id: port.id,
      name: port.name ?? '',
      manufacturer: port.manufacturer ?? '',
    }));
  }

  /** Select a port by id ('' sends nowhere). */
  selectPort(id: string): void {
    this.selected = id;
    this.bind();
  }

  selectedPort(): string {
    return this.selected;
  }

  isReady(): boolean {
    return this.output != null;
  }

  private bind(): void {
    this.output =
      this.access && this.selected
        ? (this.access.outputs.get(this.selected) ?? null)
        : null;
  }

  send(bytes: number[]): void {
    this.output?.send(bytes);
  }

  noteOn(note: number, velocity: number): void {
    this.send(noteOnBytes(note, velocity));
  }

  noteOff(note: number): void {
    this.send(noteOffBytes(note));
  }

  /** Panic: release everything on the current port. */
  allNotesOff(): void {
    for (let note = 0; note < 128; note++) this.noteOff(note);
  }
}

export const midiOut = new MidiOutput();
