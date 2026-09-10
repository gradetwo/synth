/**
 * Offline patch rendering → WAV download.
 *
 * Runs the same AudioWorklet + WASM core inside an `OfflineAudioContext`, so the
 * exported audio is bit-for-bit the live engine (no second DSP path). Notes are
 * scheduled with `ctx.suspend(t)` so they land at exact render times.
 */

import simdWasmUrl from '@/generated/synth_core.wasm?url';
import scalarWasmUrl from '@/generated/synth_core_scalar.wasm?url';
import processorUrl from './worklet-processor.js?url';
import { detectSimd } from './engine';
import { t } from '@/i18n';
import { PARAM_NAMES, type SynthState } from './params';

export interface RenderOptions {
  seconds?: number;
  sampleRate?: number;
  /** [note, startSeconds, lengthSeconds, velocity?] tuples. */
  notes?: [number, number, number, number?][];
}

const DEFAULT_PHRASE: [number, number, number, number?][] = [
  [60, 0.1, 0.34],
  [64, 0.5, 0.34],
  [67, 0.9, 0.34],
  [72, 1.3, 0.5],
  [67, 1.9, 0.34],
  [64, 2.3, 0.34],
  [62, 2.7, 0.34],
  [65, 3.1, 0.34],
  [69, 3.5, 0.34],
  [74, 3.9, 0.7],
  [69, 4.7, 0.34],
  [65, 5.1, 0.8],
];

async function fetchBytes(simd: boolean): Promise<ArrayBuffer> {
  const response = await fetch(simd ? simdWasmUrl : scalarWasmUrl);
  if (!response.ok) throw new Error(t('err.wasmFetch', { status: response.status }));
  return response.arrayBuffer();
}

/** Render the current patch and return the raw stereo AudioBuffer. */
export async function renderPatchToBuffer(
  state: SynthState,
  options: RenderOptions = {},
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const notes = options.notes ?? DEFAULT_PHRASE;
  const seconds = options.seconds ?? Math.max(2, ...notes.map(([, start, length]) => start + length + 1.5));
  const length = Math.ceil(seconds * sampleRate);

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });

  let bytes = await fetchBytes(detectSimd());
  if (!WebAssembly.validate(bytes)) bytes = await fetchBytes(false);

  await ctx.audioWorklet.addModule(processorUrl);
  const node = new AudioWorkletNode(ctx, 'gs1-synth-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      wasmBytes: bytes,
      sampleRate,
      maxPolyphony: 16,
      routes: state.routes.map((r) => ({ src: r.src, dst: r.dst, amount: r.amount, enabled: r.enabled })),
    },
  });
  node.connect(ctx.destination);

  // Wait for the worklet to finish instantiating the WASM core.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    node.port.onmessage = (event) => {
      if (event.data?.type === 'ready') {
        clearTimeout(timer);
        resolve();
      }
    };
  });

  for (const [id, value] of Object.entries(state.params)) {
    const name = PARAM_NAMES[Number(id) as keyof typeof PARAM_NAMES];
    node.parameters.get(name)?.setValueAtTime(value, 0);
  }

  for (const [note, start, noteLength, velocity] of notes) {
    ctx.suspend(start).then(() => {
      node.port.postMessage({ type: 'noteOn', note, velocity: velocity ?? 0.9 });
      ctx.resume();
    });
    ctx.suspend(start + noteLength).then(() => {
      node.port.postMessage({ type: 'noteOff', note });
      ctx.resume();
    });
  }

  return ctx.startRendering();
}

/** Render the current patch and return a 16-bit stereo WAV blob. */
export async function renderPatchToWav(state: SynthState, options: RenderOptions = {}): Promise<Blob> {
  return encodeWav(await renderPatchToBuffer(state, options));
}

export interface WavSource {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

function writeString(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Encode an AudioBuffer (or anything AudioBuffer-like) as a 16-bit PCM WAV. */
/**
 * Scale a rendered buffer so its highest sample sits at `ceiling`.
 *
 * Exports bypass the live master limiter's metering, so a patch that is loud
 * enough to be limited live would otherwise leave the render pinned near full
 * scale. Normalising keeps every export at a predictable level (and only ever
 * turns things *down*: quiet renders are left alone).
 */
export function normalizePeak(data: Float32Array[], ceiling = 0.891): number {
  let peak = 0;
  for (const channel of data) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
  }
  if (!Number.isFinite(peak) || peak <= ceiling) return peak;
  const gain = ceiling / peak;
  for (const channel of data) {
    for (let i = 0; i < channel.length; i++) channel[i] *= gain;
  }
  return peak;
}

export function encodeWav(buffer: WavSource): Blob {
  return new Blob([encodeWavBuffer(buffer)], { type: 'audio/wav' });
}

/** Same as `encodeWav` but returns the raw buffer (easier to test/inspect). */
export function encodeWavBuffer(buffer: WavSource): ArrayBuffer {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels));
  const frames = buffer.length;
  const blockAlign = channels * 2;
  const dataSize = frames * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataSize));

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, data[c][i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return view.buffer;
}
