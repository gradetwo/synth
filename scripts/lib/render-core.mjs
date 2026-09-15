#!/usr/bin/env node
/**
 * The render core: the real WASM engine, in Node.
 *
 * `verify-audio.mjs` grew this first -- load `src/generated/synth_core.wasm`,
 * `gs_init`, push a parameter block, start notes, step 128-sample blocks -- and
 * the P13 interface (see `docs/LLM-INTERFACE.md`) needs exactly the same thing:
 * **one implementation shared by the gate and the tools**, so the two can never
 * measure different engines. This module is that implementation, lifted out of
 * the gate without changing a line of its behaviour.
 *
 * **Which layer this measures.** Everything here runs the wasm core *in Node*:
 * the same module the browser loads, but with no AudioWorklet, no AudioParam
 * automation and no Web Audio graph in front of it. That is the right layer for
 * DSP questions and the wrong layer for "what does the app actually play" --
 * the v2.0.7 AudioParam-range bug that made ten presets set the wrong algorithm
 * is exactly the kind of thing this layer cannot see, because the clamp happens
 * above the wasm. A real-browser measurement is P13.4. Treat every number this
 * file produces as an *engine* number, and say so when you report it.
 *
 * The numbers this file hands back (peak, RMS, block steps, arena bytes, import
 * codes) are facts about that core, not judgements about a sound. The rulers
 * live in `audio-ruler.mjs`.
 *
 * Why lazy `initCore()` instead of instantiating at import time: a pure ruler
 * (FFT, a window, a bin magnitude) does not need an engine, and `audio-ruler`
 * imports the constants from here. Instantiating on import would make the ruler
 * module spawn a wasm engine just to read a window coefficient.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_WASM = resolve(root, 'src/generated/synth_core.wasm');

/**
 * The core's exports. Filled by `initCore()`; every helper below and the
 * callers that drive the core directly (the gate has ~150 `ex.*` calls of its
 * own) read this live binding, so `initCore()` has to run before the first
 * render.
 */
export let ex = null;

/** Instantiate the wasm core. The missing-wasm message is the gate's own. */
export function initCore(wasmPath = DEFAULT_WASM) {
  if (!existsSync(wasmPath)) {
    console.error('[audio] src/generated/synth_core.wasm missing — run "npm run build:wasm"');
    process.exit(1);
  }
  ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {}).exports;
  return ex;
}

export const SR = 48000;
export const BLOCK = 128;
export const BUDGET_US = (BLOCK / SR) * 1e6;

/**
 * The engine's parameter ids, hand-written because the gate drives the core by
 * numeric id. Kept verbatim from the gate: a mistyped id lands on parameter 0
 * and quietly changes the master volume instead of failing.
 */
