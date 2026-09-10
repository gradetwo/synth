/**
 * Imported-waveform state tests (A6.2).
 *
 * The waveform is instrument state: it survives a reload, it is shared by every
 * patch, and clearing it must not leave a patch asking for something that is no
 * longer there. The engine is not running in these tests (no AudioContext), so
 * they also pin the rule that a decode without a core still counts as success.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CYCLE_LENGTH } from './wavefile';
import {
  clearUserWave,
  decodeUserWave,
  encodeUserWave,
  getUserWave,
  importUserWave,
  setUserWaveForTest,
  subscribeUserWave,
} from './userWave';

const KEY = 'gs1:wt-user:v1';

function cycleOf(length = CYCLE_LENGTH): Float32Array {
  return new Float32Array(length).map((_, i) => Math.sin((2 * Math.PI * i) / length) * 0.9);
}

/** The shape `decodeCycle` needs from a `File`. */
function fakeFile(name: string, samples: Float32Array): File {
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
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
  }
  return { name, arrayBuffer: async () => data } as unknown as File;
}

beforeEach(() => {
  localStorage.clear();
  setUserWaveForTest(null);
});

describe('imported waveform storage', () => {
  it('round-trips a cycle through the 16-bit encoding', () => {
    const cycle = cycleOf();
    const decoded = decodeUserWave(encodeUserWave({ name: 'saw.wav', cycle }));
    expect(decoded?.name).toBe('saw.wav');
    expect(decoded?.cycle.length).toBe(CYCLE_LENGTH);
    let worst = 0;
    for (let i = 0; i < cycle.length; i++) worst = Math.max(worst, Math.abs(cycle[i] - decoded!.cycle[i]));
    // 16-bit quantisation, not a lossy resample.
    expect(worst).toBeLessThan(1 / 32000);
  });

  it('returns null for junk instead of throwing', () => {
    expect(decodeUserWave('not json')).toBeNull();
    expect(decodeUserWave('{"name":1}')).toBeNull();
    expect(decodeUserWave('{"name":"x","samples":"AA=="}')).toBeNull();
  });

  it('keeps the waveform across a reload', async () => {
    await importUserWave(fakeFile('vox.wav', cycleOf()));
    expect(localStorage.getItem(KEY)).toBeTruthy();
    // A fresh read is what a page reload does.
    const stored = decodeUserWave(localStorage.getItem(KEY)!);
    expect(stored?.name).toBe('vox.wav');
  });

  it('notifies subscribers on import and clear', async () => {
    let calls = 0;
    const off = subscribeUserWave(() => {
      calls += 1;
    });
    await importUserWave(fakeFile('vox.wav', cycleOf()));
    expect(calls).toBe(1);
    expect(getUserWave()?.name).toBe('vox.wav');
    clearUserWave();
    expect(calls).toBe(2);
    expect(getUserWave()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    off();
    clearUserWave();
    expect(calls).toBe(2);
  });

  it('accepts an import with no engine running, and refuses a silent file', async () => {
    // No AudioContext in jsdom: the core cannot answer, which must not be
    // reported to the player as a broken file.
    const wave = await importUserWave(fakeFile('quiet.wav', cycleOf()));
    expect(wave.name).toBe('quiet.wav');

    await expect(
      importUserWave(fakeFile('silence.wav', new Float32Array(CYCLE_LENGTH))),
    ).rejects.toMatchObject({ code: 'silent' });
    expect(getUserWave()?.name).toBe('quiet.wav');
  });
});
