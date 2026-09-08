/**
 * Audio graph + WASM lifecycle.
 *
 * Graph:  SynthWorkletNode -> masterGain -> analyser -> destination
 *
 * Browser compatibility notes:
 *  - The `AudioContext` is created and resumed *synchronously inside the user
 *    gesture*. Safari refuses to start a context that was only resumed after an
 *    `await`.
 *  - The WASM bytes are shipped to the worklet as a structured-cloneable
 *    `ArrayBuffer` and instantiated inside the worklet. Passing a
 *    `WebAssembly.Module` through `processorOptions` is not reliable on Safari.
 *  - Two WASM builds are shipped; SIMD is feature-detected at runtime so older
 *    Safari (pre-16.4) falls back to the scalar core.
 */

import simdWasmUrl from '@/generated/synth_core.wasm?url';
import scalarWasmUrl from '@/generated/synth_core_scalar.wasm?url';
import processorUrl from './worklet-processor.js?url';
import {
  PARAM_NAMES,
  type ModRoute,
  type ParamId,
  type SynthState,
  clamp,
} from './params';

export interface AnalysisFrame {
  spectrum: Float32Array;
  peakL: number;
  peakR: number;
  voices: number;
  violations: number;
}

type AnalysisListener = (frame: AnalysisFrame) => void;

/** Parameters that are stepped, not ramped (enums / switches). */
const DISCRETE = new Set<number>([1, 2, 7, 8, 13, 18, 23, 24, 27, 28, 29, 32, 33]);