export const P = {
  MASTER_VOLUME: 0, OSC1_ON: 1, OSC1_WAVE: 2, OSC1_LEVEL: 5, OSC2_ON: 7, OSC2_WAVE: 8,
  OSC2_LEVEL: 11, FILTER_TYPE: 13, FILTER_CUTOFF: 14, FILTER_RES: 15, FILTER_DRIVE: 16,
  FILTER_ENV_AMT: 17, FILTER_KBD: 18, ENV_ATTACK: 19, ENV_DECAY: 20, ENV_SUSTAIN: 21, ENV_RELEASE: 22,
  LFO_ON: 23, LFO2_ON: 62, FX_REVERB_ON: 29, FX_DELAY_ON: 32, FX_CHORUS_ON: 43, FX_FLANGER_ON: 47,
  FX_PHASER_ON: 51, FX_DRIVE_ON: 55, VOICE_MODE: 42, OSC1_PW: 6, WT_USER: 79,
  FX_DELAY_FB: 34, FX_DELAY_MIX: 35, FX_DELAY_SYNC: 33, FX_DRIVE_AMT: 56, FX_DRIVE_MIX: 57,
  FX_REVERB_MIX: 31, FX_REVERB_MODE: 94, FX_CONV_TRIM: 95,
  FX_CHAIN1: 82, FX_CHAIN2: 83, FX_CHAIN3: 84, FX_CHAIN4: 85, FX_CHAIN5: 86, FX_CHAIN6: 87,
  SMP_ROOT: 96, SMP_MODE: 97, SMP_LOOP_START: 98, SMP_LOOP_END: 99, TEMPO: 37,
  OSC2_PITCH: 9, OSC_FM: 137, OSC_RING: 138,
  OSC1_PITCH: 3, OSC1_SYNC: 139, OSC1_SUB: 140, OSC1_SUB_LEVEL: 141,
  OSC2_SUB: 142, OSC2_SUB_LEVEL: 143, NOISE_MIX: 144, FILTER_MORPH: 145,
  FILTER_ROUTING: 146, FILTER2_TYPE: 147, FILTER2_CUTOFF: 148, FILTER2_RES: 149,
  FILTER2_DRIVE: 150, FILTER_BLEND: 151,
  FX_CRUSH_ON: 152, FX_CRUSH_BITS: 153, FX_CRUSH_DOWN: 154, FX_CRUSH_AA: 155, FX_CRUSH_MIX: 156,
  FX_EQ_ON: 157, FX_EQ_LOW_GAIN: 158, FX_EQ_LOW_FREQ: 159, FX_EQ_MID_GAIN: 160,
  FX_EQ_MID_FREQ: 161, FX_EQ_MID_Q: 162, FX_EQ_HIGH_GAIN: 163, FX_EQ_HIGH_FREQ: 164,
  FX_EQ_MIX: 165,
  FX_GRAPH: 100,
  OSC1_DETUNE: 4, OSC2_DETUNE: 10,
  OSC1_UNISON: 70, OSC2_UNISON: 72, OSC1_SPREAD: 71, OSC2_SPREAD: 73, MASTER_TUNE: 41,
  /** P6.5: 2x oversampling of the drive/filter path. */
  OVERSAMPLE: 166,
  /**
   * P9.4: the routing graph's node fields, one id per node (node 1 is id 101,
   * node 2 is 102, ...). Only the two this gate drives are named; the graph
   * parameter decoder is `base <= id < base + 6`.
   */
  FX_NODE_IN1: 101, FX_NODE_IN1_GAIN: 107, FX_NODE_TO_OUT: 125, FX_NODE_OUT_GAIN: 131,
  /** P9.2 transient shaper: on/off, the two signed amounts and the mix. */
  FX_TRANSIENT_ON: 179, FX_TRANSIENT_ATTACK: 180, FX_TRANSIENT_SUSTAIN: 181,
  FX_TRANSIENT_MIX: 182,
};

export const WAVE_TYPES = { lp: 0, hp: 1, bp: 2, notch: 3, sem: 6 };
export const WAVE = { sine: 0, triangle: 1, saw: 2, square: 3, pulse: 4, noise: 5, wavetable: 8, sample: 9 };

/**
 * How many `gs_note_on` calls this process has made. `gs_init` does not reset
 * the engine's phase counter, so the Nth note-on always starts on the same
 * phases -- which is what lets P9.6 pin one exact, known-bad phase.
 * Every `gs_note_on` a caller makes must go through `countNoteOn()`.
 */
let noteOns = 0;
/** The counter above, for the P9.6 phase walk's arithmetic. */
export function noteOnCount() {
  return noteOns;
}
/** Register one `gs_note_on` the caller made by hand. */
export function countNoteOn() {
  noteOns++;
}

export function engine(params, notes = []) {
  ex.gs_init(SR, 16);
  // gs_init keeps the parameter block (the worklet pushes it every block), so
  // release everything and let the tails die before the scenario starts —
  // otherwise the previous scenario's reverb tail pollutes the measurement.
  ex.gs_set_param(P.ENV_RELEASE, 0.005);
  ex.gs_set_param(P.FX_REVERB_ON, 0);
  ex.gs_set_param(P.FX_DELAY_ON, 0);
  ex.gs_all_notes_off();
  for (let i = 0; i < 80; i++) ex.gs_process(BLOCK);
  for (const [id, value] of params) {
    // A mistyped id would land on parameter 0 and quietly change the master
    // volume instead of failing, which is exactly the kind of gate bug that
    // hides for months.
    if (!Number.isInteger(id)) throw new Error(`bad parameter id in the gate: ${id}`);
    ex.gs_set_param(id, value);
  }
  for (const [note, velocity] of notes) {
    ex.gs_note_on(note, velocity);
    countNoteOn();
  }
  return ex;
}

