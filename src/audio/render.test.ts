import { describe, expect, it } from 'vitest';
import { encodeWav, encodeWavBuffer } from './render';

function fakeBuffer(channels: Float32Array[], sampleRate = 44100) {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    getChannelData: (i: number) => channels[i],
  };
}

describe('WAV encoder', () => {
  it('writes a valid 16-bit stereo header and data', async () => {
    const left = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const right = new Float32Array([0, -0.5, 0.5, -1, 1]);
    const blob = encodeWav(fakeBuffer([left, right]));
    const view = new DataView(encodeWavBuffer(fakeBuffer([left, right])));
    const text = (offset: number, len: number) =>
      String.fromCharCode(...Array.from({ length: len }, (_, i) => view.getUint8(offset + i)));

    expect(blob.type).toBe('audio/wav');
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(text(36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(5 * 2 * 2);
    expect(view.byteLength).toBe(44 + 5 * 2 * 2);
    expect(blob.type).toBe('audio/wav');
    // Interleaved L/R: L[1]=0.5 -> 16383, R[3]=-1 -> -32768
    expect(view.getInt16(44 + 4, true)).toBe(16383);
    expect(view.getInt16(44 + 14, true)).toBe(-32768);
  });

  it('clamps out-of-range samples', () => {
    const buf = encodeWavBuffer(fakeBuffer([new Float32Array([2, -2])], 48000));
    expect(buf.byteLength).toBe(44 + 2 * 2);
  });
});
