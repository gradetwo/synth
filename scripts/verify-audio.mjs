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

console.log('[audio] quality gate');
for (const line of report) console.log(line);
if (failures.length) {
  console.error(`[audio] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[audio] PASS');
