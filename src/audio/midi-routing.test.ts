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
    frameForTimestamp: vi.fn(),
  },
}));
vi.mock('./noteBus', () => ({
  noteBus: { noteOn: vi.fn(), noteOff: vi.fn(), allOff: vi.fn() },
}));

import { engine } from './engine';
import { midi } from './midi';

function message(status: number, d1: number, d2: number, receivedTime?: number): MIDIMessageEvent {
  return { data: new Uint8Array([status, d1, d2]), receivedTime } as unknown as MIDIMessageEvent;
}

describe('MidiManager pitch-bend routing', () => {
  beforeEach(() => {
    // Release first (it calls the engine for stranded bends), then wipe the
    // slate — otherwise the release call leaks into the test's assertions.
    midi.setMpe(false);
    vi.clearAllMocks();
    vi.mocked(engine.frameForTimestamp).mockReturnValue(undefined);
  });

  it('sends the normalized wheel value to the global wheel (no pre-scaling)', () => {
    // 0xe0, LSB 0, MSB 96 -> (96 << 7) / 8192 - 1 = 0.5 exactly.
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0xe0, 0, 96));
    expect(engine.pitchBend).toHaveBeenCalledTimes(1);
    // NOT 0.5 * PITCH_BEND_RANGE (2): the range is applied once, in the core.
    // No receivedTime on the event, so no frame is named: the bend is
    // unscheduled, exactly like before.
    expect(engine.pitchBend).toHaveBeenCalledWith(0.5, undefined);
    expect(engine.noteBend).not.toHaveBeenCalled();
  });

  it('schedules the wheel bend at the MIDI event frame', () => {
    vi.mocked(engine.frameForTimestamp).mockReturnValue(123456);
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0xe0, 0, 96, 9876));
    expect(engine.frameForTimestamp).toHaveBeenCalledWith(9876);
    expect(engine.pitchBend).toHaveBeenCalledWith(0.5, 123456);
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
    expect(engine.noteBend).toHaveBeenCalledWith(60, 24, undefined);
  });

  it('schedules an MPE bend at the MIDI event frame', () => {
    midi.setMpe(true);
    vi.mocked(engine.frameForTimestamp).mockReturnValue(123456);
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0x90, 60, 100, 1111));
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0xe0, 0, 96, 2222));
    expect(engine.noteBend).toHaveBeenCalledWith(60, 24, 123456);
    expect(engine.pitchBend).not.toHaveBeenCalled();
  });

  it('an MPE bend inherited on note-on carries the note frame, not the bend frame', () => {
    midi.setMpe(true);
    // The bend arrives first (frame 100), the note lands later (frame 200):
    // the inherited bend belongs to the note, so it rides on the note frame.
    vi.mocked(engine.frameForTimestamp).mockReturnValueOnce(100).mockReturnValueOnce(200);
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0xe0, 0, 96, 1000));
    expect(engine.noteBend).not.toHaveBeenCalled();
    (midi as unknown as { handle(e: MIDIMessageEvent): void }).handle(message(0x90, 60, 100, 2000));
    expect(engine.noteBend).toHaveBeenCalledWith(60, 24, 200);
  });
});
