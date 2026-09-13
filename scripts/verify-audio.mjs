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
  FILTER_ENV_AMT: 17, FILTER_KBD: 18, ENV_ATTACK: 19, ENV_DECAY: 20, ENV_SUSTAIN: 21, ENV_RELEASE: 22,
  LFO_ON: 23, LFO2_ON: 62, FX_REVERB_ON: 29, FX_DELAY_ON: 32, FX_CHORUS_ON: 43, FX_FLANGER_ON: 47,
  FX_PHASER_ON: 51, FX_DRIVE_ON: 55, VOICE_MODE: 42, OSC1_PW: 6, WT_USER: 79,
  FX_DELAY_FB: 34, FX_DELAY_MIX: 35, FX_DELAY_SYNC: 33, FX_DRIVE_AMT: 56, FX_DRIVE_MIX: 57,
  FX_REVERB_MIX: 31, FX_REVERB_MODE: 94, FX_CONV_TRIM: 95,
  FX_CHAIN1: 82, FX_CHAIN2: 83, FX_CHAIN3: 84, FX_CHAIN4: 85, FX_CHAIN5: 86, FX_CHAIN6: 87,
  SMP_ROOT: 96, SMP_MODE: 97, TEMPO: 37,
  OSC2_PITCH: 9, OSC_FM: 137, OSC_RING: 138,
  OSC1_PITCH: 3, OSC1_SYNC: 139, OSC1_SUB: 140, OSC1_SUB_LEVEL: 141,
  OSC2_SUB: 142, OSC2_SUB_LEVEL: 143, NOISE_MIX: 144, FILTER_MORPH: 145,
  FILTER_ROUTING: 146, FILTER2_TYPE: 147, FILTER2_CUTOFF: 148, FILTER2_RES: 149,
  FILTER2_DRIVE: 150, FILTER_BLEND: 151,
  FX_CRUSH_ON: 152, FX_CRUSH_BITS: 153, FX_CRUSH_DOWN: 154, FX_CRUSH_AA: 155, FX_CRUSH_MIX: 156,
  FX_EQ_ON: 157, FX_EQ_LOW_GAIN: 158, FX_EQ_LOW_FREQ: 159, FX_EQ_MID_GAIN: 160,
  FX_EQ_MID_FREQ: 161, FX_EQ_MID_Q: 162, FX_EQ_HIGH_GAIN: 163, FX_EQ_HIGH_FREQ: 164,
  FX_EQ_MIX: 165,
  FILTER_ROUTING: 146, OSC_FM: 137, OSC_RING: 138, FX_GRAPH: 100,
  OSC1_PITCH: 3, OSC2_PITCH: 9, OSC1_DETUNE: 4, OSC2_DETUNE: 10,
  OSC1_UNISON: 70, OSC2_UNISON: 72, OSC1_SPREAD: 71, OSC2_SPREAD: 73, MASTER_TUNE: 41,
  /** P6.5: 2x oversampling of the drive/filter path. */
  OVERSAMPLE: 166,
  /** P9.2 transient shaper: on/off, the two signed amounts and the mix. */
  FX_TRANSIENT_ON: 179, FX_TRANSIENT_ATTACK: 180, FX_TRANSIENT_SUSTAIN: 181,
  FX_TRANSIENT_MIX: 182, OSC1_DETUNE: 4, OSC1_UNISON: 70, OSC1_SPREAD: 71,
  FX_GRAPH: 100,
};

const WAVE_TYPES = { lp: 0, hp: 1, bp: 2, notch: 3, sem: 6 };
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

// ----------------------------- P9.1a: a ruler that does not leak (see below)
//
// Two post-mortems — `docs/notes/hard-sync-aliasing.md` and the P6.2b noise
// floor investigation — ended at the same place: the exact-bin Parseval measure
// this gate used for "non-harmonic energy" is `total - sum(2|X(k*f0)|^2)`, a
// difference of two nearly equal large numbers. It is only readable when the
// tone sits on a whole number of analysis periods, and no oscillator does:
// `daisysp::Oscillator` computes its phase increment as `f * sr_recip_` in
// float, so "880 Hz" is really 879.999965 Hz and every partial is off the
// probe by `k * 3.5e-5` Hz. The leftover leaks, and the sign of the residual
// then depends on the tone's phase. Probing the f32-exact frequency instead —
// the obvious fix — was measured on this wasm build and does not work either:
// over the eight notes below the sine reads -74 dB on one and hits the
// `max(residual, 1e-30)` clamp (-2978 "dB") on the next.
//
// What is stable is a window whose own leakage is far below the thing being
// measured. A 7-term Blackman-Harris window has -180 dB sidelobes, so over four
// whole seconds the power that is not within eight bins (2 Hz) of a harmonic is
// the engine's own off-grid energy. The 4-term Blackman-Harris is not enough:
// its -92 dB sidelobes leave a pure sine at -104 dB, above the -105 dB line
// this batch has to hold, while the 7-term one reads -117 dB and does not move
// when the exclusion band is widened to 16 Hz.

/**
 * Everything a settled oscillator measurement depends on, pinned. `gs_init`
 * keeps the parameter block *and* the modulation matrix, so an unset pitch or
 * noise amount is the previous scenario's — which is how the hard-sync section
 * was silent the first few times it ran, and why P6.3a measured the default
 * patch's ENV -> CUTOFF instead of its filter.
 */
