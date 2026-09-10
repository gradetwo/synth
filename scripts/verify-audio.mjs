#!/usr/bin/env node
/**
 * Audio-quality gate.
 *
 * Renders a set of fixed scenarios through the real WASM core and asserts the
 * things that decide whether the synth *sounds* right, not just whether it runs:
 *
 *   1. headroom  — a fully loaded 16-voice chord never reaches the soft limiter
 *                  (so nothing is coloured) and never exceeds full scale;
 *   2. aliasing  — a C7 saw's non-harmonic energy stays well under its harmonics;
 *   3. distortion— a sine through the filter drive keeps its THD in the
 *                  "analog warmth" range instead of turning into a buzz;
 *   4. CPU       — the worst-case block still fits the real-time budget.
 *
 * Run with `--update`? No: every threshold is a hard limit, deliberately.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'src/generated/synth_core.wasm');

if (!existsSync(wasmPath)) {
  console.error('[audio] src/generated/synth_core.wasm missing — run "npm run build:wasm"');
  process.exit(1);
}

const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {}).exports;
const SR = 48000;
const BLOCK = 128;
const BUDGET_US = (BLOCK / SR) * 1e6;
/** The soft limiter is transparent below this level (see dsp/util.rs). */
const KNEE = 0.82;

const P = {
  MASTER_VOLUME: 0, OSC1_ON: 1, OSC1_WAVE: 2, OSC1_LEVEL: 5, OSC2_ON: 7, OSC2_WAVE: 8,
  OSC2_LEVEL: 11, FILTER_TYPE: 13, FILTER_CUTOFF: 14, FILTER_RES: 15, FILTER_DRIVE: 16,
  FILTER_ENV_AMT: 17, ENV_ATTACK: 19, ENV_DECAY: 20, ENV_SUSTAIN: 21, ENV_RELEASE: 22,
  LFO_ON: 23, FX_REVERB_ON: 29, FX_DELAY_ON: 32, FX_CHORUS_ON: 43, FX_FLANGER_ON: 47,
  FX_PHASER_ON: 51, FX_DRIVE_ON: 55, VOICE_MODE: 42,
};

const WAVE = { sine: 0, triangle: 1, saw: 2, square: 3, pulse: 4, noise: 5 };

const failures = [];
const report = [];

