import { describe, expect, it } from 'vitest';
import { controlChangeBytes, noteOffBytes, noteOnBytes, pitchBendBytes } from './output';

describe('MIDI output encoding', () => {
  it('encodes note on with a velocity that is never zero', () => {
    expect(noteOnBytes(60, 1)).toEqual([0x90, 60, 127]);
    // A zero velocity is a note-off on the wire, so the floor is 1.
    expect(noteOnBytes(60, 0)).toEqual([0x90, 60, 1]);
    expect(noteOnBytes(60, 0.5)).toEqual([0x90, 60, 64]);
  });

  it('clamps out-of-range notes and channels', () => {
    expect(noteOnBytes(200, 1)).toEqual([0x90, 127, 127]);
    expect(noteOnBytes(-5, 1)).toEqual([0x90, 0, 127]);
    expect(noteOnBytes(60, 1, 15)).toEqual([0x9f, 60, 127]);
    expect(noteOffBytes(60, 3)).toEqual([0x83, 60, 0]);
  });

  it('centres pitch bend at 8192', () => {
    expect(pitchBendBytes(0)).toEqual([0xe0, 0, 64]);
    expect(pitchBendBytes(-1)).toEqual([0xe0, 0, 0]);
    expect(pitchBendBytes(1)).toEqual([0xe0, 127, 127]);
  });

  it('clamps controller values', () => {
    expect(controlChangeBytes(74, 127)).toEqual([0xb0, 74, 127]);
    expect(controlChangeBytes(74, 999)).toEqual([0xb0, 74, 127]);
  });
});