const QUIET_PATCH = [
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

/** The P6.3a lesson in one call: the default patch's ENV/LFO -> CUTOFF is live. */
function clearModMatrix() {
  for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
}

/** 400 blocks = 1.07 s: the P6.2b report measured another 12 dB over 200. */
const SETTLE_BLOCKS = 400;
/** The alias ruler's window, and its exclusion half-width in bins of it. */
const FLOOR_SECONDS = 4;
const FLOOR_BINS = 8;

/**
 * A settled, pinned, unmodulated four-second render of one note, left channel.
 */
function renderFloor(extra, note) {
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

/** Iterative radix-2 FFT, in place, on a Float64Array pair. */
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + half] * cr - im[i + j + half] * ci;
        const vi = re[i + j + half] * ci + im[i + j + half] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 7-term Blackman-Harris, the minimum-sidelobe member of the family. */
const BH7 = [
  0.27105140069342, 0.43329793923448, 0.21812299954311, 0.06592544638803,
  0.01081174209837, 0.00077658482522, 0.00001388721735,
];

function bh7Window(n, N) {
  let v = BH7[0];
  for (let k = 1; k < BH7.length; k++) {
    v += (k % 2 ? -1 : 1) * BH7[k] * Math.cos((2 * Math.PI * k * n) / (N - 1));
  }
  return v;
}

/**
 * The share of a settled render's power that is *not* on the harmonic grid of
 * `f0`, in dB. The window is a 7-term Blackman-Harris over the whole render,
 * zero-padded to the next power of two; eight bins either side of every
 * harmonic are excluded. At four seconds a bin is 0.25 Hz and the window's own
 * main lobe is +-1.75 Hz, so the exclusion covers the lobe and no line power
 * can be mistaken for off-grid energy.
 */
function offGridFloor(samples, f0) {
  const N = samples.length;
  let nfft = 1;
  while (nfft < N) nfft <<= 1;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let i = 0; i < N; i++) re[i] = samples[i] * bh7Window(i, N);
  fftInPlace(re, im);
  const half = nfft >> 1;
  const df = SR / nfft;
  const exHz = (FLOOR_BINS * SR) / N;
  const excluded = new Uint8Array(half);
  for (let k = 1; k * f0 < SR / 2 + exHz; k++) {
    const centre = k * f0;
    const lo = Math.max(0, Math.ceil((centre - exHz) / df));
    const hi = Math.min(half - 1, Math.floor((centre + exHz) / df));
    for (let b = lo; b <= hi; b++) excluded[b] = 1;
  }
  let off = 0;
  let total = 0;
  for (let b = 0; b < half; b++) {
    const p = re[b] * re[b] + im[b] * im[b];
    total += p;
    if (!excluded[b]) off += p;
  }
  return 10 * Math.log10(Math.max(off, 1e-300) / Math.max(total, 1e-300));
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
//
// P9.1c: the restart residual is a *stationary* quantity now, and that is how
// it is asserted -- every four-second window has to stay under the line, not
// just a favourable one. Until P9.1c `sync_kernel` interpolated the step
// kernel straight across its own jump at `d = 0`, so a master wrap whose
// sub-sample position walked into the last 1/64 of a sample came back with a
// correction of the wrong sign and nearly full magnitude. The residual
// therefore burst to about the naive saw's own level (-33 dB) for ~11 s out of
// every ~24 s and recovered to below -110 dB in between: the -68.7 dB this
// section used to print was a favourable window of that cycle. (The old
// rectangular ruler reads the fixed engine as -46 dB for the saw, which is the
// same difference-of-two-large-numbers failure P9.1a documented; it is gone
// from this section.) What replaced it is the P9.1a BH-7 ruler -- four whole
// seconds, every window read on its own, every window under the line -- over
// the three waveforms and the four ratios the brief names.
//
// Division of labour: this is the short scan (three windows per scene, so the
// gate stays affordable). The long scan -- many windows, a second test on
// consecutive note-ons -- lives in the Rust tests
// `hard_sync_restart_residual_is_stationary` and
// `hard_sync_note_on_spread_is_stationary`, which can render for a minute.
// Both sides assert the same thing; only the scene count and window count
// differ.
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
  const renderSync = (sync, wave = WAVE.saw, blocks = 300, skip = 120) => {
    engine(
      [
        ...quiet,
        [P.OSC1_WAVE, wave], [P.OSC1_LEVEL, 0.9], [P.OSC1_PITCH, slaveRatio],
        // Pin the pulse width: the engine keeps its parameter block across
        // `gs_init`, so a scenario above can leave a narrow pulse behind and
        // the square's two edges would then sit almost on top of each other.
        [P.OSC1_PW, 0.5],
        [P.OSC1_SYNC, sync], [P.OSC1_SUB, 0],
        [P.OSC2_WAVE, WAVE.sine], [P.OSC2_ON, 1], [P.OSC2_LEVEL, 0], [P.OSC2_PITCH, 0],
        [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
      ],
      [[57, 1]],
    );
    const out = [];
    for (const [l] of render(blocks, skip)) out.push(...l);
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

  // The P6.2 acceptance line itself: the energy that is *not* on the master's
  // harmonic grid must be at least 60 dB below the signal. This needs the
  // measurement the post-mortem settled on — one whole second, a rectangular
  // window and exact bins, on a note that has been left to settle. Hann's own
  // sidelobes sit near -95 dB and a limiter still recovering from the attack
  // reads as a slow gain change, which is exactly the modulation an off-grid
  // metric picks up (see docs/notes/hard-sync-aliasing.md).
  // The P6.2 acceptance line, now as a window scan: three waveforms x four
  // ratios, three non-overlapping four-second windows each, every window
  // measured with the P9.1a BH-7 ruler. The fix measures -88 dB or better in
  // every window of every scene, so this pins the line where the engine
  // actually is.
  const WINDOW = 4 * SR;
  const WINDOW_BLOCKS = WINDOW / BLOCK;
  const WINDOWS = 3;
  for (const [name, wave] of [
    ['saw', WAVE.saw],
    ['square', WAVE.square],
    ['triangle', WAVE.triangle],
  ]) {
    for (const ratio of [1.41, 1.7, 2.0, 3.3]) {
      const ratioSemis = 12 * Math.log2(ratio);
      engine(
        [
          ...quiet,
          [P.OSC1_WAVE, wave], [P.OSC1_LEVEL, 0.9], [P.OSC1_PITCH, ratioSemis],
          [P.OSC1_PW, 0.5], [P.OSC1_SYNC, 1], [P.OSC1_SUB, 0],
          [P.OSC2_WAVE, WAVE.sine], [P.OSC2_ON, 1], [P.OSC2_LEVEL, 0], [P.OSC2_PITCH, 0],
          [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
        ],
        [[57, 1]],
      );
      const samples = new Float64Array(WINDOWS * WINDOW);
      let w = 0;
      for (const [l] of render(400 + WINDOWS * WINDOW_BLOCKS, 400)) {
        for (const v of l) samples[w++] = v;
      }
      const windows = [];
      for (let k = 0; k < WINDOWS; k++) {
        windows.push(offGridFloor(samples.subarray(k * WINDOW, (k + 1) * WINDOW), master));
      }
      const worst = Math.max(...windows);
      check(
        `hard sync's restart residual is stationary (${name} x${ratio})`,
        worst < -60,
        `${windows.map((v) => v.toFixed(1)).join(' / ')} dB, worst ${worst.toFixed(1)} (target -60)`,
      );
    }
  }

  // The calibration that makes the number readable: the *unsynced* slave at a
  // non-integer ratio is nowhere near the master's grid, so the same ruler
  // reads it near 0 dB.
  const freeCal = renderSync(0, WAVE.saw, 400 + WINDOW_BLOCKS, 400);
  const freeFloor = offGridFloor(freeCal, master);
  check(
    'the off-grid ruler does see an unsynced slave',
    freeFloor > -3,
    `${freeFloor.toFixed(1)} dB with sync off (the synced windows above sit under -88)`,
  );

  // Time domain alongside it: periodic at the master's rate (>= 0.999), bounded,
  // finite, and free of sample-to-sample steps large enough to be heard as a
  // click.
  for (const [name, wave] of [
    ['saw', WAVE.saw],
    ['square', WAVE.square],
    ['triangle', WAVE.triangle],
  ]) {
    const synced = renderSync(1, wave, 575, 200);
    let peak = 0;
    let jump = 0;
    let finite = true;
    for (let i = 0; i < synced.length; i++) {
      const v = synced[i];
      finite = finite && Number.isFinite(v);
      peak = Math.max(peak, Math.abs(v));
      if (i > 0) jump = Math.max(jump, Math.abs(v - synced[i - 1]));
    }
    const corr = periodCorrelation(synced);
    check(
      `hard sync stays bounded, click-free and periodic (${name})`,
      finite && peak <= 1.0 + 1e-6 && jump < 0.25 && corr > 0.999,
      `peak ${peak.toFixed(3)}, largest step ${jump.toFixed(3)}, correlation ${corr.toFixed(4)}`,
    );
  }
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

// ------------------------------- SEM continuous multimode filter (P6.3a)
//
// The mode is one knob that walks four canonical responses — low-pass, then
// band-pass, then the notch (`low + high`, an exact null at the cutoff), then
// high-pass — so the gate measures all four through the real wasm build and
// then slams the knob end to end: a filter that changes its zeros *and* its
// poles while the knob moves is exactly where a click would come from.
{
  const cutoff = 400;
  const sem = 6; // FilterType::Sem on the wire (the bridge maps it to its own id)
  const flat = [
    [P.FILTER_CUTOFF, cutoff], [P.FILTER_RES, 0.3], [P.FILTER_DRIVE, 0],
    [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0], [P.FILTER_TYPE, sem],
    [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.8], [P.OSC1_SYNC, 0], [P.OSC1_SUB, 0],
    [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
    [P.ENV_ATTACK, 0.005], [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0], [P.LFO2_ON, 0],
    [P.MASTER_VOLUME, 1], [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0],
    [P.FX_CHORUS_ON, 0], [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
  ];
  // The default patch routes the envelope and the LFO at the cutoff (amounts
  // 0.55 and 0.8, both enabled), so a scenario that does not clear the matrix
  // measures the modulation instead of the filter: with the route live, the
  // low-pass end of the morph *rose* with frequency by 1.3 dB where it has to
  // fall by 12. This section pins the matrix, like the Rust tests do.
  const quietMatrix = () => {
    for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
  };
  const tone = (freq, morph, cut = cutoff) => {
    // The tone is played by pitch, and the oscillator's range is ±48 semitones
    // around C4 (the same ceiling the Rust tests keep bumping into): a silent
    // clamp there would be measured as a filter error.
    const pitch = 12 * Math.log2(freq / 261.6256);
    if (Math.abs(pitch) > 48) throw new Error(`gate frequency ${freq} Hz is outside the oscillator's range`);
    engine([...flat, [P.FILTER_CUTOFF, cut], [P.FILTER_MORPH, morph], [P.OSC1_PITCH, pitch]], [[60, 1]]);
    quietMatrix();
    const out = [];
    for (const [l] of render(90, 40)) out.push(...l);
    return binMag(out, freq);
  };
  // A cutoff four octaves up is flat across this grid, so it divides out the
  // oscillator's own level without colouring the shape.
  const response = (freq, morph) => tone(freq, morph) / tone(freq, 0, 6400);

  const lowSlope = 20 * Math.log10(response(800, 0) / response(200, 0));
  const highSlope = 20 * Math.log10(response(800, 1) / response(200, 1));
  check(
    'the low-pass end of the morph falls 12 dB/oct',
    lowSlope < -9 && lowSlope > -15,
    `${lowSlope.toFixed(2)} dB over two octaves`,
  );
  check(
    'the high-pass end rises 12 dB/oct',
    highSlope > 9 && highSlope < 15,
    `${highSlope.toFixed(2)} dB over two octaves`,
  );

  const bandCentre = response(cutoff, 1 / 3);
  const bandBelow = response(cutoff / 4, 1 / 3);
  check(
    'morph 1/3 is a band-pass at the cutoff',
    bandCentre > bandBelow * 4,
    `centre ${bandCentre.toFixed(3)} vs one octave below ${bandBelow.toFixed(3)}`,
  );

  const notchDepth = 20 * Math.log10(response(cutoff, 2 / 3) / response(cutoff / 4, 2 / 3));
  const notchEnds = 20 * Math.log10(response(cutoff * 2.5, 2 / 3) / response(cutoff / 4, 2 / 3));
  check(
    'morph 2/3 is a notch: a deep null with both ends still passing',
    notchDepth < -25 && Math.abs(notchEnds) < 4,
    `${notchDepth.toFixed(1)} dB at the centre, ends ${notchEnds.toFixed(1)} dB apart`,
  );

  // Time domain: the knob is not allowed to click when it moves. The engine's
  // parameter smoother is what has to absorb a full-range jump per block, so
  // this measures the sample-to-sample step of the rendered signal rather than
  // the parameter it came from.
  engine([...flat, [P.FILTER_MORPH, 0]], [[45, 1]]);
  quietMatrix();
  let worstStep = 0;
  let peak = 0;
  let finite = true;
  let prev = null;
  for (let b = 0; b < 240; b++) {
    ex.gs_set_param(P.FILTER_MORPH, Math.floor(b / 8) % 2 === 0 ? 0 : 1);
    ex.gs_set_param(P.FILTER_CUTOFF, Math.floor(b / 12) % 2 === 0 ? 300 : 6000);
    ex.gs_process(BLOCK);
    const heap = new Float32Array(ex.memory.buffer);
    const ptr = ex.gs_left_ptr() / 4;
    for (let i = 0; i < BLOCK; i++) {
      const v = heap[ptr + i];
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
      if (prev !== null) worstStep = Math.max(worstStep, Math.abs(v - prev));
      prev = v;
    }
  }
  check(
    'slamming the morph and the cutoff does not click',
    finite && peak < 1 && worstStep < 0.5,
    `peak ${peak.toFixed(3)}, worst sample step ${worstStep.toFixed(3)}`,
  );
}

// -------------------------- second filter stage: series / parallel (P6.3b)
//
// The Rust tests pin the exact wiring — a parallel blend of 0 or 1 renders the
// single-stage path sample for sample, series is the product of the stages, and
// the blend law is the weighted sum. What this section adds is the same feature
// measured on the real wasm build, in the domain a listener hears it in: the
// slopes, the shape between the two cutoffs, that the blend has to move the
// response monotonically, and that switching arrangement mid-note does not
// click. Comparisons here are of *responses* (each divided by one wide-open
// render), never of samples: two separately rendered engine instances are not a
// sample-comparison rig.
{
  const first = 300;
  const second = 3000;
  const flat = [
    [P.FILTER_TYPE, WAVE_TYPES.sem], [P.FILTER_CUTOFF, first], [P.FILTER_RES, 0.2],
    [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0], [P.FILTER_MORPH, 0],
    [P.FILTER2_CUTOFF, second], [P.FILTER2_RES, 0.2], [P.FILTER2_DRIVE, 0],
    [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.8], [P.OSC1_SYNC, 0], [P.OSC1_SUB, 0],
    [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
    [P.ENV_ATTACK, 0.005], [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0], [P.LFO2_ON, 0],
    [P.MASTER_VOLUME, 1], [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0],
    [P.FX_CHORUS_ON, 0], [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
  ];
  // The default patch's ENV/LFO -> CUTOFF routes are live; without clearing the
  // matrix these numbers are measurements of the modulation (P6.3a paid for
  // that lesson with a low-pass that appeared to rise with frequency).
  const quietMatrix = () => {
    for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
  };
  const tone = (freq, extra) => {
    const pitch = 12 * Math.log2(freq / 261.6256);
    if (Math.abs(pitch) > 48) throw new Error(`gate frequency ${freq} Hz is outside the oscillator's range`);
    engine([...flat, [P.OSC1_PITCH, pitch], ...extra], [[60, 1]]);
    quietMatrix();
    const out = [];
    for (const [l] of render(90, 40)) out.push(...l);
    return binMag(out, freq);
  };
  // One wide-open linear section, so the tone's own level and the voice gain
  // divide out of every number below.
  const open = (freq) => tone(freq, [[P.FILTER_ROUTING, 0], [P.FILTER_CUTOFF, 20000], [P.FILTER_RES, 0]]);
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  const response = (freq, extra) => db(tone(freq, extra)) - db(open(freq));

  const stage1 = (freq) => response(freq, [[P.FILTER_ROUTING, 0]]);
  const stage2 = (freq) => response(freq, [[P.FILTER_ROUTING, 2], [P.FILTER2_TYPE, 0], [P.FILTER_BLEND, 1]]);
  const serial = (freq) =>
    response(freq, [[P.FILTER_ROUTING, 1], [P.FILTER2_TYPE, 0], [P.FILTER2_CUTOFF, second]]);
  const grid = [600, 1500, 4000];
  const errors = grid.map((f) => serial(f) - (stage1(f) + stage2(f)));
  const worstError = Math.max(...errors.map(Math.abs));
  check(
    'Series is the product of the two responses',
    worstError < 2.0,
    `worst |series - (A + B)| ${worstError.toFixed(2)} dB at ${grid.join('/')} Hz`,
  );

  // Two 12 dB low-passes at the same cutoff: the chain has to fall twice as
  // fast. The first stage is `sem` at morph 0 — the discrete `lp` is the 24 dB
  // ladder, which would already be falling at 24 on its own.
  const lpPair = (freq) =>
    response(freq, [
      [P.FILTER_TYPE, WAVE_TYPES.sem], [P.FILTER_CUTOFF, 700],
      [P.FILTER_ROUTING, 1], [P.FILTER2_TYPE, 0], [P.FILTER2_CUTOFF, 700],
    ]);
  const singleStage = (freq) =>
    response(freq, [[P.FILTER_TYPE, WAVE_TYPES.sem], [P.FILTER_CUTOFF, 700], [P.FILTER_ROUTING, 0]]);
  const one = singleStage(2800) - singleStage(700);
  const two = lpPair(2800) - lpPair(700);
  check(
    'Two low-pass stages in series fall twice as fast',
    two < -18 && two < one * 1.6,
    `one stage ${one.toFixed(1)} dB vs two ${two.toFixed(1)} dB over two octaves`,
  );

  // The blend has to move the parallel mix between the branches, so the
  // branches have to differ at the probe frequency: a wide-open first stage
  // passes 1500 Hz, a dark second stage does not.
  const at = (blend) =>
    response(1500, [
      [P.FILTER_TYPE, WAVE_TYPES.sem], [P.FILTER_CUTOFF, 6000],
      [P.FILTER_ROUTING, 2], [P.FILTER2_TYPE, 0], [P.FILTER2_CUTOFF, 300],
      [P.FILTER_BLEND, blend],
    ]);
  const ladder = [0, 0.25, 0.5, 0.75, 1].map(at);
  check(
    'The blend moves the parallel mix monotonically',
    ladder.every((v, i) => i === 0 || v < ladder[i - 1] + 0.01) && ladder[0] > ladder[4] + 6,
    `${ladder.map((v) => v.toFixed(1)).join(' → ')} dB at 1500 Hz`,
  );

  // Time domain: switching arrangement and moving the second cutoff must not
  // click. The rendered step is what a listener would hear.
  engine([...flat, [P.FILTER_ROUTING, 0], [P.FILTER2_TYPE, 0]], [[45, 1]]);
  quietMatrix();
  let worstStep = 0;
  let peak = 0;
  let finite = true;
  let prev = null;
  for (let b = 0; b < 240; b++) {
    ex.gs_set_param(P.FILTER_ROUTING, b % 40 < 20 ? 1 : 2);
    ex.gs_set_param(P.FILTER2_CUTOFF, Math.floor(b / 10) % 2 === 0 ? 300 : 6000);
    ex.gs_set_param(P.FILTER2_TYPE, Math.floor(b / 30) % 2 === 0 ? 0 : 1);
    ex.gs_process(BLOCK);
    const heap = new Float32Array(ex.memory.buffer);
    const ptr = ex.gs_left_ptr() / 4;
    for (let i = 0; i < BLOCK; i++) {
      const v = heap[ptr + i];
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
      if (prev !== null) worstStep = Math.max(worstStep, Math.abs(v - prev));
      prev = v;
    }
  }
  check(
    'Switching series/parallel mid-note does not click',
    finite && peak < 1 && worstStep < 0.5,
    `peak ${peak.toFixed(3)}, worst sample step ${worstStep.toFixed(3)}`,
  );
}

// ------------------------- bit-crusher and shaping EQ (P6.4)
//
// The Rust tests pin the DSP itself: grid membership and half-step error at
// every bit depth, the mirror's position for every divisor, anti-aliasing on
// both the image and true aliasing, the cookbook gains of each EQ band, and a
// bit-for-bit bypass at mix 0. What this section adds is the same two effects
// measured through the real wasm build and the whole parameter path: the
// divider's mirror, each EQ band's measured gain against the analytic one, the
// shelf shape, and that slamming the controls mid-note stays bounded and
// finite. Every frequency-domain number is a *response* (divided by the same
// render with the slot empty), never a comparison of samples from two
// separately rendered engines.
{
  const flat = [
    [P.FILTER_TYPE, WAVE_TYPES.sem], [P.FILTER_CUTOFF, 20000], [P.FILTER_RES, 0],
    [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0], [P.FILTER_MORPH, 0],
    [P.FILTER_ROUTING, 0], [P.FILTER2_CUTOFF, 20000],
    [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.25], [P.OSC1_SYNC, 0], [P.OSC1_SUB, 0],
    [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
    [P.ENV_ATTACK, 0.005], [P.ENV_SUSTAIN, 1], [P.LFO_ON, 0], [P.LFO2_ON, 0],
    [P.MASTER_VOLUME, 0.4], [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0],
    [P.FX_CHORUS_ON, 0], [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
    // An empty chain, so the only thing in the path is the effect under test.
    [P.FX_CHAIN1, 0], [P.FX_CHAIN2, 0], [P.FX_CHAIN3, 0],
    [P.FX_CHAIN4, 0], [P.FX_CHAIN5, 0], [P.FX_CHAIN6, 0],
    // The parameter block survives `gs_init` (the worklet pushes it every
    // block), so every P6.4 control is reset here. Without this a measurement
    // inherits the previous one's EQ gain and reads several dB off.
    [P.FX_CRUSH_ON, 0], [P.FX_CRUSH_BITS, 8], [P.FX_CRUSH_DOWN, 4],
    [P.FX_CRUSH_AA, 0.5], [P.FX_CRUSH_MIX, 1],
    [P.FX_EQ_ON, 0], [P.FX_EQ_LOW_GAIN, 0], [P.FX_EQ_LOW_FREQ, 200],
    [P.FX_EQ_MID_GAIN, 0], [P.FX_EQ_MID_FREQ, 1000], [P.FX_EQ_MID_Q, 0.9],
    [P.FX_EQ_HIGH_GAIN, 0], [P.FX_EQ_HIGH_FREQ, 4000], [P.FX_EQ_MIX, 1],
  ];
  // The default patch's ENV/LFO -> CUTOFF routes are live; without clearing the
  // matrix these numbers are measurements of the modulation (P6.3a's lesson).
  const quietMatrix = () => {
    for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
  };
  const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  // C6 is 1046.5 Hz, and the pitch control spans ±48 semitones around it, so
  // this covers 65 Hz .. 16.7 kHz — both the crusher's mirror and every EQ
  // probe below.
  const BIN = (freq, probe, extra) => {
    const pitch = 12 * Math.log2(freq / 1046.502);
    if (Math.abs(pitch) > 48) throw new Error(`gate frequency ${freq} Hz is outside the oscillator's range`);
    engine([...flat, [P.OSC1_PITCH, pitch], ...extra], [[84, 1]]);
    quietMatrix();
    // 120 blocks (`render(220, 120)`) is a 320 ms warm-up, not the 100 ms the
    // other sections get: these probes jump between 70 Hz and 16 kHz, and the
    // pitch is a *smoothed* parameter, so a shorter warm-up measures a tone
    // still gliding towards the probe frequency (it read 4.7 dB instead of 9 on
    // the high shelf).
    const out = [];
    for (const [l] of render(220, 120)) out.push(...l);
    return binMag(out, probe);
  };
  /** The effect's gain at `freq`, against the same tone with an empty chain. */
  const response = (freq, extra) => toDb(BIN(freq, freq, extra)) - toDb(BIN(freq, freq, []));

  // --- bit-crusher -------------------------------------------------------
  const crush = (extra) => [
    [P.FX_CHAIN1, 7], [P.FX_CRUSH_ON, 1], [P.FX_CRUSH_MIX, 1], ...extra,
  ];
  // A 1 kHz tone divided by 8 mirrors to 6000 - 1000 = 5000 Hz.
  const mirror = (aa) =>
    toDb(BIN(1000, 5000, crush([[P.FX_CRUSH_BITS, 8], [P.FX_CRUSH_DOWN, 8], [P.FX_CRUSH_AA, aa]]))) -
    toDb(BIN(1000, 1000, []));
  const rawMirror = mirror(0);
  const smoothMirror = mirror(1);
  check(
    'The bit-crusher divider mirrors, and anti-aliasing removes it',
    rawMirror > -30 && rawMirror - smoothMirror > 10,
    `mirror ${rawMirror.toFixed(1)} dB at 5000 Hz, ${(rawMirror - smoothMirror).toFixed(1)} dB lower with AA`,
  );
  // True aliasing: 8 kHz is above the 3 kHz decimated Nyquist and folds to 2 kHz.
  const fold = (aa) =>
    toDb(BIN(8000, 2000, crush([[P.FX_CRUSH_BITS, 8], [P.FX_CRUSH_DOWN, 8], [P.FX_CRUSH_AA, aa]]))) -
    toDb(BIN(8000, 8000, []));
  const rawFold = fold(0);
  const smoothFold = fold(1);
  check(
    'Anti-aliasing also suppresses the folded tone',
    rawFold > -30 && rawFold - smoothFold > 10,
    `8 kHz folded to 2 kHz: ${rawFold.toFixed(1)} dB raw, ${smoothFold.toFixed(1)} dB with AA`,
  );
  // A deeper divisor mirrors a different frequency: 700 Hz divided by 16 lands
  // on 3000 - 700 = 2300 Hz.
  const deep =
    toDb(BIN(700, 2300, crush([[P.FX_CRUSH_BITS, 16], [P.FX_CRUSH_DOWN, 16], [P.FX_CRUSH_AA, 0]]))) -
    toDb(BIN(700, 700, []));
  check('The mirror follows the divisor', deep > -40, `700 Hz / 16 mirrors to 2300 Hz at ${deep.toFixed(1)} dB`);

  // --- shaping EQ --------------------------------------------------------
  const eq = (extra) => [[P.FX_CHAIN1, 8], [P.FX_EQ_ON, 1], [P.FX_EQ_MIX, 1], ...extra];
  const lowShelf = [
    [P.FX_EQ_LOW_GAIN, 12], [P.FX_EQ_LOW_FREQ, 400],
    [P.FX_EQ_MID_GAIN, 0], [P.FX_EQ_HIGH_GAIN, 0],
  ];
  const lowBottom = response(70, eq(lowShelf));
  const lowCorner = response(400, eq(lowShelf));
  const lowAbove = response(3200, eq(lowShelf));
  const lowTop = response(16000, eq(lowShelf));
  check(
    'The low shelf reaches +12 dB and slopes back to unity',
    Math.abs(lowBottom - 12) < 1.5 &&
      Math.abs(lowAbove) < 1.5 &&
      Math.abs(lowTop) < 1.5 &&
      lowBottom > lowCorner &&
      lowCorner > lowAbove,
    `70 Hz ${lowBottom.toFixed(1)} / 400 Hz ${lowCorner.toFixed(1)} / 3.2 kHz ${lowAbove.toFixed(1)} / 16 kHz ${lowTop.toFixed(1)} dB`,
  );
  const mid = [[P.FX_EQ_MID_GAIN, -9], [P.FX_EQ_MID_FREQ, 1000], [P.FX_EQ_MID_Q, 1.2]];
  const midCentre = response(1000, eq(mid));
  const midAway = response(2000, eq(mid));
  check(
    'The sweepable mid peak matches its gain at the centre and falls away',
    Math.abs(midCentre + 9) < 1.5 && midAway > midCentre + 3,
    `1000 Hz ${midCentre.toFixed(1)} dB, 2000 Hz ${midAway.toFixed(1)} dB`,
  );
  const high = [[P.FX_EQ_HIGH_GAIN, 9], [P.FX_EQ_HIGH_FREQ, 3000], [P.FX_EQ_MID_GAIN, 0]];
  const highTop = response(16000, eq(high));
  const highBottom = response(70, eq(high));
  check(
    'The high shelf reaches +9 dB and leaves the bottom alone',
    Math.abs(highTop - 9) < 1.5 && Math.abs(highBottom) < 1.5,
    `16 kHz ${highTop.toFixed(1)} dB, 70 Hz ${highBottom.toFixed(1)} dB`,
  );
  // Dry/wet at 0 must be a true bypass. Two separately rendered engines do not
  // start the note at the same phase (the phase seed is not reset by
  // `gs_init`), so this cannot be a sample-for-sample comparison here — the
  // Rust test does that bit for bit. Through the wasm the equivalent statement
  // is that a crusher set to 4 bits / divide-by-8 with mix 0 leaves no artefact,
  // and an 18 dB EQ with mix 0 does not move the response.
  const bypassMirror =
    toDb(BIN(1000, 5000, crush([[P.FX_CRUSH_BITS, 4], [P.FX_CRUSH_DOWN, 8], [P.FX_CRUSH_AA, 0], [P.FX_CRUSH_MIX, 0]]))) -
    toDb(BIN(1000, 1000, []));
  check(
    'Mix 0 on the bit-crusher leaves no crusher artefact',
    bypassMirror < -60,
    `the 4-bit / divide-by-8 mirror is ${bypassMirror.toFixed(1)} dB down at mix 0`,
  );
  const bypassEq = response(70, eq([[P.FX_EQ_LOW_GAIN, 18], [P.FX_EQ_MIX, 0]]));
  check(
    'Mix 0 on the shaping EQ is flat',
    Math.abs(bypassEq) < 0.5,
    `an 18 dB shelf moves the response ${bypassEq.toFixed(2)} dB at mix 0`,
  );

  // --- time domain: slamming the controls must not click -----------------
  engine(
    [
      ...flat,
      [P.OSC1_PITCH, 12 * Math.log2(1000 / 1046.502)],
      // Both effects in two nodes of one chain, so both are live in the loop.
      [P.FX_CHAIN1, 7], [P.FX_CRUSH_ON, 1], [P.FX_CRUSH_MIX, 1],
      [P.FX_CHAIN2, 8], [P.FX_EQ_ON, 1], [P.FX_EQ_MIX, 1],
    ],
    [[84, 1]],
  );
  quietMatrix();
  {
    let peak = 0;
    let worstStep = 0;
    let finite = true;
    let prev = null;
    for (let b = 0; b < 240; b++) {
      ex.gs_set_param(P.FX_CRUSH_BITS, 4 + (b % 13));
      ex.gs_set_param(P.FX_CRUSH_DOWN, 1 + (b % 64));
      ex.gs_set_param(P.FX_CRUSH_AA, (b % 11) / 10);
      ex.gs_set_param(P.FX_CRUSH_MIX, (b % 40) < 20 ? 0 : 1);
      ex.gs_set_param(P.FX_EQ_LOW_GAIN, ((b % 37) - 18));
      ex.gs_set_param(P.FX_EQ_MID_FREQ, 200 + (b % 40) * 195);
      ex.gs_set_param(P.FX_EQ_HIGH_GAIN, 18 - (b % 37));
      ex.gs_set_param(P.FX_EQ_MIX, (b % 40) < 20 ? 1 : 0);
      ex.gs_process(BLOCK);
      const heap = new Float32Array(ex.memory.buffer);
      const ptr = ex.gs_left_ptr() / 4;
      for (let i = 0; i < BLOCK; i++) {
        const v = heap[ptr + i];
        if (!Number.isFinite(v)) finite = false;
        peak = Math.max(peak, Math.abs(v));
        if (prev !== null) worstStep = Math.max(worstStep, Math.abs(v - prev));
        prev = v;
      }
    }
    check(
      'Slamming the crusher and EQ controls does not click',
      finite && peak < 1 && worstStep < 0.5,
      `peak ${peak.toFixed(3)}, worst sample step ${worstStep.toFixed(3)}`,
    );
  }
}

// ------------------------------- 4b. 2x oversampling of the drive path (P6.5)
//
// This section renders two extra notes, and the engine spreads voice start
// phases by a counter that `gs_init` does *not* reset, so the scenarios after
// it would start on a different phase than they do without it. It therefore
// sits last and restores the parameter block on the way out: the gate's
// existing checks keep the exact phase history they had before P6.5.
//
// A fully driven sine is a hard-limited square: its odd harmonics run all the
// way up, and every one above the base Nyquist folds back onto a frequency
// that is *not* on the fundamental's grid. That folded energy is exactly what
// the 2x round trip removes, so the gate measures the energy that is not at a
// harmonic bin and asks the switch to drop it by at least 12 dB.
//
// The measurement follows the hard-sync post-mortem: one whole second, a
// rectangular window and exact bins (`binMagRect`, no window at all — Hann's
// own sidelobes sit at about -95 dB, right where this energy lives). The test
// tone is note 45 (110 Hz), where the first folded harmonic is still strong
// enough to measure; at the top of the keyboard the aliases are already far
// down. `gs_set_mod_route(i, 0, 0, 0, 0)` clears the default patch's ENV/LFO ->
// CUTOFF routes first: with them live this would measure the modulation.
{
  const NOTE = 45;
  const F0 = 440 * 2 ** ((NOTE - 69) / 12);
  const BLOCKS = (1 * SR) / BLOCK; // one whole second
  const SKIP_BLOCKS = 400; // let the attack and the limiter settle (P9.1a: was 240)
  /** Rectangular-window single-bin amplitude (no leakage on an exact bin). */
  const binMagRect = (samples, freq) => {
    const w = (2 * Math.PI * freq) / SR;
    let re = 0;
    let im = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    return Math.hypot(re, im) / samples.length;
  };
  /**
   * Non-harmonic energy in dB below the signal's own RMS. Parseval rather than
   * a list of probed frequencies: the folds land at `n * fs - k * f0`, which is
   * not a fixed fraction of the grid, and probing the wrong bins would report
   * the noise floor and call it a pass.
   */
  const aliasFloor = (oversample) => {
    engine(
      [
        [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.8],
        // One voice, on pitch: unison, detune and microtuning are all state a
        // previous scenario may have left behind, and all three would move the
        // harmonics off the bins the measurement subtracts.
        [P.OSC1_PITCH, 0], [P.OSC1_DETUNE, 0], [P.OSC1_UNISON, 1], [P.OSC1_SPREAD, 0],
        [P.OSC1_SYNC, 0], [P.OSC1_SUB, 0], [P.OSC1_SUB_LEVEL, 0], [P.MASTER_TUNE, 0],
        [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0],
        [P.OSC2_PITCH, 0], [P.OSC2_DETUNE, 0], [P.OSC2_UNISON, 1], [P.OSC2_SPREAD, 0],
        [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0], [P.VOICE_MODE, 0],
        [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 20000], [P.FILTER_RES, 0.1],
        [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0],
        // No second stage and no graph: the whole scenario is spelled out, so
        // the measurement does not depend on where in the file it sits.
        [P.FILTER_ROUTING, 0], [P.FILTER_MORPH, 0], [P.FILTER2_TYPE, 0],
        [P.FILTER2_CUTOFF, 20000], [P.FILTER2_RES, 0], [P.FILTER2_DRIVE, 0],
        [P.FX_GRAPH, 0],
        [P.ENV_ATTACK, 0.01], [P.ENV_SUSTAIN, 1],
        [P.LFO_ON, 0], [P.LFO2_ON, 0],
        [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
        [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0],
        [P.FX_CRUSH_ON, 0], [P.FX_EQ_ON, 0], [P.FX_TRANSIENT_ON, 0],
        // The drive is the only effect in the chain, so the alias source is
        // unambiguous whatever the previous scenario left behind.
        [P.FX_CHAIN1, 6], [P.FX_CHAIN2, 0], [P.FX_CHAIN3, 0],
        [P.FX_CHAIN4, 0], [P.FX_CHAIN5, 0], [P.FX_CHAIN6, 0],
        [P.FX_DRIVE_ON, 1], [P.FX_DRIVE_AMT, 1], [P.FX_DRIVE_MIX, 1],
        // Master volume low enough that the master limiter stays linear: its
        // gain loop is time-varying and would be counted as non-harmonic
        // energy that no amount of oversampling can remove.
        [P.MASTER_VOLUME, 0.1],
        [P.OVERSAMPLE, oversample ? 1 : 0],
      ],
      [[NOTE, 1]],
    );
    for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
    const rendered = render(20 + SKIP_BLOCKS + BLOCKS);
    const buf = [];
    for (let b = SKIP_BLOCKS; b < SKIP_BLOCKS + BLOCKS; b++) {
      for (const v of rendered[b][0]) buf.push(v);
    }
    const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
    let harmonics = 0;
    for (let k = 1; k * F0 < SR / 2; k++) {
      const m = binMagRect(buf, k * F0);
      // A sinusoid of amplitude A reads |sum|/N = A/2, so its power is 2m^2.
      harmonics += 2 * m * m;
    }
    const folded = Math.max(rms * rms - harmonics, 1e-30);
    return {
      db: 10 * Math.log10(folded / Math.max(rms * rms, 1e-30)),
      fund: binMagRect(buf, F0) * 2,
      samples: buf.length,
    };
  };
  const oneX = aliasFloor(false);
  const twoX = aliasFloor(true);
  // The switch is global and `gs_init` keeps the parameter block, so leaving
  // it on would silently change every scenario after this one. The other
  // values are restored to what the scenario above left, because the master
  // limiter's own gain modulation depends on the master volume and would
  // otherwise move a later scenario's zero-crossing count.
  ex.gs_set_param(P.OVERSAMPLE, 0);
  ex.gs_set_param(P.FX_DRIVE_ON, 0);
  ex.gs_set_param(P.FILTER_CUTOFF, 12000);
  ex.gs_set_param(P.FILTER_RES, 0.2);
  ex.gs_set_param(P.FILTER_DRIVE, 1);
  ex.gs_set_param(P.FILTER_ENV_AMT, 0);
  ex.gs_set_param(P.MASTER_VOLUME, 0.75);
  const drop = oneX.db - twoX.db;
  check(
    '2x oversampling drops the drive aliases by >= 12 dB',
    drop >= 12,
    `non-harmonic energy ${oneX.db.toFixed(1)} dB at 1x, ${twoX.db.toFixed(1)} dB at 2x ` +
      `(${drop.toFixed(1)} dB lower; ${twoX.samples} samples, exact bins, note ${NOTE})`,
  );
  // The mode is a quality switch, not a level control: a dropped fundamental
  // would mean the decimator, not the aliases, is what changed.
  check(
    '2x oversampling keeps the driven tone at the same level',
    Math.abs(20 * Math.log10(twoX.fund / oneX.fund)) < 1.0,
    `fundamental ${(20 * Math.log10(twoX.fund / oneX.fund)).toFixed(2)} dB vs 1x`,
  );
}

// ---------------------------- transient shaper (P9.2)
//
// The Rust rig pins the DSP itself: the identity at neutral amounts, the exact
// bit-for-bit mix-0 bypass, the attack and sustain gains and the bounded slam.
// This section measures the same effect through the real wasm build and the
// whole parameter path, in both domains:
//
//   * time domain — the attack gain on a note's onset and the sustain gain on
//     its release, measured per render as a windowed single-bin *envelope*
//     against the same render's settled plateau;
//   * frequency domain — a held tone through a *neutral* shaper must not gain
//     any harmonic content (THD increase at most 0.5%), and a mix-0 shaper must
//     leave the spectrum untouched.
//
// Two separate `gs_init` calls do not start a note at the same phase (the
// oscillator's phase counter survives init, and the default patch detunes by
// 7 cents), so nothing here compares samples or RMS from two renders: a
// windowed single-bin magnitude of a pure tone is phase independent, and the
// release is compared as a *ratio of ratios* so both renders' envelopes cancel.
{
  const flat = [
    [P.FILTER_TYPE, WAVE_TYPES.sem], [P.FILTER_CUTOFF, 20000], [P.FILTER_RES, 0],
    [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0], [P.FILTER_MORPH, 0],
    [P.FILTER_ROUTING, 0], [P.FILTER2_CUTOFF, 20000],
    [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.25], [P.OSC1_SYNC, 0], [P.OSC1_SUB, 0],
    // One voice, no detune: the default patch's two detuned voices beat against
    // each other, and a short window would then read the beat, not the shaper.
    [P.OSC1_DETUNE, 0], [P.OSC1_UNISON, 1], [P.OSC1_SPREAD, 0],
    [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0],
    // A zero attack so the note reaches its plateau at once, and a slow decay
    // and release so the falling envelope lasts long enough to measure.
    [P.ENV_ATTACK, 0.0], [P.ENV_DECAY, 4], [P.ENV_SUSTAIN, 1], [P.ENV_RELEASE, 0.5],
    [P.LFO_ON, 0], [P.LFO2_ON, 0],
    [P.MASTER_VOLUME, 0.4], [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0],
    [P.FX_CHORUS_ON, 0], [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0], [P.FX_DRIVE_ON, 0],
    // The transient shaper is the only thing in the chain.
    [P.FX_CHAIN1, 9], [P.FX_CHAIN2, 0], [P.FX_CHAIN3, 0],
    [P.FX_CHAIN4, 0], [P.FX_CHAIN5, 0], [P.FX_CHAIN6, 0],
    // The parameter block survives `gs_init`, so every P9.2 control is reset
    // here; without this a measurement inherits the previous one's amounts.
    [P.FX_TRANSIENT_ON, 0], [P.FX_TRANSIENT_ATTACK, 0],
    [P.FX_TRANSIENT_SUSTAIN, 0], [P.FX_TRANSIENT_MIX, 1],
  ];
  // The default patch's ENV/LFO -> CUTOFF routes are live; without clearing the
  // matrix these numbers are measurements of the modulation (P6.3a's lesson).
  const quietMatrix = () => {
    for (let i = 0; i < 8; i++) ex.gs_set_mod_route(i, 0, 0, 0, 0);
  };
  const pitch = (freq) => {
    const semis = 12 * Math.log2(freq / 1046.502);
    if (Math.abs(semis) > 48) throw new Error(`gate frequency ${freq} Hz is out of range`);
    return semis;
  };
  /** The tone every window is measured at. */
  const PROBE = 1000;
  /**
   * Block indices (128 samples each). The silence before the note is not
   * padding: a continuous control that was set just before the note keeps
   * moving for ~20 ms, and a measurement taken across that ramp would read the
   * smoother rather than the effect. 16 blocks is 43 ms, five time constants.
   */
  const AT_ON = 64;
  const AT_RELEASE = 100;
  const BLOCKS = 140;
  /**
   * One scenario in a single pass, so the note has one phase seed throughout:
   * two blocks of silence, the note for 36 blocks, then a release.
   */
  const renderNote = (extra) => {
    engine([...flat, [P.OSC1_PITCH, pitch(PROBE)], ...extra]);
    quietMatrix();
    const out = [];
    const capture = (blocks) => {
      for (let b = 0; b < blocks; b++) {
        ex.gs_process(BLOCK);
        const heap = new Float32Array(ex.memory.buffer);
        const ptr = ex.gs_left_ptr() / 4;
        for (let i = 0; i < BLOCK; i++) out.push(heap[ptr + i]);
      }
    };
    capture(AT_ON - 2);
    ex.gs_note_on(84, 1);
    capture(AT_RELEASE - AT_ON);
    ex.gs_all_notes_off();
    capture(BLOCKS - AT_RELEASE);
    return out;
  };
  /**
   * The tone's envelope over a block range, as a single-bin magnitude. A Hann
   * window over a few tens of milliseconds is phase independent and follows the
   * envelope, so the *ratio* of two windows is the gain the effect applied
   * there. The floor keeps an empty window from producing -Infinity dB.
   */
  const windowLevel = (samples, from, to) =>
    Math.max(binMag(samples.slice(from * BLOCK, to * BLOCK), PROBE), 1e-12);
  const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  /**
   * Where the shaper has let go: the detector's slow follower keeps returning
   * towards unity for the best part of a second, so the plateau is read a full
   * second into the note, where its residual is under a tenth of a decibel.
   */
  const PLATEAU = [AT_RELEASE - 16, AT_RELEASE - 2];
  /**
   * The gain the shaper applied to a window, against a *neutral* shaper's own
   * envelope over the same window: both ratios are taken inside one render, so
   * the note's phase and its natural onset-to-plateau decay cancel and what is
   * left is the effect.
   */
  const windowGain = (amount, which, from, to) => {
    const param = which === 'attack' ? P.FX_TRANSIENT_ATTACK : P.FX_TRANSIENT_SUSTAIN;
    const on = [[P.FX_TRANSIENT_ON, 1], [P.FX_TRANSIENT_MIX, 1]];
    const ratio = (samples) =>
      toDb(windowLevel(samples, from, to)) - toDb(windowLevel(samples, PLATEAU[0], PLATEAU[1]));
    const wet = renderNote([...on, [param, amount]]);
    const dry = renderNote(on);
    return ratio(wet) - ratio(dry);
  };
  const attackGain = (amount) => windowGain(amount, 'attack', AT_ON, AT_ON + 6);
  /**
   * The sustain gain: the release window against the plateau, compared with a
   * neutral shaper's own release-to-plateau ratio. Both renders have the same
   * envelope law, so dividing them leaves the shaper's contribution alone.
   */
  const sustainGain = (amount) => windowGain(amount, 'sustain', AT_RELEASE + 4, AT_RELEASE + 24);

  const attackUp = attackGain(0.5);
  const attackDown = attackGain(-0.5);
  check(
    'Transient attack = +0.5 lifts the onset by about 3 dB',
    Math.abs(attackUp - 3) <= 1,
    `${attackUp.toFixed(2)} dB on the onset against the plateau`,
  );
  check(
    'Transient attack = -0.5 cuts the onset by about 3 dB',
    Math.abs(attackDown + 3) <= 1,
    `${attackDown.toFixed(2)} dB on the onset against the plateau`,
  );
  const sustainUp = sustainGain(0.5);
  const sustainDown = sustainGain(-0.5);
  check(
    'Transient sustain = +0.5 shortens the tail by about 3 dB',
    Math.abs(sustainUp + 3) <= 1,
    `${sustainUp.toFixed(2)} dB on the release against a neutral shaper`,
  );
  check(
    'Transient sustain = -0.5 lengthens the tail by about 3 dB',
    Math.abs(sustainDown - 3) <= 1,
    `${sustainDown.toFixed(2)} dB on the release against a neutral shaper`,
  );

  // --- frequency domain: neutral settings add no harmonics -----------------
  //
  // A held sine through a neutral shaper (both amounts 0), against the same
  // tone with the effect switched off. Both are separate renders, so the THD is
  // compared as a number, never sample against sample.
  const thdOf = (extra) => {
    engine([...flat, [P.OSC1_PITCH, pitch(PROBE)], ...extra]);
    quietMatrix();
    ex.gs_note_on(84, 1);
    const out = [];
    for (let b = 0; b < 260; b++) {
      ex.gs_process(BLOCK);
      if (b < 40) continue;
      const heap = new Float32Array(ex.memory.buffer);
      const ptr = ex.gs_left_ptr() / 4;
      for (let i = 0; i < BLOCK; i++) out.push(heap[ptr + i]);
    }
    const fund = binMag(out, PROBE);
    let harmonics = 0;
    for (let k = 2; k * PROBE < SR / 2; k++) harmonics += binMag(out, k * PROBE) ** 2;
    return (Math.sqrt(harmonics) / Math.max(fund, 1e-12)) * 100;
  };
  const thdOff = thdOf([]);
  const thdNeutral = thdOf([[P.FX_TRANSIENT_ON, 1], [P.FX_TRANSIENT_MIX, 1]]);
  check(
    'A neutral transient shaper adds no harmonics',
    thdNeutral - thdOff <= 0.5,
    `THD ${thdOff.toFixed(3)}% -> ${thdNeutral.toFixed(3)}% (${(thdNeutral - thdOff).toFixed(3)} points)`,
  );
  // A mix-0 shaper with a violent setting must leave the spectrum where it was.
  const thdMixed = thdOf([
    [P.FX_TRANSIENT_ON, 1], [P.FX_TRANSIENT_MIX, 0],
    [P.FX_TRANSIENT_ATTACK, 1], [P.FX_TRANSIENT_SUSTAIN, 1],
  ]);
  check(
    'A mix-0 transient shaper leaves the spectrum untouched',
    Math.abs(thdMixed - thdOff) <= 0.5,
    `THD ${thdOff.toFixed(3)}% -> ${thdMixed.toFixed(3)}% at mix 0`,
  );

  // --- time domain: slamming the controls must not click -----------------
  engine(
    [...flat, [P.OSC1_PITCH, pitch(PROBE)], [P.FX_TRANSIENT_ON, 1], [P.FX_TRANSIENT_MIX, 1]],
    [[84, 1]],
  );
  quietMatrix();
  {
    let peak = 0;
    let worstStep = 0;
    let finite = true;
    let prev = null;
    for (let b = 0; b < 240; b++) {
      ex.gs_set_param(P.FX_TRANSIENT_ATTACK, ((b % 41) - 20) / 20);
      ex.gs_set_param(P.FX_TRANSIENT_SUSTAIN, 1 - (b % 41) / 20);
      ex.gs_set_param(P.FX_TRANSIENT_MIX, (b % 40) < 20 ? 0 : 1);
      ex.gs_process(BLOCK);
      const heap = new Float32Array(ex.memory.buffer);
      const ptr = ex.gs_left_ptr() / 4;
      for (let i = 0; i < BLOCK; i++) {
        const v = heap[ptr + i];
        if (!Number.isFinite(v)) finite = false;
        peak = Math.max(peak, Math.abs(v));
        if (prev !== null) worstStep = Math.max(worstStep, Math.abs(v - prev));
        prev = v;
      }
    }
    check(
      'Slamming the transient shaper controls does not click',
      finite && peak < 1 && worstStep < 0.5,
      `peak ${peak.toFixed(3)}, worst sample step ${worstStep.toFixed(3)}`,
    );
  }
}

// ------------------------------- P9.1a: the oscillator's off-grid floor
//
// The ruler lives at the top of the file (`QUIET_PATCH`, `renderFloor`,
// `offGridFloor`); this is where it is pointed at every factory waveform and
// every octave of the keyboard. Every scenario pins the whole signal path,
// clears the modulation matrix and settles for 400 blocks, so the number
// belongs to the oscillator rather than to the scenario's position in the file.
//
// This section sits last on purpose: it re-pins the whole parameter block, and
// the hard-sync scene above is sensitive to what it inherits.
{
  const NOTES = [33, 45, 57, 69, 81, 91, 96, 105];
  const hz = (n) => 440 * 2 ** ((n - 69) / 12);
  const floor = (wave, note) => offGridFloor(renderFloor([[P.OSC1_WAVE, wave]], note), hz(note));
  const at = (values) => `${NOTES.map((n, i) => values[i].toFixed(1)).join('/')} dB at ${NOTES.map((n) => hz(n).toFixed(0)).join('/')} Hz`;

  // The control: a sine has nothing to fold, so everything below is the ruler's
  // own floor. The exact-bin measure this gate used to carry read -84...-102 dB
  // here (and the post-mortem had to argue the number was an artefact); this one
  // is clean by construction. -105 dB is the batch's line and this is the
  // measurement that makes it assertable.
  const sines = NOTES.map((n) => floor(WAVE.sine, n));
  check(
    'a steady sine leaves nothing off its harmonic grid',
    Math.max(...sines) < -105,
    `worst ${Math.max(...sines).toFixed(1)} dB over ${NOTES.length} notes (${at(sines)})`,
  );

  // The harmonic-rich waves. P9.1b replaced DaisySP's two-point polyBLEP with
  // the band-limited oscillator the hard-sync path already used (naive shape,
  // BLEP/BLAMP at 2x, the shared 95-tap decimator), and these are the new
  // floors. The bounds sit just inside the measured worst case per wave
  // (saw -100.2, square -111.2, triangle -73.1 dB at 3520 Hz): this is the
  // acceptance line "the whole keyboard is under -60 dB" with the margin the
  // batch actually earned, not the -60 itself.
  for (const [name, wave, bound] of [
    ['triangle', WAVE.triangle, -68],
    ['saw', WAVE.saw, -95],
    ['square', WAVE.square, -105],
  ]) {
    const floors = NOTES.map((n) => floor(wave, n));
    check(
      `the ${name} is on its harmonic grid across the keyboard`,
      floors.every((v) => Number.isFinite(v) && v < bound),
      `${at(floors)} (worst ${Math.max(...floors).toFixed(1)} dB, bound ${bound})`,
    );
  }

  // Phase-spread audit (P9.1b). P9.1a's original form of this assertion was
  // "eight fresh scenes agree to the last bit", and it passed because the
  // two-point polyBLEP the plain oscillator used was phase-*invariant*:
  // `gs_init` does not reset `phase_seed` (only `Engine::new` does), so each
  // scene starts on the next seed and every seed measured the same. P9.1b's
  // band-limited path anchors its correction to the phase grid, so the start
  // phase now *is* a parameter and the floor moves with it. The assertion that
  // replaced it bounds that movement: the floor may vary from scene to scene,
  // but only inside one bound.
  //
  // It is deliberately *not* "every one of the eight clears -60 dB": that is the
  // floor table above, and repeating it per phase would make this a 5 %-per-run
  // lottery on a known 0.7 % outlier (2093 Hz through the factory filter's
  // 18 kHz / res 0.05 resonance — 1/150 fresh scenes read about -54 dB, `res=0`
  // measures 0/150, and the pre-P9.1b core measured 150/150 *over* -60 on the
  // same probe; it is tracked as its own batch in `docs/NEXT-PLAN-2.md`). What
  // this bound is for is the P9.1c failure mode: an 86 dB swing between windows.
  //
  // The exactness claim (same seed, same number, to the last bit) is not made
  // here either: `phase_seed` is bumped once per note-on and `gs_init` does not
  // reset it, so two fresh scenes are only the same phase if the counter and the
  // allocator line up — measured, the ninth scene in this file read -108.2 dB
  // against the first scene's -113.1. It lives in `cargo test`'s
  // `the_band_limited_oscillators_have_no_off_grid_floor`, which renders every
  // note from a fresh engine, and the stationarity of one held note is measured
  // there and in the P9.1c window scans.
  for (const [name, wave] of [['saw', WAVE.saw], ['square', WAVE.square], ['triangle', WAVE.triangle]]) {
    const phases = Array.from({ length: 8 }, () => floor(wave, 81));
    const hi = Math.max(...phases);
    const lo = Math.min(...phases);
    check(
      `eight fresh ${name} scenes stay within 20 dB of each other`,
      hi - lo < 20,
      `${lo.toFixed(1)}...${hi.toFixed(1)} dB at C7, spread ${(hi - lo).toFixed(2)} dB (was 0.00 dB before P9.1b)`,
    );
  }
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