export function render(blocks, skip = 20) {
  return renderWith(blocks, null, skip);
}

/**
 * `render`, plus a hook that runs before each block is processed.
 *
 * P13.2's `gs1.render` starts and stops notes at block boundaries, and the one
 * thing it must not do is grow a second copy of the block loop (the whole point
 * of `scripts/lib/` is that the gate and the tools share this code). `render`
 * is now this function with no hook, so the gate's buffers are copied by
 * exactly the statements it always used.
 *
 * @param {number} blocks how many 128-sample blocks to process
 * @param {((block: number) => void) | null} onBlock called with the block index
 * @param {number} skip blocks dropped from the returned buffer (settling)
 */
export function renderWith(blocks, onBlock, skip = 0) {
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const out = [];
  for (let b = 0; b < blocks; b++) {
    if (onBlock) onBlock(b);
    ex.gs_process(BLOCK);
    if (b < skip) continue;
    const lPtr = ex.gs_left_ptr() / 4;
    const rPtr = ex.gs_right_ptr() / 4;
    const heap = new Float32Array(ex.memory.buffer);
    left.set(heap.subarray(lPtr, lPtr + BLOCK));
    right.set(heap.subarray(rPtr, rPtr + BLOCK));
    out.push([left.slice(), right.slice()]);
  }
  return out;
}

/** The P6.3a lesson in one call: the default patch's ENV/LFO -> CUTOFF is live. */
export function clearModMatrix() {
  for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
}

/** 400 blocks = 1.07 s: the P6.2b report measured another 12 dB over 200. */
export const SETTLE_BLOCKS = 400;
/** The alias ruler's window: four whole seconds (a bin is then 0.25 Hz). */
export const FLOOR_SECONDS = 4;

/**
 * Everything a settled oscillator measurement depends on, pinned. `gs_init`
 * keeps the parameter block *and* the modulation matrix, so an unset pitch or
 * noise amount is the previous scenario's — which is how the hard-sync section
 * was silent the first few times it ran, and why P6.3a measured the default
 * patch's ENV -> CUTOFF instead of its filter.
 */
