/**
 * Sample state tests (A).
 *
 * The DSP is covered by the Rust tests. What can go wrong here is the plumbing:
 * a sample that loses the rate it was recorded at (and so plays at the wrong
 * pitch), or one that does not survive a reload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSamples } from './wavefile';
import {
  clearUserSample,
  getUserSample,
  importUserSample,
  setUserSampleForTest,
  subscribeUserSample,
} from './userSample';

const KEY = 'gs1:sample:v1';

/** A 16-bit PCM WAV holding `samples` at `rate`. */
function wavFile(name: string, samples: Float32Array, rate = 22050): File {
  const data = new ArrayBuffer(44 + samples.length * 2);
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
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  }
  return { name, arrayBuffer: async () => data } as unknown as File;
}

const tone = (len = 4096, rate = 22050, freq = 440) =>
  new Float32Array(len).map((_, i) => Math.sin((2 * Math.PI * freq * i) / rate) * 0.8);

beforeEach(() => {
  localStorage.clear();
  setUserSampleForTest(null);
});

describe('sample state', () => {
  it('keeps the rate the file was recorded at', async () => {
    const sample = await importUserSample(wavFile('kick.wav', tone()));
    // The whole point: a 22 kHz file must not be treated as 48 kHz audio.
    expect(sample.sampleRate).toBe(22050);
    expect(sample.samples.length).toBe(4096);

    const raw = JSON.parse(localStorage.getItem(KEY)!) as { rate: number; name: string };
    expect(raw.rate).toBe(22050);
    expect(raw.name).toBe('kick.wav');
  });

  it('notifies subscribers and clears cleanly', async () => {
    let calls = 0;
    const off = subscribeUserSample(() => {
      calls += 1;
    });
    await importUserSample(wavFile('snare.wav', tone()));
    expect(calls).toBe(1);
    expect(getUserSample()?.name).toBe('snare.wav');
    clearUserSample();
    expect(calls).toBe(2);
    expect(getUserSample()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    off();
  });

  it('refuses a silent or empty file', async () => {
    await expect(importUserSample(wavFile('silence.wav', new Float32Array(4096)))).rejects.toMatchObject({
      code: 'silent',
    });
    // Long enough for the WAV reader to accept it, too short to be a sample.
    await expect(importUserSample(wavFile('tiny.wav', tone(20)))).rejects.toMatchObject({ code: 'short' });
    expect(getUserSample()).toBeNull();
  });

  it('refuses a payload from a newer build and still reads an older one', async () => {
    const samples = tone(128);
    localStorage.setItem(KEY, JSON.stringify({ name: 'old.wav', rate: 22050, samples: encodeSamples(samples) }));
    vi.resetModules();
    const legacy = await import('./userSample');
    expect(legacy.getUserSample()?.name).toBe('old.wav');

    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: 99, name: 'future.wav', rate: 22050, samples: encodeSamples(samples) }),
    );
    vi.resetModules();
    const future = await import('./userSample');
    expect(future.getUserSample()).toBeNull();
  });
});