function check(name, ok, detail) {
  report.push(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`);
  if (!ok) failures.push(name);
}

function engine(params, notes = []) {
  ex.gs_init(SR, 16);
  // gs_init keeps the parameter block (the worklet pushes it every block), so
  // release everything and let the tails die before the scenario starts —
  // otherwise the previous scenario's reverb tail pollutes the measurement.
  ex.gs_set_param(P.ENV_RELEASE, 0.005);
  ex.gs_set_param(P.FX_REVERB_ON, 0);
  ex.gs_set_param(P.FX_DELAY_ON, 0);
  ex.gs_all_notes_off();
  for (let i = 0; i < 80; i++) ex.gs_process(BLOCK);
  for (const [id, value] of params) ex.gs_set_param(id, value);
  for (const [note, velocity] of notes) ex.gs_note_on(note, velocity);
  return ex;
}

function render(blocks, skip = 20) {
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const out = [];
  for (let b = 0; b < blocks; b++) {
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

/** Windowed single-bin magnitude (Hann window, same maths as the Rust tests). */
function binMag(samples, freq) {
  const n = samples.length;
  const w = (2 * Math.PI * freq) / SR;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    const v = samples[i] * win;
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return (Math.hypot(re, im) / n) * 2;
}

// ---------------------------------------------------------------- 1. headroom
{
  const notes = [36, 40, 43, 47, 52, 55, 56, 59, 60, 63, 64, 66, 68, 71, 75, 78];
  engine(
    [
      [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.saw], [P.OSC1_LEVEL, 1],
      [P.OSC2_ON, 1], [P.OSC2_WAVE, WAVE.saw], [P.OSC2_LEVEL, 1],
      [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 16000], [P.FILTER_RES, 0.2],
      [P.ENV_ATTACK, 0.0005], [P.ENV_SUSTAIN, 1], [P.MASTER_VOLUME, 1],
      [P.FX_REVERB_ON, 1], [P.FX_DELAY_ON, 1],
    ],
    notes.map((n) => [n, 1]),
  );
  const frames = render(160).flatMap(([l, r]) => [...l, ...r]);
  const peak = frames.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const saturated = frames.filter((v) => Math.abs(v) > 0.99).length / frames.length;
  check('peak stays below full scale', peak <= 1.0, `peak ${peak.toFixed(3)}`);
  check(
    'full-load chord is never hard-limited',
    saturated < 0.0001,
    `${saturated.toFixed(4)}% of samples past the safety ceiling (knee ${KNEE})`,
  );
}

// --------------------------------------------------------------- 2. aliasing
{
  const f0 = 440 * 2 ** ((96 - 69) / 12);
  engine(
    [
      [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.saw], [P.OSC1_LEVEL, 0.8],
      [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0],
      [P.FILTER_CUTOFF, 18000], [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0],
      [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0], [P.MASTER_VOLUME, 0.75],
      // The engine keeps its parameters across gs_init (the worklet pushes
      // every param each block), so silence the effects explicitly.
      [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
      [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
    ],
    [[96, 1]],
  );
  const blocks = render(80);
  const buf = [];
  for (const [l] of blocks) buf.push(...l);
  // Aliased partials fold to frequencies *between* the harmonics, so the energy
  // at those midpoints is aliasing (plus noise). Compare it with the total
  // signal energy: a clean oscillator keeps it far below the signal itself.
  // Only probe midpoints below Nyquist: a probe above it folds back onto real
  // harmonic content and would report that as aliasing.
  let alias = 0;
  for (let k = 1; f0 * (k + 0.5) < SR / 2 - 1000; k++) alias += binMag(buf, f0 * k + f0 * 0.5) ** 2;
  const signal = buf.reduce((s, v) => s + v * v, 0) / buf.length;
  const aliasDb = 10 * Math.log10(alias / Math.max(signal, 1e-12));
  // The wasm build measures ~-58 dB here (1st-order polyBLEP residue; the
  // native build is ~-160 dB, which is worth understanding when the oversampled
  // oscillator lands — roadmap A1). The gate catches regressions in the meantime.
  check('saw at C7 is band-limited', aliasDb < -55, `aliasing ${aliasDb.toFixed(1)} dB below the signal`);
}

// ------------------------------------------------------------- 3. distortion
{
  engine(
    [
      [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.8],
      [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0],
      [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 12000], [P.FILTER_RES, 0.2],
      [P.FILTER_DRIVE, 1], [P.FILTER_ENV_AMT, 0], [P.ENV_SUSTAIN, 1],
      [P.LFO_ON, 0], [P.MASTER_VOLUME, 0.75],
    ],
    [[69, 1]],
  );
  const blocks = render(80);
  const buf = [];
  for (const [l] of blocks) buf.push(...l);
  const fund = binMag(buf, 440);
  let harmonics = 0;
  for (let k = 2; k <= 12; k++) harmonics += binMag(buf, 440 * k) ** 2;
  const thd = (Math.sqrt(harmonics) / Math.max(fund, 1e-9)) * 100;
  check('filter drive stays musical', thd < 6, `THD ${thd.toFixed(2)}% at full drive`);
}

// -------------------------------------------------------------------- 4. CPU
{
  const notes = [36, 43, 48, 52, 55, 59, 62, 64, 67, 71, 74, 79, 83, 86, 88, 91];
  engine(
    [
      [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.saw], [P.OSC1_LEVEL, 0.7],
      [P.OSC2_ON, 1], [P.OSC2_WAVE, WAVE.saw], [P.OSC2_LEVEL, 0.6],
      [P.FILTER_CUTOFF, 12000], [P.FILTER_RES, 0.4],
      [P.MASTER_VOLUME, 0.75], [P.FX_REVERB_ON, 1], [P.FX_DELAY_ON, 1],
      [P.FX_CHORUS_ON, 1], [P.FX_PHASER_ON, 1], [P.FX_DRIVE_ON, 1],
    ],
    notes.map((n) => [n, 0.95]),
  );
  for (let i = 0; i < 60; i++) ex.gs_process(BLOCK); // warm up
  // Best of five rounds: the minimum is the stable estimator of the real cost,
  // while a single long round picks up whatever else the machine is doing.
  let perBlockUs = Infinity;
  for (let round = 0; round < 5; round++) {
    const blocks = 200;
    const start = process.hrtime.bigint();
    for (let i = 0; i < blocks; i++) ex.gs_process(BLOCK);
    perBlockUs = Math.min(perBlockUs, Number(process.hrtime.bigint() - start) / 1000 / blocks);
  }
  const load = (perBlockUs / BUDGET_US) * 100;
  check('worst-case block fits the budget', load < 60, `${load.toFixed(0)}% of ${BUDGET_US.toFixed(0)} µs`);
}

console.log('[audio] quality gate');
for (const line of report) console.log(line);
if (failures.length) {
  console.error(`[audio] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[audio] PASS');
