/**
 * Impulse-response state tests (A5).
 *
 * The DSP is covered by the Rust tests; what can go wrong here is the plumbing:
 * a response that does not survive a reload, or one that is stored at a size the
 * browser refuses.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearUserIr,
  getUserIr,
  importUserIr,
  setUserIrForTest,
  subscribeUserIr,
} from './ir';

const KEY = 'gs1:ir:v1';

/** A short decaying-noise response as a WAV, the shape `decodeSamples` needs. */
function irFile(name: string, length = 8192): File {
  const data = new ArrayBuffer(44 + length * 2);
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
  view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * 2, true);
  let seed = 12345;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = (seed / 0x3fffffff - 1) * Math.exp(-i / 2000);
    view.setInt16(44 + i * 2, Math.round(noise * 32767), true);
  }
  return { name, arrayBuffer: async () => data } as unknown as File;
}

beforeEach(() => {
  localStorage.clear();
  setUserIrForTest(null);
});

describe('impulse response state', () => {
  it('accepts a response with no engine running and stores it', async () => {
    const ir = await importUserIr(irFile('hall.wav'));
    expect(ir.name).toBe('hall.wav');
    expect(ir.samples.length).toBe(8192);
    expect(localStorage.getItem(KEY)).toBeTruthy();
    // A reload reads the same response back out of storage.
    const raw = localStorage.getItem(KEY)!;
    const parsed = JSON.parse(raw) as { name: string; samples: string };
    expect(parsed.name).toBe('hall.wav');
    expect(parsed.samples.length).toBeGreaterThan(1000);
  });

  it('notifies subscribers and clears cleanly', async () => {
    let calls = 0;
    const off = subscribeUserIr(() => {
      calls += 1;
    });
    await importUserIr(irFile('room.wav'));
    expect(calls).toBe(1);
    expect(getUserIr()?.name).toBe('room.wav');
    clearUserIr();
    expect(calls).toBe(2);
    expect(getUserIr()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    off();
  });

  it('refuses a response with no signal in it', async () => {
    const silent = irFile('silence.wav');
    const silentNoise = async () => {
      const buffer = await silent.arrayBuffer();
      new Uint8Array(buffer).fill(0, 44);
      return buffer;
    };
    await expect(importUserIr({ ...silent, arrayBuffer: silentNoise } as unknown as File)).rejects.toMatchObject(
      { code: 'silent' },
    );
    expect(getUserIr()).toBeNull();
  });
});
