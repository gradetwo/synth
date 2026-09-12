/**
 * Sound file → one cycle (A6.2).
 *
 * Importing a waveform for the wavetable oscillator means answering two
 * questions: *what* is in the file, and *which part of it is one cycle*. A file
 * exported from a wavetable editor holds exactly one cycle and needs no
 * analysis; a file holding a played note holds hundreds, and playing hundreds
 * of cycles as one would sound like noise. The period is found with a
 * normalised autocorrelation over the sustain part of the file, the shortest
 * strong period wins (the correlation repeats at every multiple, so without
 * that rule a two-cycle window would be preferred), and a few cycles are
 * averaged to take the room noise down.
 *
 * Decoding is done here rather than through `decodeAudioData` where possible:
 * a small RIFF reader covers PCM WAV files offline and on the audio thread's
 * terms, and the browser decoder is only needed for compressed formats.
 */

/** Samples in the cycle handed to the DSP. */
export const CYCLE_LENGTH = 2048;
/** Below this a "cycle" is noise, not a waveform. */
const MIN_CYCLE = 16;
/** Files at most this long are treated as exactly one cycle, unanalysed. */
const SINGLE_CYCLE_LIMIT = 8192;
/** Quietest peak that still counts as a waveform. */
const SILENCE = 1e-4;
const MIN_LAG = 16;
const MAX_LAG = 2048;
const ANALYSIS_WINDOW = 2048;

export type WaveImportErrorCode = 'short' | 'silent' | 'notFinite' | 'decode' | 'noRoom';

export class WaveImportError extends Error {
  constructor(
    readonly code: WaveImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WaveImportError';
  }
}

/** One cycle of `channel`, resampled to [`CYCLE_LENGTH`]. */
export function extractCycle(channel: Float32Array): Float32Array {
  if (channel.length < MIN_CYCLE) {
    throw new WaveImportError('short', `need at least ${MIN_CYCLE} samples`);
  }
  for (const value of channel) {
    if (!Number.isFinite(value)) throw new WaveImportError('notFinite', 'sample is not a number');
  }
  let peak = 0;
  for (const value of channel) peak = Math.max(peak, Math.abs(value));
  if (peak < SILENCE) throw new WaveImportError('silent', 'the file is silent');

  const cycle = channel.length <= SINGLE_CYCLE_LIMIT ? channel : sliceCycle(channel);
  return resample(cycle, CYCLE_LENGTH);
}

/** Centred copy of `samples`, suitable for a waveform preview or a comparison. */
export function normaliseCycle(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (peak <= 0) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / peak;
  return out;
}

/**
 * Period of `samples` in samples, found by normalised autocorrelation.
 *
 * Returns the whole length when the signal has no usable periodicity (a single
 * cycle held in a long file, a noise texture), which the caller treats as "the
 * file *is* the cycle".
 */
export function detectPeriod(samples: Float32Array): number {
  const maxLag = Math.min(MAX_LAG, Math.floor(samples.length / 4));
  if (maxLag <= MIN_LAG) return samples.length;
  const start = Math.floor(samples.length * 0.2);
  const window = Math.min(ANALYSIS_WINDOW, samples.length - start - maxLag);
  if (window < 256) return samples.length;

  const lags = maxLag - MIN_LAG + 1;
  const scores = new Float32Array(lags);
  let best = -Infinity;
  for (let lag = MIN_LAG; lag <= maxLag; lag++) {
    let numerator = 0;
    let energy = 0;
    for (let i = 0; i < window; i++) {
      const a = samples[start + i];
      const b = samples[start + i + lag];
      numerator += a * b;
      energy += b * b;
    }
    const score = numerator / Math.sqrt(energy + 1e-12);
    scores[lag - MIN_LAG] = score;
    if (score > best) best = score;
  }
  if (best <= 0) return samples.length;

  // The correlation is just as strong at 2×, 3× … the period, so take the
  // *shortest* lag that is a local maximum and close to the best score. The
  // local-maximum requirement rejects the shoulder of the peak.
  const floor = best * 0.9;
  for (let lag = MIN_LAG; lag <= maxLag; lag++) {
    const score = scores[lag - MIN_LAG];
    if (score < floor) continue;
    const previous = lag > MIN_LAG ? scores[lag - MIN_LAG - 1] : -Infinity;
    const next = lag < maxLag ? scores[lag - MIN_LAG + 1] : -Infinity;
    if (score >= previous && score >= next) return lag;
  }
  return samples.length;
}

