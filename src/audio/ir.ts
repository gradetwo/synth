/**
 * The player's imported impulse response (A5).
 *
 * An IR is instrument state, like the wavetable: it belongs to the room the
 * player is working in, not to a patch, and patches only choose whether the
 * reverb section uses it (`fxReverbMode`). It is kept in `localStorage` so
 * reopening the app does not lose it, and handed to the core on every start
 * since the DSP's memory does not survive a reload.
 *
 * The stored form is 16-bit because a full-resolution two-second response is
 * 384 KB per save; 16 bits is below the noise floor of any recording that made
 * it into a reverb tail.
 */

import { WaveImportError, decodeSamples, decodeSamples16, encodeSamples } from './wavefile';
import { engine } from './engine';

const KEY = 'gs1:ir:v1';
/**
 * Samples the core can hold: `MAX_IR_SAMPLES` in `dsp/convolution.rs`. A file
 * longer than this is truncated rather than refused — a long response is a
 * legitimate file, just more than the engine has room for.
 */
const IR_CAPACITY = 96 * 1024;
/** Shortest response worth convolving: `MIN_IR_SAMPLES` in `dsp/convolution.rs`. */
const MIN_IR_SAMPLES = 32;

export interface UserIr {
  name: string;
  samples: Float32Array;
}

let current: UserIr | null = readStored();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeUserIr(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUserIr(): UserIr | null {
  return current;
}

function readStored(): UserIr | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: unknown; samples?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.samples !== 'string') return null;
    const samples = decodeSamples16(parsed.samples);
    return samples ? { name: parsed.name, samples } : null;
  } catch {
    return null;
  }
}

function persist(ir: UserIr | null) {
  try {
    if (ir) localStorage.setItem(KEY, JSON.stringify({ name: ir.name, samples: encodeSamples(ir.samples) }));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable or full: the response still works this session.
  }
}

/** Decode `file`, truncate it to what the core can hold and install it. */
export async function importUserIr(file: File): Promise<UserIr> {
  const decoded = await decodeSamples(file);
  const samples = decoded.length > IR_CAPACITY ? decoded.subarray(0, IR_CAPACITY) : decoded;
  // The core would refuse these too, but it is not necessarily running: check
  // here so a silent file is reported as silent rather than stored as an IR.
  if (samples.length < MIN_IR_SAMPLES) throw new WaveImportError('short', 'response too short');
  let peak = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) throw new WaveImportError('notFinite', 'invalid sample');
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak < 1e-4) throw new WaveImportError('silent', 'the response is silent');
  const result = await engine.importIR(samples);
  if (result.code > 0) {
    const code = result.code === 1 ? 'short' : result.code === 3 ? 'notFinite' : 'silent';
    throw new WaveImportError(code, 'impulse response refused by the core');
  }
  current = { name: file.name, samples: new Float32Array(samples) };
  persist(current);
  emit();
  return current;
}

export function clearUserIr() {
  if (!current) return;
  current = null;
  persist(null);
  engine.clearIR();
  emit();
}

/** (Re)send the stored response to the core after the engine starts. */
export async function installUserIr(): Promise<boolean> {
  if (!current) return false;
  const result = await engine.importIR(current.samples);
  return result.ok;
}

/** Test seam. */
export function setUserIrForTest(ir: UserIr | null) {
  current = ir;
  emit();
}
