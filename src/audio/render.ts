/**
 * Offline patch rendering → WAV download.
 *
 * Runs the same AudioWorklet + WASM core inside an `OfflineAudioContext`, so the
 * exported audio is bit-for-bit the live engine (no second DSP path). On an engine
 * that has `OfflineAudioContext.suspend`, notes are scheduled with it so they land
 * on the exact render times the shipped exports already use; where it is missing
 * (Firefox, see below) the whole song is handed to the worklet and applied by
 * absolute frame instead.
 */

import simdWasmUrl from '@/generated/synth_core.wasm?url';
import scalarWasmUrl from '@/generated/synth_core_scalar.wasm?url';
// Same minified asset the live engine loads (see `engine.ts`): the offline
// render must run the exact processor that the visitor downloaded.
import processorUrl from '@/generated/worklet-processor.min.js?url';
import { detectSimd } from './engine';
import { getUserWave } from './userWave';
import { getUserIr } from './ir';
import { getUserSample } from './userSample';
import { t } from '@/i18n';
import { PARAM_NAMES, type SynthState } from './params';

export interface RenderOptions {
  seconds?: number;
  sampleRate?: number;
  /** [note, startSeconds, lengthSeconds, velocity?, pan?] tuples. */
  notes?: [number, number, number, number?, number?][];
}

const DEFAULT_PHRASE: [number, number, number, number?, number?][] = [
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

  /**
   * Firefox has no `OfflineAudioContext.suspend` at all (MDN BCD
   * `api.OfflineAudioContext.suspend` → firefox `version_added: false`, bug 1265406;
   * `resume` is only partial and always rejects). Calling it there throws
   * `TypeError: ctx.suspend is not a function` before a single frame is rendered, which
   * is why every MP3 and WAV export failed on every Gecko browser.
   *
   * The two schedules are **not** bit-identical, and that was measured rather than assumed
   * (Chromium, 44.1 kHz, default patch): `suspend(start)` stops rendering and resumes it on
   * the next 128-frame render quantum, so the note-on message is applied at the quantum
   * boundary at or after `start`, while the frame-addressed path applies it on the exact
   * frame. Both then cost the same one-quantum voice-start latency (documented as
   * `scheduledNoteLatencyFrames`). A note at frame 22050 (0.5 s) first sounds at frame
   * **22288** through `suspend` and **22194** frame-addressed; the difference is
   * `(128 - atFrame % 128) % 128` frames, i.e. 0-127 frames (0-2.88 ms), and the
   * frame-addressed path is never the later of the two. So an engine that *can* suspend keeps
   * the schedule its exports already shipped with, and the frame-addressed path is the
   * fallback — not a silent re-timing of every existing user's file. See
   * `docs/notes/compat.md` §5.
   */
  const canSuspend = typeof ctx.suspend === 'function';

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
      // Offline rendering has no deadline: the file gets the full 32-voice
      // pool, so a long-release patch on a dense song is not cut short by
      // stealing the way live playback (16 voices) has to be.
      maxPolyphony: 32,
      routes: state.routes.map((r) => ({ src: r.src, dst: r.dst, amount: r.amount, enabled: r.enabled })),
      // The fallback path only. Notes are absolute frames, and a layer's pan
      // rides along exactly as it does live (`noteOnPan` only above the
      // audibility threshold, centred `noteOn` otherwise).
      ...(canSuspend
        ? {}
        : {
            notes: notes.map(([note, start, noteLength, velocity, pan]) => ({
              note,
              onFrame: Math.round(start * sampleRate),
              offFrame: Math.round((start + noteLength) * sampleRate),
              velocity: velocity ?? 0.9,
              ...(pan !== undefined && Math.abs(pan) > 0.005 ? { pan } : {}),
            })),
          }),
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

  // The imported cycle is instrument state, not part of the patch, so an export
  // has to hand it over as well or it would render a factory bank instead.
  const sample = getUserSample();
  if (sample) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      node.port.onmessage = (event) => {
        if (event.data?.type === 'sample') {
          clearTimeout(timer);
          resolve();
        }
      };
      node.port.postMessage({
        type: 'sample',
        request: 3,
        samples: sample.samples,
        sampleRate: sample.sampleRate,
      });
    });
  }

  const ir = getUserIr()?.samples;
  if (ir) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      node.port.onmessage = (event) => {
        if (event.data?.type === 'ir') {
          clearTimeout(timer);
          resolve();
        }
      };
      node.port.postMessage({ type: 'ir', request: 2, samples: ir });
    });
  }

  const cycle = getUserWave()?.cycle;
  if (cycle) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      node.port.onmessage = (event) => {
        if (event.data?.type === 'wavetable') {
          clearTimeout(timer);
          resolve();
        }
      };
      node.port.postMessage({ type: 'wavetable', request: 1, samples: cycle });
    });
  }

  for (const [id, value] of Object.entries(state.params)) {
    const name = PARAM_NAMES[Number(id) as keyof typeof PARAM_NAMES];
    node.parameters.get(name)?.setValueAtTime(value, 0);
  }

  // Only an engine that can suspend uses this schedule; everywhere else the notes
  // already reached the worklet through `processorOptions.notes` above and the
  // engine applies each one on its exact frame as it renders.
  if (canSuspend) {
    for (const [note, start, noteLength, velocity, pan] of notes) {
      ctx.suspend(start).then(() => {
        // A song layer's pan travels with the note, exactly as it does live.
        if (pan !== undefined && Math.abs(pan) > 0.005) {
          node.port.postMessage({ type: 'noteOnPan', note, velocity: velocity ?? 0.9, pan });
        } else {
          node.port.postMessage({ type: 'noteOn', note, velocity: velocity ?? 0.9 });
        }
        ctx.resume();
      });
      ctx.suspend(start + noteLength).then(() => {
        node.port.postMessage({ type: 'noteOff', note });
        ctx.resume();
      });
    }
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
 * Normalise a rendered buffer to `ceiling`.
 *
 * Both directions matter: a loud patch must not leave the render pinned at full
 * scale, and — more importantly — a quiet patch must not be *exported* quiet. A
 * synth patch that plays single notes sits 15-20 dB below a dense chord, so
 * without a boost the electric pianos exported at about -23 dBFS: listeners
 * then crank the volume (or a phone's loudness normalisation does it for them)
 * and everything downstream — the DAC, the speaker, a Bluetooth codec — is
 * driven far harder than the file deserves.
 *
 * The boost is capped so an almost-silent render cannot be amplified into a
 * noise floor.
 */
export function normalizePeak(data: Float32Array[], ceiling = 0.891, maxBoostDb = 24): number {
  let peak = 0;
  for (const channel of data) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
  }
  if (!Number.isFinite(peak) || peak <= 0) return peak;
  const minPeak = ceiling / 10 ** (maxBoostDb / 20);
  const gain = ceiling / Math.max(peak, minPeak);
  if (Math.abs(gain - 1) < 1e-4) return peak;
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
