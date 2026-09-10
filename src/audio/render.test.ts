import { describe, expect, it } from 'vitest';
import { encodeWav, encodeWavBuffer, normalizePeak } from './render';

function peakOf(data: Float32Array[]): number {
  let peak = 0;
  for (const channel of data) {
    for (const v of channel) peak = Math.max(peak, Math.abs(v));
  }
  return peak;
}

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

describe('export normalisation', () => {
  it('scales a hot render down to the ceiling', () => {
    const data = [Float32Array.from([0, 0.5, -1.4, 0.2]), Float32Array.from([1.2, 0, 0, 0])];
    const peak = normalizePeak(data, 0.891);
    expect(peak).toBeCloseTo(1.4, 4);
    expect(peakOf(data)).toBeCloseTo(0.891, 4);
    // Shape is preserved: the ratio between samples is unchanged.
    expect(data[0][1] / data[0][2]).toBeCloseTo(0.5 / -1.4, 4);
  });

  it('lifts a quiet render up to the ceiling', () => {
    // A single-note synth patch can legitimately peak 20 dB down; the export
    // must still be a normal-level file, so this boosts as well as cuts.
    const data = [Float32Array.from([0, 0.2, -0.3])];
    expect(normalizePeak(data, 0.891)).toBeCloseTo(0.3, 5);
    expect(peakOf(data)).toBeCloseTo(0.891, 4);
  });

  it('caps the boost so near-silence stays near-silence', () => {
    const data = [Float32Array.from([0, 1e-5, -1e-5])];
    normalizePeak(data, 0.891, 24);
    // +24 dB at most, i.e. a factor of ~15.8.
    expect(peakOf(data)).toBeLessThan(1e-5 * 16);
  });

  it('survives silence and non-finite samples', () => {
    const silent = [Float32Array.from([0, 0, 0])];
    expect(normalizePeak(silent)).toBe(0);
    const broken = [Float32Array.from([Number.NaN, 0.1])];
    expect(() => normalizePeak(broken)).not.toThrow();
  });
});
