/**
 * Audio graph + WASM lifecycle.
 *
 * Graph:  SynthWorkletNode -> masterGain -> analyser -> destination
 *
 * The worklet owns the DSP; this class owns the browser side — compiling the
 * WASM module on the main thread (the AudioWorklet scope has no `fetch`), wiring
 * AudioParam automation, and shipping note events as transferable buffers.
 */

import wasmUrl from '@/generated/synth_core.wasm?url';
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

export type EngineStatus = 'idle' | 'loading' | 'running' | 'suspended' | 'error';

export class AudioEngine {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  analyser: AnalyserNode | null = null;
  masterGain: GainNode | null = null;

  status: EngineStatus = 'idle';
  error: string | null = null;
  sampleRate = 48000;

  private wasmModule: WebAssembly.Module | null = null;
  private listeners = new Set<AnalysisListener>();
  private statusListeners = new Set<() => void>();
  private timeBuffer = new Float32Array(1024);
  private initPromise: Promise<void> | null = null;
  private lastParams: Record<number, number> = {};

  onAnalysis(fn: AnalysisListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private emitStatus() {
    for (const fn of this.statusListeners) fn();
  }

  private setStatus(status: EngineStatus, error: string | null = null) {
    this.status = status;
    this.error = error;
    this.emitStatus();
  }

  /** Load WASM + worklet and build the graph. Safe to call repeatedly. */
  async init(maxPolyphony = 16, routes?: ModRoute[]): Promise<void> {
    if (this.status === 'running' || this.status === 'suspended') return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.setStatus('loading');
      try {
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.sampleRate = ctx.sampleRate;

        const response = await fetch(wasmUrl);
        if (!response.ok) throw new Error(`wasm fetch failed: ${response.status}`);
        const bytes = await response.arrayBuffer();
        // Compile on the main thread; the Module is structured-cloneable.
        this.wasmModule = await WebAssembly.compile(bytes);

        await ctx.audioWorklet.addModule(processorUrl);

        const node = new AudioWorkletNode(ctx, 'gs1-synth-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: {
            wasmModule: this.wasmModule,
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
        ctx.onstatechange = () => {
          if (ctx.state === 'running') this.setStatus('running');
          else if (ctx.state === 'suspended') this.setStatus('suspended');
        };
      } catch (err) {
        this.setStatus('error', err instanceof Error ? err.message : String(err));
        throw err;
      }
    })();

    return this.initPromise;
  }

  /** Must be called from a user gesture on iOS/Safari. */
  async resume(): Promise<void> {
    if (!this.ctx) await this.init();
    if (this.ctx && this.ctx.state !== 'running') {
      await this.ctx.resume();
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
    this.initPromise = null;
    this.setStatus('idle');
  }

  /** Apply a parameter through the matching AudioParam. */
  setParam(id: ParamId, value: number, immediate = false) {
    this.lastParams[id] = value;
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