/** Minimal module that uses a v128 op — the canonical SIMD feature probe. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

export function detectSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

export type EngineStatus = 'idle' | 'loading' | 'running' | 'suspended' | 'error';

export interface EngineDiagnostics {
  simd: boolean;
  wasm: 'simd' | 'scalar' | 'none';
  contextState: string;
  sampleRate: number;
  userAgent: string;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  analyser: AnalyserNode | null = null;
  masterGain: GainNode | null = null;

  status: EngineStatus = 'idle';
  error: string | null = null;
  sampleRate = 48000;
  simdSupported = detectSimd();

  private loadPromise: Promise<void> | null = null;
  private listeners = new Set<AnalysisListener>();
  private statusListeners = new Set<() => void>();
  private timeBuffer = new Float32Array(1024);

  onAnalysis(fn: AnalysisListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  diagnostics(): EngineDiagnostics {
    return {
      simd: this.simdSupported,
      wasm: this.node ? (this.simdSupported ? 'simd' : 'scalar') : 'none',
      contextState: this.ctx?.state ?? 'none',
      sampleRate: this.sampleRate,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
    };
  }

  private emitStatus() {
    for (const fn of this.statusListeners) fn();
  }

  private setStatus(status: EngineStatus, error: string | null = null) {
    this.status = status;
    this.error = error;
    this.emitStatus();
  }

  /**
   * Create the AudioContext. Must be called from a user gesture; it does no
   * awaiting so the gesture is still valid for `resume()`.
   */
  ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      this.ctx = new AudioContext();
    }
    this.sampleRate = this.ctx.sampleRate;
    this.ctx.onstatechange = () => {
      const state = this.ctx?.state;
      if (state === 'running') this.setStatus('running');
      else if (state === 'suspended') this.setStatus('suspended');
    };
    return this.ctx;
  }

  /**
   * Full startup. Call directly from a click/tap handler: the context is
   * created and resumed before the first `await`.
   */
  async start(maxPolyphony = 16, routes?: ModRoute[]): Promise<void> {
    const ctx = this.ensureContext();
    const resume = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    try {
      await this.load(ctx, maxPolyphony, routes);
      await resume;
      if (ctx.state === 'running') this.setStatus('running');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus('error', message);
      throw err;
    }
  }

  /** Load WASM + worklet and build the graph (no resume). */
  async init(maxPolyphony = 16, routes?: ModRoute[]): Promise<void> {
    await this.load(this.ensureContext(), maxPolyphony, routes);
  }

  private load(ctx: AudioContext, maxPolyphony: number, routes?: ModRoute[]): Promise<void> {
    if (this.node) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      this.setStatus('loading');
      const url = this.simdSupported ? simdWasmUrl : scalarWasmUrl;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        let response: Response;
        try {
          response = await fetch(url, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) throw new Error(`WASM 下载失败 (HTTP ${response.status})`);
        const bytes = await response.arrayBuffer();
        if (!WebAssembly.validate(bytes)) {
          throw new Error('WASM 模块校验失败（可能被服务器改写了内容）');
        }

        await ctx.audioWorklet.addModule(processorUrl);

        const node = new AudioWorkletNode(ctx, 'gs1-synth-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: {
            wasmBytes: bytes,
            sampleRate: ctx.sampleRate,
            maxPolyphony,
            routes: routes?.map((r) => ({
              src: r.src,
              dst: r.dst,
              amount: r.amount,
              enabled: r.enabled,
            })),
          },
        });
        this.node = node;

        const masterGain = ctx.createGain();
        masterGain.gain.value = 1;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        this.masterGain = masterGain;
        this.analyser = analyser;

        node.connect(masterGain);
        masterGain.connect(analyser);
        analyser.connect(ctx.destination);

        node.port.onmessage = (event) => {
          const data = event.data;
          if (!data) return;
          if (data.type === 'analysis') {
            const frame: AnalysisFrame = {
              spectrum: data.spectrum as Float32Array,
              peakL: data.peakL as number,
              peakR: data.peakR as number,
              voices: data.voices as number,
              violations: data.violations as number,
            };
            for (const fn of this.listeners) fn(frame);
          } else if (data.type === 'error') {
            this.setStatus('error', String(data.message));
          }
        };

        this.setStatus(ctx.state === 'running' ? 'running' : 'suspended');
      } catch (err) {
        this.loadPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        this.setStatus('error', message);
        throw err;
      }
    })();

    return this.loadPromise;
  }

  /** Must be called from a user gesture on iOS/Safari. */
  async resume(): Promise<void> {
    const ctx = this.ctx ?? this.ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
      this.setStatus('running');
    }
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
      this.setStatus('suspended');
    }
  }

  async close(): Promise<void> {
    this.node?.disconnect();
    this.masterGain?.disconnect();
    this.analyser?.disconnect();
    if (this.ctx) await this.ctx.close();
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.masterGain = null;
    this.loadPromise = null;
    this.setStatus('idle');
  }

  /** Apply a parameter through the matching AudioParam. */
  setParam(id: ParamId, value: number, immediate = false) {
    if (!this.node || !this.ctx) return;
    const name = PARAM_NAMES[id];
    const param = this.node.parameters.get(name);
    if (!param) return;
    const t = this.ctx.currentTime;
    const v = clamp(value, param.minValue, param.maxValue);
    if (immediate || DISCRETE.has(id)) {
      param.setValueAtTime(v, t);
    } else {
      // Browser-side smoothing: no DSP-internal ramp needed (prd.md §5.1).
      param.setTargetAtTime(v, t, 0.008);
    }
  }

  applyState(state: SynthState, immediate = false) {
    for (const [id, value] of Object.entries(state.params)) {
      this.setParam(Number(id) as ParamId, value, immediate);
    }
    state.routes.forEach((route, index) => this.setRoute(index, route));
  }

  setRoute(index: number, route: ModRoute) {
    this.node?.port.postMessage({
      type: 'modRoute',
      index,
      src: route.src,
      dst: route.dst,
      amount: route.amount,
      enabled: route.enabled,
    });
  }

  noteOn(note: number, velocity = 1) {
    const buf = new Uint8Array([0x90, note & 0x7f, Math.round(clamp(velocity, 0, 1) * 127)]);
    this.node?.port.postMessage(buf.buffer, [buf.buffer]);
  }

  noteOff(note: number) {
    const buf = new Uint8Array([0x80, note & 0x7f, 0]);
    this.node?.port.postMessage(buf.buffer, [buf.buffer]);
  }

  pitchBend(semitones: number) {
    this.node?.port.postMessage({ type: 'pitchBend', value: semitones });
  }

  modWheel(value: number) {
    this.node?.port.postMessage({ type: 'modWheel', value });
  }

  allNotesOff() {
    this.node?.port.postMessage({ type: 'allNotesOff' });
  }

  setMuted(muted: boolean) {
    this.node?.port.postMessage({ type: 'mute', value: muted });
  }

  setPolyphony(value: number) {
    this.node?.port.postMessage({ type: 'setPolyphony', value });
  }

  triggerSmoothDowngrade() {
    this.node?.port.postMessage({ type: 'downgrade' });
  }

  /** Time-domain samples for the oscilloscope / VU meter. */
  getTimeDomain(target: Float32Array): boolean {
    if (!this.analyser) return false;
    if (target.length !== this.timeBuffer.length) this.timeBuffer = new Float32Array(target.length);
    this.analyser.getFloatTimeDomainData(this.timeBuffer as Float32Array<ArrayBuffer>);
    target.set(this.timeBuffer.subarray(0, target.length));
    return true;
  }

  getState(): EngineStatus {
    return this.status;
  }
}

export const engine = new AudioEngine();
