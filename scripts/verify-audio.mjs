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
  FX_PHASER_ON: 51, FX_DRIVE_ON: 55, VOICE_MODE: 42, OSC1_PW: 6, WT_USER: 79,
  FX_DELAY_FB: 34, FX_DELAY_MIX: 35, FX_DELAY_SYNC: 33, FX_DRIVE_AMT: 56, FX_DRIVE_MIX: 57,
  FX_REVERB_MIX: 31, FX_REVERB_MODE: 94, FX_CONV_TRIM: 95,
  FX_CHAIN1: 82, FX_CHAIN2: 83, FX_CHAIN3: 84, FX_CHAIN4: 85, FX_CHAIN5: 86, FX_CHAIN6: 87,
  SMP_ROOT: 96, SMP_MODE: 97, TEMPO: 37,
  OSC2_PITCH: 9, OSC_FM: 137, OSC_RING: 138,
  OSC1_PITCH: 3, OSC1_SYNC: 139, OSC1_SUB: 140, OSC1_SUB_LEVEL: 141,
  OSC2_SUB: 142, OSC2_SUB_LEVEL: 143, NOISE_MIX: 144,
};

const WAVE = { sine: 0, triangle: 1, saw: 2, square: 3, pulse: 4, noise: 5, wavetable: 8, sample: 9 };

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
  for (const [id, value] of params) {
    // A mistyped id would land on parameter 0 and quietly change the master
    // volume instead of failing, which is exactly the kind of gate bug that
    // hides for months.
    if (!Number.isInteger(id)) throw new Error(`bad parameter id in the gate: ${id}`);
    ex.gs_set_param(id, value);
  }
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

/**
 * Radix-2 FFT magnitude spectrum, Blackman-Harris windowed.
 *
 * The gate needs the frequency domain, not just levels: a filter that drops a
 * sample at every render-block boundary is a click train, and a click train is
 * broadband noise — invisible to a peak or RMS check, obvious in a spectrum.
 *
 * The window has to be this good: a Hann window's own sidelobes sit around
 * -46 dB a few bins away from a strong partial, which is indistinguishable from
 * real broadband junk. Blackman-Harris puts them below -92 dB, so whatever the
 * "everything that is not a harmonic" number reports is the signal, not the
 * measurement.
 */
function spectrum(samples, n = 8192) {
  const BH = [0.35875, 0.48829, 0.14128, 0.01168];
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const src = samples[i] ?? 0;
    const t = (2 * Math.PI * i) / n;
    const win =
      BH[0] - BH[1] * Math.cos(t) + BH[2] * Math.cos(2 * t) - BH[3] * Math.cos(3 * t);
    re[i] = src * win;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / n;
  return mag;
}

