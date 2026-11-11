/**
 * MPE (MIDI Polyphonic Expression) note routing.
 *
 * An MPE controller gives every note its own MIDI channel, which is what makes
 * per-note pitch bend and per-note pressure possible: a bend on channel 3
 * applies to whatever note is sounding on channel 3, not to the whole synth.
 *
 * The router is a small state machine with no engine dependency, so the
 * channel→note bookkeeping can be tested on its own.
 */

export interface MpeEvent {
  type: 'noteOn' | 'noteOff' | 'bend' | 'pressure';
  note: number;
  semitones: number;
  pressure: number;
  /**
   * Absolute frame the bend applies at, on the same clock as a note's `atFrame` — carried
   * through from the MIDI event that produced it, so a bend that shares a packet with a note
   * lands with the note. An inherited bend carries the note's frame, not the bend's: the bend
   * belongs to the note, and the note is what names the time. Omitted when the source event
   * named no frame, and the bend then applies when its message arrives.
   */
  atFrame?: number;
}

export class MpeRouter {
  /** Which note is currently sounding on each of the 16 channels. */
  private channelNote = new Map<number, number>();
  /** Pressure per channel, so a note-on inherits the channel's current value. */
  private channelPressure = new Map<number, number>();
  /**
   * Last bend (normalized -1..1) per channel, so a note that lands after a
   * bend inherits it — the same promise the pressure path already keeps.
   * A bend that arrives before its note used to be dropped entirely.
   */
  private channelBend = new Map<number, number>();
  private bendRange = 48;

  constructor(private enabled = false) {}

  /**
   * Turn MPE on or off. Disabling returns the bends that have to be released,
   * so the caller can apply them — a note left bent would keep its offset for
   * as long as it sounds.
   */
  setEnabled(enabled: boolean): MpeEvent[] {
    if (this.enabled === enabled) return [];
    this.enabled = enabled;
    const stranded = [...this.channelNote.values()];
    this.channelNote.clear();
    this.channelPressure.clear();
    this.channelBend.clear();
    return stranded.map((note) => ({ type: 'bend', note, semitones: 0, pressure: 0 }));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Bend range in semitones, matching the patch's pitch-bend range. */
  setBendRange(semitones: number) {
    this.bendRange = Math.max(1, Math.min(48, semitones));
  }

  /** Events produced by the last message, in the order they should be applied. */
  private events: MpeEvent[] = [];

  /** Feed one decoded MIDI message; returns the engine calls it implies. */
  handle(action: {
    type: string;
    note?: number;
    channel?: number;
    value?: number;
    atFrame?: number;
  }): MpeEvent[] {
    this.events = [];
    if (!this.enabled) return this.events;
    const channel = action.channel ?? 0;

    switch (action.type) {
      case 'noteOn': {
        const note = action.note ?? 0;
        this.channelNote.set(channel, note);
        this.events.push({ type: 'noteOn', note, semitones: 0, pressure: this.channelPressure.get(channel) ?? 0 });
        // A bend that arrived before the note belongs to this note now.
        const bend = this.channelBend.get(channel);
        if (bend != null) {
          this.events.push({
            type: 'bend',
            note,
            semitones: bend * this.bendRange,
            pressure: 0,
            atFrame: action.atFrame,
          });
        }
        break;
      }
      case 'noteOff': {
        const note = this.channelNote.get(channel) ?? action.note ?? 0;
        this.channelNote.delete(channel);
        this.channelBend.delete(channel);
        // Release the bend before the note ends, so a stolen voice cannot come
        // back bent by the next note that lands on this channel.
        this.events.push({ type: 'bend', note, semitones: 0, pressure: 0, atFrame: action.atFrame });
        this.events.push({ type: 'noteOff', note, semitones: 0, pressure: 0 });
        break;
      }
      case 'pitchBend': {
        // Remember the bend even when no note is on the channel yet: the
        // next note that lands here inherits it (see 'noteOn' above).
        // Returning no event here is correct — there is nothing to bend
        // right now — but the caller must not fall back to the global
        // wheel for it either.
        this.channelBend.set(channel, action.value ?? 0);
        const note = this.channelNote.get(channel);
        if (note == null) break;
        this.events.push({
          type: 'bend',
          note,
          semitones: (action.value ?? 0) * this.bendRange,
          pressure: 0,
          atFrame: action.atFrame,
        });
        break;
      }
      case 'aftertouch': {
        this.channelPressure.set(channel, action.value ?? 0);
        const note = this.channelNote.get(channel);
        if (note == null) break;
        this.events.push({ type: 'pressure', note, semitones: 0, pressure: action.value ?? 0 });
        break;
      }
      default:
        break;
    }
    return this.events;
  }

  /** Notes currently held, for the "all notes off" path. */
  heldNotes(): number[] {
    return [...this.channelNote.values()];
  }

  reset() {
    this.channelNote.clear();
    this.channelPressure.clear();
    this.channelBend.clear();
  }
}
