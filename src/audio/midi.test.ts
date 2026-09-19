import { describe, expect, it } from 'vitest';
import { decodeMidi } from './midi';

describe('MIDI decoding', () => {
  it('decodes note on/off including velocity-0 note-on', () => {
    // The channel rides along: MPE needs it to know which note a message is for.
    expect(decodeMidi([0x90, 60, 127])).toEqual({
      type: 'noteOn',
      note: 60,
      channel: 0,
      velocity: 1,
    });
    expect(decodeMidi([0x92, 60, 64])).toEqual({
      type: 'noteOn',
      note: 60,
      channel: 2,
      velocity: 64 / 127,
    });
    expect(decodeMidi([0x90, 60, 0])).toEqual({ type: 'noteOff', note: 60, channel: 0 });
    expect(decodeMidi([0x80, 60, 40])).toEqual({ type: 'noteOff', note: 60, channel: 0 });
  });

  it('decodes pitch bend to -1..1', () => {
    expect(decodeMidi([0xe0, 0, 64])).toEqual({ type: 'pitchBend', channel: 0, value: 0 });
    expect(decodeMidi([0xe5, 0, 0])).toEqual({ type: 'pitchBend', channel: 5, value: -1 });
    expect(decodeMidi([0xe0, 127, 127])).toEqual({
      type: 'pitchBend',
      channel: 0,
      value: 16383 / 8192 - 1,
    });
  });

  it('decodes CC1/CC64/CC123 and keeps other controllers addressable', () => {
    // Every control change carries its number, which is what CC Learn binds and
    // what a mapped CC is looked up by; the handler decides what it means.
    expect(decodeMidi([0xb0, 1, 127])).toEqual({ type: 'cc', controller: 1, value: 1 });
    expect(decodeMidi([0xb0, 64, 127])).toEqual({ type: 'cc', controller: 64, value: 1 });
    expect(decodeMidi([0xb0, 123, 0])).toEqual({ type: 'allNotesOff' });
    expect(decodeMidi([0xb0, 7, 100])).toEqual({ type: 'cc', controller: 7, value: 100 / 127 });
    expect(decodeMidi([0xb0, 74, 64])).toEqual({ type: 'cc', controller: 74, value: 64 / 127 });
  });

  it('ignores unrelated or malformed messages', () => {
    expect(decodeMidi([0xc0, 5])).toBeNull();
    expect(decodeMidi([0x90])).toBeNull();
    expect(decodeMidi([])).toBeNull();
  });

  it('clamps bytes that are not 7-bit numbers into legal actions', () => {
    // A driver, a recorder buffer or a test can hand over anything; every
    // action still has to be something the engine can act on.
    expect(decodeMidi([0x90, 300, 300])).toEqual({ type: 'noteOn', note: 127, channel: 0, velocity: 1 });
    expect(decodeMidi([0x90, NaN, 64])).toEqual({ type: 'noteOn', note: 0, channel: 0, velocity: 64 / 127 });
    // 14-bit bend: the top of the range is d2 = 127, d1 = 127, so a clamped
    // 300 lands just short of +1 rather than past it.
    expect(decodeMidi([0xe0, -5, 300])).toEqual({ type: 'pitchBend', channel: 0, value: 0.984375 });
    expect(decodeMidi([0xe0, 300, 300])).toEqual({ type: 'pitchBend', channel: 0, value: 16383 / 8192 - 1 });
    expect(decodeMidi([0xb0, 999, 300])).toEqual({ type: 'cc', controller: 127, value: 1 });
    expect(
      decodeMidi([0x90, undefined as unknown as number, 100] as number[]),
    ).toEqual({ type: 'noteOn', note: 0, channel: 0, velocity: 100 / 127 });
  });
});