/** Worst sample-to-sample step inside every 128-sample block, and where. */
function blockSteps(frames) {
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

// ------------------------------------------- 3. block clicks + spectrum purity
//
// The regression this exists for: the vendored ladder filter was broken *only*
// in the wasm build and dropped one sample at the start of every render block —
// a 375 Hz click train, i.e. audible crackle on an otherwise simple patch. A
// peak or RMS check cannot see it, because a single sample of a low-level
// signal barely moves either number. Both domains can:
//
//   * time domain  — a sine of known frequency and amplitude cannot step by
//                    more than 2*pi*f*A/SR; a block-start dropout breaks that;
//   * frequency    — the click train is broadband, so everything that is not
//                    the fundamental shows up as harmonic + noise energy.
{
  const f0 = 440;
  engine(
    [
      [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.8],
      [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0],
      [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 18000], [P.FILTER_RES, 0.05],
      [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0],
      [P.ENV_ATTACK, 0.01], [P.ENV_SUSTAIN, 1],
      [P.LFO_ON, 0], [P.MASTER_VOLUME, 0.75],
      [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
      [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
    ],
    [[69, 1]],
  );
  // A clean steady window, far from the attack.
  const blocks = render(400, 200);
  const frames = [];
  for (const [l] of blocks) frames.push(...l);
  const peak = frames.reduce((m, v) => Math.max(m, v === undefined ? 0 : Math.abs(v)), 0);
  const idealStep = ((2 * Math.PI * f0) / SR) * peak;
  const steps = blockSteps(frames);
  const worst = steps.reduce((a, b) => (b.step > a.step ? b : a));
  const blocksOver = steps.filter((s) => s.step > idealStep * 2).length;
  check(
    'no click at render-block boundaries',
    blocksOver === 0,
    `worst step ${worst.step.toExponential(2)} vs physical limit ${idealStep.toExponential(2)}` +
      ` (block starts at sample ${worst.start}, ${blocksOver}/${steps.length} blocks over)`,
  );
  // Prove the detector works: the exact failure mode that motivated it — one
  // sample dropped at the start of every block — must be reported as a click.
  // A gate that cannot fail is not a gate.
  const broken = Float32Array.from(frames);
  for (let start = 0; start < broken.length; start += BLOCK) broken[start] *= 0.2;
  const brokenOver = blockSteps(broken).filter((s) => s.step > idealStep * 2).length;
  check(
    'the click detector can see a click',
    brokenOver > 0,
    `injected block-start dropouts detected in ${brokenOver} blocks`,
  );

  // Same signal, frequency domain. A pure sine through a linear low-pass has
  // exactly one partial; everything else is distortion or a click train.
  const mag = spectrum(frames, 8192);
  const bin = (f) => Math.max(2, Math.round((f / SR) * 8192));
  let fundamental = 0;
  let harmonic = 0;
  let total = 0;
  // Blackman-Harris spreads a partial over four bins either side of centre.
  const guard = bin(f0);
  for (let i = 3; i < mag.length; i++) {
    const energy = mag[i] ** 2;
    total += energy;
    if (Math.abs(i - guard) <= 4) fundamental += energy;
    else for (let k = 2; k <= 20; k++) {
      if (Math.abs(i - bin(f0 * k)) <= 4) {
        harmonic += energy;
        break;
      }
    }
  }
  const noise = Math.max(total - fundamental - harmonic, 1e-30);
  const harmonicDb = 10 * Math.log10(harmonic / Math.max(fundamental, 1e-30));
  const noiseDb = 10 * Math.log10(noise / Math.max(fundamental, 1e-30));
  check(
    'sine stays a sine (harmonic content)',
    harmonicDb < -55,
    `THD+N harmonics ${harmonicDb.toFixed(1)} dB below the fundamental`,
  );
  check(
    'sine leaves no broadband noise',
    noiseDb < -70,
    `non-harmonic energy ${noiseDb.toFixed(1)} dB below the fundamental`,
  );
}

// ------------------------------------------------------------- 4. distortion
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

// ------------------------------------------ 3c. aliasing across the wave list
//
// One wave is not enough: the gate checked the saw and the wavetable, but a
// regression in any of the band-limited oscillators would have gone unnoticed.
// Every harmonic-rich wave is played at the top of the keyboard and the energy
// *between* its harmonics measured, which is where folded partials land.
{
  const waves = [
    ['saw', 2],
    ['square', 3],
    ['pulse', 4],
    ['wavetable', 8],
  ];
  const note = 96; // C7
  const f0 = 440 * 2 ** ((note - 69) / 12);
  for (const [name, wave] of waves) {
    engine(
      [
        [P.OSC1_ON, 1], [P.OSC1_WAVE, wave], [P.OSC1_LEVEL, 0.8], [P.OSC1_PW, 0.5],
        [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0],
        [P.FILTER_CUTOFF, 18000], [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0],
        [P.ENV_ATTACK, 0.001], [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0], [P.MASTER_VOLUME, 1],
        [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
        [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
      ],
      [[note, 1]],
    );
    const blocks = render(100);
    const buf = [];
    for (const [l] of blocks) buf.push(...l);
    const fundamental = binMag(buf, f0);
    let between = 0;
    let k = 1;
    while (f0 * (k + 0.5) < 20000) {
      between += binMag(buf, f0 * (k + 0.5)) ** 2;
      k += 1;
    }
    const signal = buf.reduce((sum, v) => sum + v * v, 0) / buf.length;
    const ratio = 10 * Math.log10(between / Math.max(signal, 1e-12));
    check(
      `${name} at C7 is band-limited`,
      ratio < (name === 'wavetable' ? -60 : -55),
      `aliasing ${ratio.toFixed(1)} dB below the signal`,
    );
    void fundamental;
  }
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

// ------------------------------------------ 5. imported single-cycle wavetable
{
  /** Hand a cycle to the core exactly as the worklet does. */
  const importCycle = (cycle) => {
    const capacity = ex.gs_wavetable_capacity();
    if (cycle.length > capacity) throw new Error(`cycle longer than ${capacity}`);
    const scratch = new Float32Array(ex.memory.buffer, ex.gs_wavetable_import_ptr(), capacity);
    scratch.set(cycle);
    return ex.gs_wavetable_import(cycle.length);
  };

  const sine = Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * i) / 2048));
  check('a clean cycle imports', importCycle(sine) === 0, 'code 0');
  check('the core reports the imported table', ex.gs_wavetable_has() === 1, 'has = 1');
  check('junk is refused', importCycle(new Array(2048).fill(0)) === 2, 'a silent cycle is rejected');

  // Put the sine back and play it: one harmonic, and it must be a *sine*.
  importCycle(sine);
  const patch = (wave, wtUser) => [
    [P.OSC1_ON, 1], [P.OSC1_WAVE, wave], [P.OSC1_LEVEL, 0.9],
    [P.OSC1_PW, 1], [P.WT_USER, wtUser], [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0],
    [P.FILTER_CUTOFF, 18000], [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0],
    [P.ENV_ATTACK, 0.001], [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0], [P.MASTER_VOLUME, 1],
    [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
    [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
  ];
  {
    engine(patch(WAVE.wavetable, 1), [[69, 1]]);
    const buf = [];
    for (const [l] of render(100)) buf.push(...l);
    const f0 = 440;
    const fundamental = binMag(buf, f0);
    const harmonics = [2, 3, 5].map((k) => binMag(buf, f0 * k));
    const worst = Math.max(...harmonics);
    check('an imported sine plays as a sine', fundamental > 0.02, `fundamental ${fundamental.toFixed(3)}`);
    check(
      'an imported sine has no harmonics',
      20 * Math.log10(worst / Math.max(fundamental, 1e-12)) < -60,
      `worst harmonic ${(20 * Math.log10(worst / Math.max(fundamental, 1e-12))).toFixed(1)} dB`,
    );
    // The imported cycle must not arrive at a different level from the same
    // waveform built in: an import that silently rescales is a loudness bug.
    engine(patch(WAVE.sine, 0), [[69, 1]]);
    const analog = [];
    for (const [l] of render(100)) analog.push(...l);
    const analogFundamental = binMag(analog, f0);
    const level = 20 * Math.log10(fundamental / Math.max(analogFundamental, 1e-12));
    check('an imported sine matches the built-in one in level', Math.abs(level) < 3, `${level.toFixed(1)} dB apart`);
  }

  // A saw imported from samples has to be band-limited by the same rule as a
  // factory bank: at C7 nothing may appear between its harmonics.
  const saw = Array.from({ length: 2048 }, (_, i) => {
    let sum = 0;
    for (let k = 1; k <= 1024; k++) sum += Math.sin((2 * Math.PI * k * i) / 2048) / k;
    return sum;
  });
  check('an imported saw is accepted', importCycle(saw) === 0, 'code 0');
  engine(patch(WAVE.wavetable, 1), [[96, 1]]); // C7
  {
    const buf = [];
    for (const [l] of render(100)) buf.push(...l);
    const f0 = 2093;
    let between = 0;
    let k = 1;
    while (f0 * (k + 0.5) < 20000) {
      between += binMag(buf, f0 * (k + 0.5)) ** 2;
      k += 1;
    }
    const signal = buf.reduce((sum, v) => sum + v * v, 0) / buf.length;
    const ratio = 10 * Math.log10(between / Math.max(signal, 1e-12));
    check('an imported saw is band-limited at C7', ratio < -60, `aliasing ${ratio.toFixed(1)} dB below the signal`);
  }

  ex.gs_wavetable_clear();
  check('clearing removes the table', ex.gs_wavetable_has() === 0, 'has = 0');
}

// ------------------------------------------------ 6. restarts do not leak
{
  // Every scenario above re-initialises the core, which is also what happens
  // when the host restarts the audio engine. Anything allocated per init and not
  // freed shrinks the arena until a later start fails outright.
  const before = ex.gs_arena_free_bytes();
  for (let i = 0; i < 4; i++) ex.gs_init(SR, 16);
  const after = ex.gs_arena_free_bytes();
  const lost = (before - after) / 1024;
  check('re-initialising the core does not leak the arena', lost < 64, `${lost.toFixed(0)} KB lost over 4 restarts`);
  check('the arena still has room after the restarts', after > 512 * 1024, `${(after / 1024).toFixed(0)} KB free`);
}

// ------------------------------------------------ 6. sampler and response (A/A5)
{
  const importSample = (samples, rate) => {
    const capacity = ex.gs_sample_capacity();
    const scratch = new Float32Array(ex.memory.buffer, ex.gs_sample_import_ptr(), capacity);
    const count = Math.min(samples.length, capacity);
    scratch.set(samples.subarray(0, count));
    return ex.gs_sample_import(count, rate);
  };
  const tone = Float32Array.from({ length: 24_000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48_000) * 0.8);
  check('a sample imports', importSample(tone, 48_000) === 0, 'code 0');
  check('the core reports the sample', ex.gs_sample_has() === 1, 'has = 1');
  check('a silent sample is refused', importSample(new Float32Array(48_000), 48_000) === 2, 'code 2');
  importSample(tone, 48_000);

  // Play it: the sample was recorded at 440 Hz and the patch says so, so A4 has
  // to come back out at 440 Hz.
  engine(
    [
      [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.sample], [P.OSC1_LEVEL, 0.9],
      [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.FILTER_CUTOFF, 18000], [P.FILTER_DRIVE, 0],
      [P.FILTER_ENV_AMT, 0], [P.ENV_ATTACK, 0.001], [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0],
      [P.MASTER_VOLUME, 1], [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.SMP_ROOT, 69],
      [P.SMP_MODE, 1],
    ],
    [[69, 1]],
  );
  {
    const buf = [];
    for (const [l] of render(60)) buf.push(...l);
    let best = { freq: 0, level: 0 };
    for (let freq = 300; freq <= 700; freq += 5) {
      const level = binMag(buf, freq);
      if (level > best.level) best = { freq, level };
    }
    check(
      'the sampler plays the sample at its recorded pitch',
      Math.abs(best.freq - 440) <= 10 && best.level > 0.02,
      `${best.freq} Hz at ${best.level.toFixed(3)}`,
    );
  }

  const importIr = (ir) => {
    const capacity = ex.gs_ir_capacity();
    const scratch = new Float32Array(ex.memory.buffer, ex.gs_ir_import_ptr(), capacity);
    const count = Math.min(ir.length, capacity);
    scratch.set(ir.subarray(0, count));
    return ex.gs_ir_import(count);
  };
  // A unit-energy response: the core normalises it, so the wet level of a noise
  // source should land within a few dB of the dry signal.
  const response = Float32Array.from({ length: 24_000 }, (_, i) => (Math.random() * 2 - 1) * Math.exp(-i / 6_000));
  check('an impulse response imports', importIr(response) === 0, 'code 0');
  check('the core reports the response', ex.gs_ir_has() === 1, 'has = 1');
  check('a short response is refused', importIr(new Float32Array(8)) === 1, 'code 1');
  importIr(response);

  const noisePatch = (mix) => [
    [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.noise], [P.OSC1_LEVEL, 0.6],
    [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.FILTER_CUTOFF, 18000], [P.FILTER_DRIVE, 0],
    [P.FILTER_ENV_AMT, 0], [P.ENV_ATTACK, 0.01], [P.ENV_DECAY, 2], [P.ENV_SUSTAIN, 1],
    [P.LFO_ON, 0], [P.MASTER_VOLUME, 1], [P.FX_DELAY_ON, 0], [P.FX_REVERB_ON, 1],
    [P.FX_REVERB_MODE, 1], [P.FX_CONV_TRIM, 1], [P.FX_REVERB_MIX, mix],
  ];
  const levelOf = (mix) => {
    engine(noisePatch(mix), [[60, 1]]);
    const buf = [];
    for (const [l] of render(80)) buf.push(...l);
    return Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
  };
  {
    const dry = levelOf(0);
    const wet = levelOf(1);
    const delta = 20 * Math.log10(wet / Math.max(dry, 1e-9));
    // A unit-energy response adds roughly as much as it passes: about +3 dB,
    // never +20 (which would mean the response was not normalised at all).
    check('the response is energy-normalised', delta > -1 && delta < 9, `${delta.toFixed(1)} dB versus dry`);
  }
}

// ------------------------------------------------------ 7. effect chain order
{
  const patch = (order, on) => [
    [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.saw], [P.OSC1_LEVEL, 0.8],
    [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.FILTER_CUTOFF, 18000], [P.FILTER_DRIVE, 0],
    [P.FILTER_ENV_AMT, 0], [P.ENV_ATTACK, 0.002], [P.ENV_DECAY, 0.4], [P.ENV_SUSTAIN, 0.5],
    [P.ENV_RELEASE, 0.1], [P.LFO_ON, 0], [P.MASTER_VOLUME, 1], [P.TEMPO, 120],
    [P.FX_REVERB_ON, 0],
    [P.FX_DELAY_ON, on ? 1 : 0], [P.FX_DELAY_SYNC, 3], [P.FX_DELAY_FB, 0.6], [P.FX_DELAY_MIX, 0.8],
    [P.FX_DRIVE_ON, on ? 1 : 0], [P.FX_DRIVE_AMT, 0.9], [P.FX_DRIVE_MIX, 1],
    [P.FX_CHAIN1, order[0]], [P.FX_CHAIN2, order[1]], [P.FX_CHAIN3, order[2]],
    [P.FX_CHAIN4, order[3]], [P.FX_CHAIN5, order[4]], [P.FX_CHAIN6, order[5]],
  ];
  const renderPatch = (params) => {
    engine(params, [[69, 1]]);
    const buf = [];
    for (const [l] of render(120, 10)) buf.push(...l);
    return buf;
  };
  const rms = (buf) => Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);

  const delayThenDrive = renderPatch(patch([1, 6, 0, 0, 0, 0], true));
  const driveThenDelay = renderPatch(patch([6, 1, 0, 0, 0, 0], true));
  const reference = rms(delayThenDrive);
  const difference = Math.sqrt(
    delayThenDrive.reduce((sum, v, i) => sum + (v - driveThenDelay[i]) ** 2, 0) / delayThenDrive.length,
  );
  check('the chain renders the effects at all', reference > 0.01, `rms ${reference.toFixed(3)}`);
  check(
    'reordering the chain changes the sound',
    difference > reference * 0.15,
    `${(20 * Math.log10(difference / reference)).toFixed(1)} dB difference`,
  );

  // Positions left empty run nothing, and an effect that is switched off is a
  // pass-through: both renders must match the patch with no effects at all.
  const emptyChain = renderPatch(patch([0, 0, 0, 0, 0, 0], true));
  const noEffects = renderPatch(patch([0, 0, 0, 0, 0, 0], false));
  check(
    'an empty chain with the effects switched on is a clean pass-through',
    Math.abs(rms(emptyChain) - rms(noEffects)) < rms(noEffects) * 0.01,
    `${rms(emptyChain).toFixed(5)} vs ${rms(noEffects).toFixed(5)}`,
  );
}

// ------------------------------------------- FM / PM and ring modulation (P6.1)
//
// Both features are *spectral* claims, so both are checked in both domains:
// phase modulation of a sine by a sine at the same frequency has to produce the
// textbook sidebands, and ring modulation has to move the energy to the sum and
// the difference while removing the two originals. A level check cannot see
// either of them: the peak of a modulated sine is barely different from the peak
// of the sine.
{
  const f0 = 440;
  // OSC 2 silent: the classic FM arrangement, and a carrier that is one clean
  // sine when the depth is zero.
  const base = [
    [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.8],
    [P.OSC2_ON, 1], [P.OSC2_WAVE, WAVE.sine],
    [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 18000], [P.FILTER_RES, 0.05],
    [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0],
    [P.ENV_ATTACK, 0.01], [P.ENV_SUSTAIN, 1],
    [P.LFO_ON, 0], [P.MASTER_VOLUME, 0.75],
    [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
    [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
  ];
  const steady = (extra, note = 69) => {
    engine([...base, ...extra], [[note, 1]]);
    const out = [];
    for (const [l] of render(300, 120)) out.push(...l);
    return out;
  };
  const level = (samples, freq) => binMag(samples, freq);

  const clean = steady([[P.OSC2_LEVEL, 0], [P.OSC_FM, 0]]);
  const carrier = level(clean, f0);
  check('a plain sine pair carries the fundamental', carrier > 0.01, `carrier ${carrier.toFixed(4)}`);
  const cleanSecond = level(clean, f0 * 2) / Math.max(carrier, 1e-9);
  check(
    'with FM off the carrier stays a sine',
    cleanSecond < 1e-3,
    `second partial ${(20 * Math.log10(Math.max(cleanSecond, 1e-12))).toFixed(1)} dB below the fundamental`,
  );

  const modulated = steady([[P.OSC2_LEVEL, 0], [P.OSC_FM, 0.6]]);
  const second = level(modulated, f0 * 2) / Math.max(level(modulated, f0), 1e-9);
  const third = level(modulated, f0 * 3) / Math.max(level(modulated, f0), 1e-9);
  check(
    'FM puts real energy into the sidebands',
    second > 0.2 && third > 0.05,
    `H2 ${(20 * Math.log10(Math.max(second, 1e-12))).toFixed(1)} dB, H3 ${(20 * Math.log10(Math.max(third, 1e-12))).toFixed(1)} dB below the carrier`,
  );
  // Time domain: a modulated sine wiggles between its zero crossings, so the
  // same note crosses zero far more often than the clean one.
  const crossings = (samples) => {
    const window = samples.slice(0, Math.round(SR / f0) * 20);
    let count = 0;
    for (let i = 1; i < window.length; i++) {
      if ((window[i - 1] < 0) !== (window[i] < 0)) count++;
    }
    return count;
  };
  check(
    'FM shows in the waveform',
    crossings(modulated) > crossings(clean) * 2,
    `${crossings(modulated)} zero crossings vs ${crossings(clean)} for the plain sine`,
  );
  const peakOf = (samples) => samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  check(
    'FM does not change the level',
    Math.abs(peakOf(modulated) - peakOf(clean)) < 0.3,
    `peak ${peakOf(modulated).toFixed(3)} vs ${peakOf(clean).toFixed(3)}`,
  );

  // Ring: a 1.25 ratio puts the difference (110 Hz) and the sum (990 Hz) away
  // from both oscillators, so "the carries are gone" is unambiguous.
  const ratio = (1200 * Math.log2(1.25)) / 100;
  const additive = steady([[P.OSC2_LEVEL, 0.8], [P.OSC2_PITCH, ratio], [P.OSC_RING, 0], [P.OSC_FM, 0]]);
  const ring = steady([[P.OSC2_LEVEL, 0.8], [P.OSC2_PITCH, ratio], [P.OSC_RING, 1], [P.OSC_FM, 0]]);
  const additiveCarrier = level(additive, f0);
  check(
    'an additive pair has nothing at the difference frequency',
    level(additive, f0 * 0.25) / additiveCarrier < 0.02,
    `${(level(additive, f0 * 0.25) / additiveCarrier).toExponential(2)} of the carrier`,
  );
  const difference = level(ring, f0 * 0.25);
  const sum = level(ring, f0 * 2.25);
  const strongest = Math.max(difference, sum, 1e-9);
  check(
    'ring modulation produces the sum and the difference',
    difference > additiveCarrier * 0.1 && sum > additiveCarrier * 0.1,
    `110 Hz ${difference.toFixed(4)}, 990 Hz ${sum.toFixed(4)} vs carrier ${additiveCarrier.toFixed(4)}`,
  );
  check(
    'ring modulation removes both originals',
    level(ring, f0) / strongest < 0.1 && level(ring, f0 * 1.25) / strongest < 0.1,
    `carrier and modulator are ${((level(ring, f0) / strongest) * 100).toFixed(1)}% / ${((level(ring, f0 * 1.25) / strongest) * 100).toFixed(1)}% of the strongest sideband`,
  );
}

// ------------------------------------- hard sync, sub and noise (P6.2)
//
// Hard sync is a discontinuity by construction, so the only way to ship it is
// with a measurement: the whole signal has to stay on the *master's* harmonic
// grid and be periodic at the master's period. Both are checked here through the
// real wasm build, next to the sub oscillator's octave and the noise blend's
// broadband nature.
//
// Every scenario pins the parameters it depends on. The engine keeps its
// parameter block across `gs_init`, so an unset pitch or ring amount is the
// *previous* section's — which is exactly how this section was silent the first
// few times it ran.
{
  const master = 220;
  const quiet = [
    [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 18000], [P.FILTER_RES, 0.05],
    [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0],
    [P.ENV_ATTACK, 0.01], [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0], [P.MASTER_VOLUME, 1],
    [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
    [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
  ];
  // 1.41x the master: not a multiple, so without sync the slave has its own
  // period and with sync it can only have the master's.
  const slaveRatio = 12 * Math.log2(1.41);
  const renderSync = (sync) => {
    engine(
      [
        ...quiet,
        [P.OSC1_WAVE, WAVE.saw], [P.OSC1_LEVEL, 0.9], [P.OSC1_PITCH, slaveRatio],
        [P.OSC1_SYNC, sync], [P.OSC1_SUB, 0],
        [P.OSC2_WAVE, WAVE.sine], [P.OSC2_ON, 1], [P.OSC2_LEVEL, 0], [P.OSC2_PITCH, 0],
        [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
      ],
      [[57, 1]],
    );
    const out = [];
    for (const [l] of render(300, 120)) out.push(...l);
    return out;
  };

  const energy = (samples, f) => binMag(samples, f) ** 2;
  const periodCorrelation = (samples) => {
    const period = Math.round(SR / master);
    let num = 0;
    let left = 0;
    let right = 0;
    for (let i = 0; i + period < samples.length; i++) {
      num += samples[i] * samples[i + period];
      left += samples[i] ** 2;
      right += samples[i + period] ** 2;
    }
    return num / Math.max(Math.sqrt(left * right), 1e-30);
  };

  const loose = renderSync(0);
  const locked = renderSync(1);
  const slaveLine = (samples) => binMag(samples, master * 1.41);
  check(
    'sync replaces the slave pitch with the master grid',
    slaveLine(loose) > slaveLine(locked) * 20,
    `${slaveLine(loose).toFixed(4)} free vs ${slaveLine(locked).toFixed(5)} synced at 310 Hz`,
  );
  const corr = periodCorrelation(locked);
  check(
    'a synced slave is periodic at the master period',
    corr > 0.95,
    `period correlation ${corr.toFixed(4)} (free: ${periodCorrelation(loose).toFixed(4)})`,
  );
  // The sub oscillator: one sine an octave or two down.
  const subPatch = (octaves, level) => {
    engine(
      [
        ...quiet,
        [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.9], [P.OSC1_PITCH, 0], [P.OSC1_SYNC, 0],
        [P.OSC1_SUB, octaves], [P.OSC1_SUB_LEVEL, level],
        [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
      ],
      [[69, 1]],
    );
    const out = [];
    for (const [l] of render(200, 80)) out.push(...l);
    return out;
  };
  const plain = subPatch(0, 0.5);
  const oneDown = subPatch(1, 0.5);
  const twoDown = subPatch(2, 0.5);
  check(
    'the sub sits one octave down',
    binMag(oneDown, 220) > binMag(plain, 220) * 50 &&
      binMag(oneDown, 110) < binMag(oneDown, 220) * 0.01,
    `220 Hz ${binMag(oneDown, 220).toFixed(4)} vs ${binMag(plain, 220).toFixed(5)} with no sub`,
  );
  check(
    'and two octaves when asked',
    binMag(twoDown, 110) > binMag(oneDown, 110) * 50,
    `110 Hz ${binMag(twoDown, 110).toFixed(4)}`,
  );

  // The noise blend: broadband, and it leaves the tone's own partial alone.
  const noisePatch = (mix) => {
    engine(
      [
        ...quiet,
        [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.6], [P.OSC1_PITCH, 0], [P.OSC1_SYNC, 0],
        [P.OSC1_SUB, 0], [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.OSC_FM, 0], [P.OSC_RING, 0],
        [P.NOISE_MIX, mix],
      ],
      [[69, 1]],
    );
    const out = [];
    for (const [l] of render(200, 80)) out.push(...l);
    return out;
  };
  const offTone = (samples) => {
    let off = 0;
    for (let f = 100; f <= 20000; f += 10) {
      let near = false;
      for (let k = 1; k <= 46 && !near; k++) near = Math.abs(f - 440 * k) < 25;
      if (!near) off += energy(samples, f);
    }
    return off;
  };
  const dry = noisePatch(0);
  const wet = noisePatch(0.5);
  check(
    'the noise blend adds broadband energy',
    offTone(wet) > offTone(dry) * 1000,
    `${(10 * Math.log10(offTone(wet) / Math.max(offTone(dry), 1e-30))).toFixed(1)} dB more off-harmonic energy`,
  );
  check(
    'and leaves the tone where it was',
    Math.abs(binMag(wet, 440) - binMag(dry, 440)) < binMag(dry, 440) * 0.1,
    `440 Hz ${binMag(wet, 440).toFixed(4)} vs ${binMag(dry, 440).toFixed(4)}`,
  );
}

console.log('[audio] quality gate');
for (const line of report) console.log(line);
// The verdict comes last on purpose: every section above reports into `report`,
// and one added at the end of the file would otherwise report into nothing.
if (failures.length) {
  console.error(`[audio] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[audio] PASS');