export const QUIET_PATCH = [
  [P.OSC1_ON, 1], [P.OSC1_LEVEL, 0.9], [P.OSC1_PITCH, 0], [P.OSC1_DETUNE, 0],
  [P.OSC1_UNISON, 1], [P.OSC1_SPREAD, 0], [P.OSC1_PW, 0.5], [P.OSC1_SYNC, 0],
  [P.OSC1_SUB, 0], [P.OSC1_SUB_LEVEL, 0],
  [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.OSC2_PITCH, 0], [P.OSC2_DETUNE, 0],
  [P.OSC2_UNISON, 1], [P.OSC2_SPREAD, 0], [P.OSC2_SUB, 0], [P.OSC2_SUB_LEVEL, 0],
  [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0], [P.MASTER_TUNE, 0],
  [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 18000], [P.FILTER_RES, 0.05],
  [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0],
  [P.FILTER_ROUTING, 0], [P.FILTER_MORPH, 0], [P.FILTER_BLEND, 0],
  [P.FILTER2_TYPE, 0], [P.FILTER2_CUTOFF, 20000], [P.FILTER2_RES, 0],
  [P.FILTER2_DRIVE, 0],
  [P.ENV_ATTACK, 0.01], [P.ENV_DECAY, 0.5], [P.ENV_SUSTAIN, 1], [P.ENV_RELEASE, 0.005],
  [P.LFO_ON, 0], [P.LFO2_ON, 0], [P.VOICE_MODE, 0], [P.OVERSAMPLE, 0],
  [P.MASTER_VOLUME, 1],
  [P.FX_GRAPH, 0], [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
  [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0], [P.FX_CRUSH_ON, 0],
  [P.FX_EQ_ON, 0], [P.FX_TRANSIENT_ON, 0],
];

/**
 * A settled, pinned, unmodulated four-second render of one note, left channel.
 */
export function renderFloor(extra, note) {
  engine([...QUIET_PATCH, ...extra], [[note, 1]]);
  clearModMatrix();
  const blocks = Math.round((FLOOR_SECONDS * SR) / BLOCK);
  const out = new Float64Array(blocks * BLOCK);
  const heap = new Float32Array(ex.memory.buffer);
  let w = 0;
  for (let b = 0; b < SETTLE_BLOCKS + blocks; b++) {
    ex.gs_process(BLOCK);
    if (b < SETTLE_BLOCKS) continue;
    const ptr = ex.gs_left_ptr() / 4;
    for (let i = 0; i < BLOCK; i++) out[w++] = heap[ptr + i];
  }
  return out;
}

/** Worst sample-to-sample step inside every 128-sample block, and where. */
export function blockSteps(frames) {
  const worst = [];
  for (let start = 0; start + BLOCK <= frames.length; start += BLOCK) {
    let step = 0;
    let at = start;
    for (let i = 1; i < BLOCK; i++) {
      const d = Math.abs(frames[start + i] - frames[start + i - 1]);
      if (d > step) {
        step = d;
        at = start + i;
      }
    }
    worst.push({ start, step, at });
  }
  return worst;
}

/** Worst sample-to-sample step in a rendered frame, alongside the frame's own
 * peak and the step as a fraction of it. The ratio is the scale-free number;
 * the absolute pair is printed so a failure is still readable. */
export function worstStepOf(frames) {
  let step = 0;
  let peak = 0;
  for (let i = 0; i < frames.length; i++) {
    const a = Math.abs(frames[i]);
    if (a > peak) peak = a;
    if (i > 0) {
      const d = Math.abs(frames[i] - frames[i - 1]);
      if (d > step) step = d;
    }
  }
  return { step, peak, ratio: step / Math.max(peak, 1e-30) };
}

/** The largest absolute sample in a frame. */
export function peakOf(samples) {
  return samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

/** RMS of a frame: the square root of the mean of the squares. */
export function rmsOf(samples) {
  return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
}

/** Bytes still free in the core's static arena (P13: `gs1.describe` reads it). */
export function arenaFreeBytes() {
  return ex.gs_arena_free_bytes();
}

/** Any stray allocation the core has flagged; 0 is the shipping contract. */
export function allocViolations() {
  return ex.gs_alloc_violations();
}

/** Hand a cycle to the core exactly as the worklet does. */
export function importWavetableCycle(cycle) {
  const capacity = ex.gs_wavetable_capacity();
  if (cycle.length > capacity) throw new Error(`cycle longer than ${capacity}`);
  const scratch = new Float32Array(ex.memory.buffer, ex.gs_wavetable_import_ptr(), capacity);
  scratch.set(cycle);
  return ex.gs_wavetable_import(cycle.length);
}

/** Hand a sample to the core exactly as the worklet's `sample` message does. */
export function importSample(samples, rate) {
  const capacity = ex.gs_sample_capacity();
  const scratch = new Float32Array(ex.memory.buffer, ex.gs_sample_import_ptr(), capacity);
  const count = Math.min(samples.length, capacity);
  scratch.set(samples.subarray(0, count));
  return ex.gs_sample_import(count, rate);
}

/** Hand an impulse response to the core exactly as the worklet does. */
export function importImpulseResponse(ir) {
  const capacity = ex.gs_ir_capacity();
  const scratch = new Float32Array(ex.memory.buffer, ex.gs_ir_import_ptr(), capacity);
  const count = Math.min(ir.length, capacity);
  scratch.set(ir.subarray(0, count));
  return ex.gs_ir_import(count);
}
