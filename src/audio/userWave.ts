/**
 * The player's imported single-cycle waveform (A6.2).
 *
 * One cycle is instrument state, not patch state: it is loaded from a file the
 * player chose, it is the same cycle for every patch, and patches only decide
 * whether to *use* it (the `wtUser` switch). It therefore lives beside the
 * tuning table and the MIDI bindings rather than inside a patch, and it is kept
 * in `localStorage` so reopening the app does not lose the waveform.
 *
 * The cycle is stored as 16-bit samples. That is a deliberate trade: a full
 * 32-bit float cycle is 8 KB of JSON per save, and the DSP analyses the cycle
 * into 1024 harmonic amplitudes immediately, where 16-bit quantisation sits
 * below the noise floor of the analysis.
 */

import { CYCLE_LENGTH, WaveImportError, decodeCycle } from './wavefile';
import { engine } from './engine';
import { SCHEMA_VERSION } from '@/state/persist';

const KEY = 'gs1:wt-user:v1';

export interface UserWave {
  name: string;
  cycle: Float32Array;
}

let current: UserWave | null = readStored();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeUserWave(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot for `useSyncExternalStore` (the object only changes on edit). */
export function getUserWave(): UserWave | null {
  return current;
}

/** Base64 of little-endian int16 samples, plus the file name. */
export function encodeUserWave(wave: { name: string; cycle: Float32Array }): string {
  const bytes = new Uint8Array(wave.cycle.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < wave.cycle.length; i++) {
    const clamped = Math.max(-1, Math.min(1, wave.cycle[i]));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const encoded = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return JSON.stringify({ schema: SCHEMA_VERSION, name: wave.name, samples: encoded });
}

export function decodeUserWave(raw: string): UserWave | null {
  try {
    const parsed = JSON.parse(raw) as { schema?: unknown; name?: unknown; samples?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.samples !== 'string') return null;
    // A waveform stored by a newer build may mean something else; do not guess.
    if (typeof parsed.schema === 'number' && parsed.schema > SCHEMA_VERSION) return null;
    const binary =
      typeof atob === 'function' ? atob(parsed.samples) : Buffer.from(parsed.samples, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length < CYCLE_LENGTH) return null;
    const view = new DataView(bytes.buffer);
    const cycle = new Float32Array(bytes.length / 2);
    for (let i = 0; i < cycle.length; i++) cycle[i] = view.getInt16(i * 2, true) / 32767;
    return { name: parsed.name, cycle };
  } catch {
    return null;
  }
}

function readStored(): UserWave | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? decodeUserWave(raw) : null;
  } catch {
    // Private mode, disabled storage, or an older build: a missing waveform is
    // not an error, the factory banks still work.
    return null;
  }
}

function persist(wave: UserWave | null) {
  try {
    if (wave) localStorage.setItem(KEY, encodeUserWave(wave));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage full or unavailable: the cycle still works for this session.
  }
}

/**
 * Decode `file` and install it in the running core.
 *
 * Throws a [`WaveImportError`] the caller can turn into a message: the file
 * may not be audio, may be silent, or may be too short to hold a cycle.
 */
export async function importUserWave(file: File): Promise<UserWave> {
  const cycle = await decodeCycle(file);
  const result = await engine.importWavetable(cycle);
  if (result.code > 0) {
    // The core is the authority on whether a cycle is usable, so a refusal
    // after a successful decode is reported rather than papered over. A
    // negative code means "no core running", which is not a decode failure:
    // the cycle is kept and installed when the engine starts.
    const code = result.code === 1 ? 'short' : result.code === 3 ? 'notFinite' : 'silent';
    throw new WaveImportError(code, 'waveform refused by the core');
  }
  current = { name: file.name, cycle };
  persist(current);
  emit();
  return current;
}

/** Forget the waveform. Patches asking for it fall back to the factory banks. */
export function clearUserWave() {
  if (!current) return;
  current = null;
  persist(null);
  engine.clearWavetable();
  emit();
}

/**
 * (Re)send the stored cycle to the core. Called after the engine starts and
 * after an engine restart, since the DSP's memory does not survive either.
 */
export async function installUserWave(): Promise<boolean> {
  if (!current) return false;
  const result = await engine.importWavetable(current.cycle);
  return result.ok;
}

/** Test seam: swap the stored waveform without touching storage or the core. */
export function setUserWaveForTest(wave: UserWave | null) {
  current = wave;
  emit();
}
