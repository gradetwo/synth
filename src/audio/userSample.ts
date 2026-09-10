/**
 * The player's imported sample (A).
 *
 * Instrument state like the wavetable and the impulse response: one sample is
 * loaded for the instrument, every patch decides whether to play it (the sample
 * wave), and it is kept in `localStorage` so a reload does not lose it. The rate
 * it was recorded at travels with it — that is what makes it play at the right
 * pitch rather than at whatever rate the engine happens to run at.
 */

import { WaveImportError, decodeSampleFile, decodeSamples16, encodeSamples } from './wavefile';
import { engine } from './engine';
import { SCHEMA_VERSION } from '@/state/persist';

const KEY = 'gs1:sample:v1';
/** Samples the core can hold: `MAX_BASE_SAMPLES` in `dsp/sampler.rs` (4 s at 48 kHz). */
const SAMPLE_CAPACITY = 192 * 1024;
const MIN_SAMPLE_SAMPLES = 32;

export interface UserSample {
  name: string;
  samples: Float32Array;
  sampleRate: number;
}

let current: UserSample | null = readStored();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeUserSample(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUserSample(): UserSample | null {
  return current;
}

function readStored(): UserSample | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { schema?: unknown; name?: unknown; samples?: unknown; rate?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.samples !== 'string') return null;
    if (typeof parsed.schema === 'number' && parsed.schema > SCHEMA_VERSION) return null;
    const samples = decodeSamples16(parsed.samples);
    if (!samples) return null;
    const rate = typeof parsed.rate === 'number' && parsed.rate > 1000 ? parsed.rate : 48_000;
    return { name: parsed.name, samples, sampleRate: rate };
  } catch {
    return null;
  }
}

function persist(sample: UserSample | null) {
  try {
    if (!sample) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schema: SCHEMA_VERSION,
        name: sample.name,
        rate: sample.sampleRate,
        // Sample rate is not stored twice: the payload is resampled by the core,
        // but the *stored* audio stays as recorded so re-importing is lossless
        // enough at 16 bits.
        samples: encodeSamples(sample.samples),
      }),
    );
  } catch {
    // Storage unavailable or full: the sample still works for this session.
  }
}

/** Decode `file`, truncate it to what the core can hold and install it. */
export async function importUserSample(file: File): Promise<UserSample> {
  const decoded = await decodeSampleFile(file);
  const samples =
    decoded.samples.length > SAMPLE_CAPACITY ? decoded.samples.subarray(0, SAMPLE_CAPACITY) : decoded.samples;
  if (samples.length < MIN_SAMPLE_SAMPLES) throw new WaveImportError('short', 'sample too short');
  let peak = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) throw new WaveImportError('notFinite', 'invalid sample');
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak < 1e-4) throw new WaveImportError('silent', 'the file is silent');

  const result = await engine.importSample(samples, decoded.sampleRate);
  if (result.code > 0) {
    const code = result.code === 1 ? 'short' : result.code === 3 ? 'notFinite' : 'silent';
    throw new WaveImportError(code, 'sample refused by the core');
  }
  current = { name: file.name, samples: new Float32Array(samples), sampleRate: decoded.sampleRate };
  persist(current);
  emit();
  return current;
}

export function clearUserSample() {
  if (!current) return;
  current = null;
  persist(null);
  engine.clearSample();
  emit();
}

/** (Re)send the stored sample to the core after the engine starts. */
export async function installUserSample(): Promise<boolean> {
  if (!current) return false;
  const result = await engine.importSample(current.samples, current.sampleRate);
  return result.ok;
}

/** Test seam. */
export function setUserSampleForTest(sample: UserSample | null) {
  current = sample;
  emit();
}
