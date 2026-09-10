import { describe, expect, it } from 'vitest';
import { canPickOutput, currentOutputId, outputDevices, outputLabel } from './devices';

const device = (kind: string, id: string, label = ''): MediaDeviceInfo =>
  ({ kind, deviceId: id, label }) as MediaDeviceInfo;

describe('output devices', () => {
  it('lists only outputs and numbers the unnamed ones', () => {
    const devices = outputDevices(
      [device('audioinput', 'mic', 'Mic'), device('audiooutput', 'a'), device('audiooutput', 'b', 'Speakers')],
      'Output',
    );
    expect(devices).toEqual([
      { id: 'a', label: 'Output 1' },
      { id: 'b', label: 'Speakers' },
    ]);
  });

  it('prefers the browser label and falls back to a numbered name', () => {
    expect(outputLabel(device('audiooutput', 'a', '  HDMI  '), 0, 'Output')).toBe('HDMI');
    expect(outputLabel(device('audiooutput', 'a', '   '), 2, 'Output')).toBe('Output 3');
  });

  it('keeps a valid selection and falls back to the first device', () => {
    const devices = outputDevices([device('audiooutput', 'a'), device('audiooutput', 'b')], 'Output');
    expect(currentOutputId(devices, 'b')).toBe('b');
    // A device that disappeared (unplugged headphones) falls back rather than
    // showing an empty select.
    expect(currentOutputId(devices, 'gone')).toBe('a');
    expect(currentOutputId([], 'a')).toBe('');
  });

  it('reports the capability from the context', () => {
    expect(canPickOutput(null)).toBe(false);
    expect(canPickOutput({} as AudioContext)).toBe(false);
    expect(canPickOutput({ setSinkId: () => Promise.resolve() } as unknown as AudioContext)).toBe(true);
  });
});
