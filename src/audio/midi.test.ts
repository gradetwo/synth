import { describe, expect, it } from 'vitest';
import { decodeMidi } from './midi';

describe('MIDI decoding', () => {
  it('decodes note on/off including velocity-0 note-on', () => {
    expect(decodeMidi([0x90, 60, 127])).toEqual({ type: 'noteOn', note: 60, velocity: 1 });
    expect(decodeMidi([0x90, 60, 64])).toEqual({ type: 'noteOn', note: 60, velocity: 64 / 127 });
    expect(decodeMidi([0x90, 60, 0])).toEqual({ type: 'noteOff', note: 60 });
    expect(decodeMidi([0x80, 60, 40])).toEqual({ type: 'noteOff', note: 60 });
  });

  it('decodes pitch bend to -1..1', () => {
    expect(decodeMidi([0xe0, 0, 64])).toEqual({ type: 'pitchBend', value: 0 });
    expect(decodeMidi([0xe0, 0, 0])).toEqual({ type: 'pitchBend', value: -1 });
    expect(decodeMidi([0xe0, 127, 127])).toEqual({ type: 'pitchBend', value: 16383 / 8192 - 1 });
  });

  it('decodes CC1/CC64/CC123', () => {
    expect(decodeMidi([0xb0, 1, 127])).toEqual({ type: 'modWheel', value: 1 });
    expect(decodeMidi([0xb0, 64, 127])).toEqual({ type: 'sustain', value: 1 });
    expect(decodeMidi([0xb0, 123, 0])).toEqual({ type: 'allNotesOff' });
    expect(decodeMidi([0xb0, 7, 100])).toBeNull();
  });

  it('ignores unrelated or malformed messages', () => {
    expect(decodeMidi([0xc0, 5])).toBeNull();
    expect(decodeMidi([0x90])).toBeNull();
    expect(decodeMidi([])).toBeNull();
  });
});
