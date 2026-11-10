/**
 * Pitch-bend routing through the MIDI manager.
 *
 * The engine's global `pitch_bend` field is a NORMALIZED wheel value
 * (-1..1); the core applies PITCH_BEND_RANGE once at render. These tests
 * pin that the manager hands the raw wheel value through unscaled, and
 * that an MPE bend never falls back to the global wheel.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./engine', () => ({
  engine: {
    pitchBend: vi.fn(),
    noteBend: vi.fn(),
    modWheel: vi.fn(),
    aftertouch: vi.fn(),
  },
}));
vi.mock('./noteBus', () => ({
  noteBus: { noteOn: vi.fn(), noteOff: vi.fn(), allOff: vi.fn() },
}));

import { engine } from './engine';
import { midi } from './midi';

function message(status: number, d1: number, d2: number): MIDIMessageEvent {
  return { data: new Uint8Array([status, d1, d2]) } as unknown as MIDIMessageEvent;
}

describe('MidiManager pitch-bend routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    midi.setMpe(false);
  });

  it('sends the normalized wheel value to the global wheel (no pre-scaling)', () => {
    // 0xe0, LSB 0, MSB 96 -> (96 << 7) / 8192 - 1 = 0.5 exactly.
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0xe0, 0, 96));
    expect(engine.pitchBend).toHaveBeenCalledTimes(1);
    // NOT 0.5 * PITCH_BEND_RANGE (2): the range is applied once, in the core.
    expect(engine.pitchBend).toHaveBeenCalledWith(0.5);
    expect(engine.noteBend).not.toHaveBeenCalled();
  });

  it('does not fall back to the global wheel for an MPE bend on an empty channel', () => {
    midi.setMpe(true);
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0xe0, 0, 96));
    expect(engine.pitchBend).not.toHaveBeenCalled();
    expect(engine.noteBend).not.toHaveBeenCalled();
  });

  it('an MPE bend that arrives before the note bends that note on note-on', () => {
    midi.setMpe(true);
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0xe0, 0, 96));
    // Note on, channel 0, velocity 100.
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0x90, 60, 100));
    expect(engine.pitchBend).not.toHaveBeenCalled();
    // 0.5 * MPE bend range (48) = 24 semitones, on the note that just landed.
    expect(engine.noteBend).toHaveBeenCalledWith(60, 24);
  });
});