/** Average a few aligned cycles starting at the first upward zero crossing. */
function sliceCycle(channel: Float32Array): Float32Array {
  const period = detectPeriod(channel);
  if (period >= channel.length) return channel;
  const search = Math.floor(channel.length * 0.2);
  let start = search;
  const limit = Math.min(channel.length - period - 1, search + period * 2);
  for (let i = search; i < limit; i++) {
    if (channel[i] <= 0 && channel[i + 1] > 0) {
      start = i;
      break;
    }
  }
  const repeats = Math.max(1, Math.min(4, Math.floor((channel.length - start) / period)));
  const out = new Float32Array(period);
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (let i = 0; i < period; i++) out[i] += channel[start + repeat * period + i];
  }
  for (let i = 0; i < period; i++) out[i] /= repeats;
  return out;
}

/** Wrapping linear resample, the same rule the DSP uses for a short cycle. */
function resample(source: Float32Array, length: number): Float32Array {
  const out = new Float32Array(length);
  const step = source.length / length;
  for (let i = 0; i < length; i++) {
    const position = i * step;
    const first = Math.floor(position) % source.length;
    const second = (first + 1) % source.length;
    const fraction = position - Math.floor(position);
    out[i] = source[first] * (1 - fraction) + source[second] * fraction;
  }
  return out;
}

export interface DecodedWave {
  sampleRate: number;
  samples: Float32Array;
}

/** Loudest channel of a decoded buffer, so a quiet left channel is not fatal. */
function loudestChannel(channels: Float32Array[]): Float32Array {
  let best = channels[0];
  let bestPeak = -1;
  for (const channel of channels) {
    let peak = 0;
    for (const value of channel) peak = Math.max(peak, Math.abs(value));
    if (peak > bestPeak) {
      bestPeak = peak;
      best = channel;
    }
  }
  return best;
}

/**
 * Parse a RIFF/WAVE file (PCM 8/16/24/32-bit and IEEE float). Returns `null`
 * for anything else, so the caller can fall back to the browser decoder.
 */
export function parseWav(bytes: ArrayBuffer): DecodedWave | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes);
  const tag = (offset: number) =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: { offset: number; length: number } | null = null;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= bytes.byteLength) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      data = { offset: body, length: Math.min(size, bytes.byteLength - body) };
      break;
    }
    offset = body + size + (size % 2);
  }

  if (!data || channels < 1 || sampleRate < 1000 || bits === 0) return null;
  const bytesPerSample = bits / 8;
  if (![1, 2, 3, 4, 8].includes(bytesPerSample)) return null;
  const frames = Math.floor(data.length / (bytesPerSample * channels));
  if (frames < MIN_CYCLE) return null;

  const read = (index: number): number => {
    const at = data!.offset + index * bytesPerSample;
    if (format === 3) {
      return bytesPerSample === 8 ? view.getFloat64(at, true) : view.getFloat32(at, true);
    }
    if (bytesPerSample === 1) return (view.getUint8(at) - 128) / 128;
    if (bytesPerSample === 2) return view.getInt16(at, true) / 32768;
    if (bytesPerSample === 3) {
      const lo = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
      return (lo << 8 >> 8) / 8388608;
    }
    return view.getInt32(at, true) / 2147483648;
  };

  const out: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel++) {
    const samples = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) samples[frame] = read(frame * channels + channel);
    out.push(samples);
  }
  return { sampleRate, samples: loudestChannel(out) };
}

/** Mono samples of any file the browser can decode, without cycle analysis. */
export async function decodeSamples(file: Blob): Promise<Float32Array> {
  return (await decodeSampleFile(file)).samples;
}

/**
 * As [`decodeSamples`], but keeping the rate the file was recorded at.
 *
 * A sampler needs it: playing a 22 kHz file through a 48 kHz engine at rate 1
 * would run it more than twice as fast and two octaves sharp.
 */
export async function decodeSampleFile(file: Blob): Promise<DecodedWave> {
  const bytes = await file.arrayBuffer();
  const wav = parseWav(bytes.slice(0));
  if (wav) return wav;

  const Offline =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) throw new WaveImportError('decode', 'this browser cannot decode that format');
  let buffer: AudioBuffer;
  try {
    const ctx = new Offline(1, 1, 44100);
    buffer = await ctx.decodeAudioData(bytes);
  } catch {
    throw new WaveImportError('decode', 'the file could not be decoded');
  }
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    channels.push(buffer.getChannelData(channel));
  }
  if (channels.length === 0) throw new WaveImportError('decode', 'the file has no audio');
  return { sampleRate: buffer.sampleRate, samples: loudestChannel(channels) };
}

/** One cycle from any file the browser can decode, WAV or not. */
export async function decodeCycle(file: Blob): Promise<Float32Array> {
  return extractCycle(await decodeSamples(file));
}

/** 16-bit samples as base64, for storing a waveform in `localStorage`. */
export function encodeSamples(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

export function decodeSamples16(text: string): Float32Array | null {
  try {
    const binary =
      typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
    if (binary.length < 2) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const out = new Float32Array(bytes.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32767;
    return out;
  } catch {
    return null;
  }
}
