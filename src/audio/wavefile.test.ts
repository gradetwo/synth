/**
 * File → cycle tests (A6.2).
 *
 * The interesting failures here are silent ones: a period detected at twice its
 * real length plays two cycles as one and sounds like a detuned mess, and a
 * whole multi-cycle file used as one cycle is noise. Both are checked in the
 * frequency domain — the imported cycle must contain the harmonics of the
 * *original* waveform and nothing else.
 */
import { describe, expect, it } from 'vitest';
import {
  CYCLE_LENGTH,
  WaveImportError,
  decodeCycle,
  detectPeriod,
  extractCycle,
  parseWav,
} from './wavefile';

/** Amplitude of harmonic `k` of a cycle, by DFT over its own period. */
function harmonic(cycle: Float32Array, k: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < cycle.length; i++) {
    const phase = (2 * Math.PI * k * i) / cycle.length;
    re += cycle[i] * Math.cos(phase);
    im -= cycle[i] * Math.sin(phase);
  }
  return (Math.hypot(re, im) / cycle.length) * 2;
}

function saw(period: number, cycles: number): Float32Array {
  const out = new Float32Array(period * cycles);
  for (let i = 0; i < out.length; i++) {
    const phase = (i % period) / period;
    out[i] = 2 * phase - 1;
  }
  return out;
}

function envelope(samples: Float32Array): Float32Array {
  // A played note is not a loop: fade the ends so the analysis is not reading
  // the file's start and end transients.
  for (let i = 0; i < samples.length; i++) {
    const edge = Math.min(1, Math.min(i, samples.length - 1 - i) / 400);
    samples[i] *= edge;
  }
  return samples;
}

/** Write `interleaved` (channel-by-channel) as a 16-bit PCM WAV. */
function wav16(interleaved: Float32Array, sampleRate = 44100, channels = 1): ArrayBuffer {
  const data = new ArrayBuffer(44 + interleaved.length * 2);
  const view = new DataView(data);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, data.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, interleaved.length * 2, true);
  for (let i = 0; i < interleaved.length; i++) {
    view.setInt16(44 + i * 2, Math.round(interleaved[i] * 32767), true);
  }
  return data;
}

describe('wav parsing', () => {
  it('reads 16-bit PCM', () => {
    const cycle = new Float32Array(2048).map((_, i) => Math.sin((2 * Math.PI * i) / 2048));
    const parsed = parseWav(wav16(cycle));
    expect(parsed?.sampleRate).toBe(44100);
    expect(parsed?.samples.length).toBe(2048);
    expect(parsed!.samples[512]).toBeCloseTo(1, 3);
  });

  it('reads multi-channel files by their loudest channel', () => {
    // Interleaved stereo where the left channel is silent: taking channel 0
    // blindly would report the file as silent.
    const frames = 512;
    const interleaved = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      interleaved[i * 2] = 0;
      interleaved[i * 2 + 1] = Math.sin((2 * Math.PI * i) / 64) * 0.8;
    }
    const parsed = parseWav(wav16(interleaved, 44100, 2));
    expect(parsed?.samples.length).toBe(frames);
    let peak = 0;
    for (const value of parsed!.samples) peak = Math.max(peak, Math.abs(value));
    expect(peak).toBeGreaterThan(0.5);
  });

  it('rejects files that are not RIFF/WAVE', () => {
    const bytes = new Uint8Array(64);
    bytes.set([0x49, 0x44, 0x33], 0); // "ID3" — an mp3
    expect(parseWav(bytes.buffer)).toBeNull();
  });
});

describe('cycle extraction', () => {
  it('keeps a single-cycle file as it is', () => {
    const sine = new Float32Array(CYCLE_LENGTH).map((_, i) =>
      Math.sin((2 * Math.PI * i) / CYCLE_LENGTH),
    );
    const cycle = extractCycle(sine);
    expect(cycle.length).toBe(CYCLE_LENGTH);
    expect(harmonic(cycle, 1)).toBeCloseTo(1, 2);
    expect(harmonic(cycle, 2)).toBeLessThan(0.01);
  });

  it('finds the period of a played note and averages whole cycles', () => {
    const period = 512;
    const note = envelope(saw(period, 60));
    expect(detectPeriod(note)).toBe(period);
    const cycle = extractCycle(note);
    expect(cycle.length).toBe(CYCLE_LENGTH);
    // A saw is 1/k: the second harmonic must be half the fundamental and the
    // third a third, which only holds if exactly one cycle was taken.
    const first = harmonic(cycle, 1);
    expect(first).toBeGreaterThan(0.4);
    expect(harmonic(cycle, 2) / first).toBeCloseTo(0.5, 1);
    expect(harmonic(cycle, 3) / first).toBeCloseTo(1 / 3, 1);
  });

  it('prefers the shortest strong period, not a multiple of it', () => {
    // Without the octave rule the 2× peak wins and the cycle holds two periods.
    const note = envelope(saw(256, 80));
    expect(detectPeriod(note)).toBe(256);
  });

  it('refuses silence, short files and NaN', () => {
    const codeOf = (samples: Float32Array) => {
      try {
        extractCycle(samples);
      } catch (error) {
        return error instanceof WaveImportError ? error.code : 'other';
      }
      return null;
    };
    expect(codeOf(new Float32Array(2048))).toBe('silent');
    expect(codeOf(new Float32Array(8).fill(0.5))).toBe('short');
    const broken = new Float32Array(2048).fill(0.5);
    broken[7] = Number.NaN;
    expect(codeOf(broken)).toBe('notFinite');
  });
});

describe('decoding a file', () => {
  it('decodes a WAV without a browser decoder', async () => {
    const cycle = new Float32Array(600).map((_, i) => Math.sin((2 * Math.PI * i) / 600));
    // jsdom's Blob has no `arrayBuffer()`, so hand `decodeCycle` the one method
    // it uses — the same shape a real File provides.
    const blob = { arrayBuffer: async () => wav16(cycle) } as unknown as Blob;
    const decoded = await decodeCycle(blob);
    expect(decoded.length).toBe(CYCLE_LENGTH);
    expect(harmonic(decoded, 1)).toBeGreaterThan(0.9);
  });
});
