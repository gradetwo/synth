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
 *
 * P13.1: the render bootstrap and the rulers live in `scripts/lib/` now, shared
 * with the P13 tools (see `docs/LLM-INTERFACE.md`) so the gate and the tools can
 * never measure different engines. This file keeps the scenarios and every
 * threshold; the modules keep the machinery. Nothing here may change a number.
 *
 * Layer: the modules run the wasm core in Node -- no AudioWorklet, no AudioParam
 * automation, no Web Audio graph. That is the layer every number below belongs
 * to (see their file headers; browser-layer measurement is P13.4).
 */
import {
  SR, BLOCK, BUDGET_US, P, WAVE, WAVE_TYPES,
  ex, initCore,
  engine, render, clearModMatrix, renderFloor,
  noteOnCount, countNoteOn,
  blockSteps, worstStepOf, peakOf, rmsOf,
  arenaFreeBytes,
  importWavetableCycle, importSample, importImpulseResponse,
} from './lib/render-core.mjs';
import {
  offGridFloor, binMag, spectrum, binMagHann,
  aliasFloor, aliasBase, ALIAS_NOTE, ALIAS_F0,
  thdPercent, interHarmonicDb,
} from './lib/audio-ruler.mjs';
// P14.2: the one timing criteria, shared with `bench.mjs` and `src/fuzz.test.ts`.
import { timingTrust, PROBE_REFERENCE_US } from './lib/host-load.mjs';

initCore();
/** The soft limiter is transparent below this level (see dsp/util.rs). */
const KNEE = 0.82;

const failures = [];
const report = [];

function check(name, ok, detail) {
  report.push(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`);
  if (!ok) failures.push(name);
}

/**
 * A timing check the host cannot decide. It is printed like everything else —
 * with its reading — but is not a failure, and the verdict at the end of the
 * run says so in words: a green that quietly contains "the timing was never
 * judged" is what the third full sweep lost hours to.
 */
let timingNotJudged = null;
function inconclusive(name, reason, reading, host) {
  report.push(`  ⚠ ${name} — inconclusive: ${reason}; ${reading}`);
  timingNotJudged = { name, reason, host };
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
  const thd = thdPercent(buf, 440);
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
    const ratio = interHarmonicDb(buf, f0);
    check(
      `${name} at C7 is band-limited`,
      ratio < (name === 'wavetable' ? -60 : -55),
      `aliasing ${ratio.toFixed(1)} dB below the signal`,
    );
  }
}

// -------------------------------------------------------------------- 4. CPU
//
// P14.2: this is the fourth section's *timing* gate — the only one in this file
// — and it used to have no load probe at all. On a busy host it read 232 %,
// 149 % and 155 % of the quantum on unchanged code and failed, while the same
// scene read 26 % in a quiet window: the readings were the host, not the
// engine, and nothing in the output said which. The criteria are now the shared
// `timingTrust()` from `scripts/lib/host-load.mjs`, the same one `bench.mjs`
// has used since P9.1b, and **every reading is printed whether the check passes,
// fails, or cannot be judged**. No threshold moved: 16 voices through the whole
// effect chain, 200 blocks × 5 rounds, min of the rounds, `< 60 %` of 2667 µs.
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
  const ROUNDS = 5;
  const BLOCKS_PER_ROUND = 200;
  const roundUs = [];
  for (let round = 0; round < ROUNDS; round++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < BLOCKS_PER_ROUND; i++) ex.gs_process(BLOCK);
    roundUs.push(Number(process.hrtime.bigint() - start) / 1000 / BLOCKS_PER_ROUND);
  }
  const perBlockUs = Math.min(...roundUs);
  const load = (perBlockUs / BUDGET_US) * 100;
  // The reading, in full, on every path: the number, its share of the budget,
  // each round (so an outlier is visible rather than averaged away), how the
  // measurement was taken, and what the host was doing while it ran.
  const host = timingTrust();
  const reading =
    `perBlockUs ${perBlockUs.toFixed(0)} µs = ${load.toFixed(0)}% of ${BUDGET_US.toFixed(0)} µs; ` +
    `rounds ${roundUs.map((v) => v.toFixed(0)).join('/')} µs (best of ${ROUNDS} × ${BLOCKS_PER_ROUND} blocks, ` +
    `${notes.length} voices); host load ${host.load.toFixed(1)} on ${host.cpus} cpus, ` +
    `cpu probe ${host.probeUs.toFixed(0)} µs vs ${PROBE_REFERENCE_US} µs idle`;
  if (host.trusted) {
    check('worst-case block fits the budget', load < 60, reading);
  } else {
    inconclusive('worst-case block fits the budget', host.reason, reading, host);
  }
}

// ------------------------------------------ 5. imported single-cycle wavetable
{
  /** Hand a cycle to the core exactly as the worklet does. */

  const sine = Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * i) / 2048));
  check('a clean cycle imports', importWavetableCycle(sine) === 0, 'code 0');
  check('the core reports the imported table', ex.gs_wavetable_has() === 1, 'has = 1');
  check('junk is refused', importWavetableCycle(new Array(2048).fill(0)) === 2, 'a silent cycle is rejected');

  // Put the sine back and play it: one harmonic, and it must be a *sine*.
  importWavetableCycle(sine);
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
  check('an imported saw is accepted', importWavetableCycle(saw) === 0, 'code 0');
  engine(patch(WAVE.wavetable, 1), [[96, 1]]); // C7
  {
    const buf = [];
    for (const [l] of render(100)) buf.push(...l);
    const f0 = 2093;
    const ratio = interHarmonicDb(buf, f0);
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
  const before = arenaFreeBytes();
  for (let i = 0; i < 4; i++) ex.gs_init(SR, 16);
  const after = arenaFreeBytes();
  const lost = (before - after) / 1024;
  check('re-initialising the core does not leak the arena', lost < 64, `${lost.toFixed(0)} KB lost over 4 restarts`);
  check('the arena still has room after the restarts', after > 512 * 1024, `${(after / 1024).toFixed(0)} KB free`);
}

// ------------------------------------------------ 6. sampler and response (A/A5)
{
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

  // A unit-energy response: the core normalises it, so the wet level of a noise
  // source should land within a few dB of the dry signal.
  const response = Float32Array.from({ length: 24_000 }, (_, i) => (Math.random() * 2 - 1) * Math.exp(-i / 6_000));
  check('an impulse response imports', importImpulseResponse(response) === 0, 'code 0');
  check('the core reports the response', ex.gs_ir_has() === 1, 'has = 1');
  check('a short response is refused', importImpulseResponse(new Float32Array(8)) === 1, 'code 1');
  importImpulseResponse(response);

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

  const delayThenDrive = renderPatch(patch([1, 6, 0, 0, 0, 0], true));
  const driveThenDelay = renderPatch(patch([6, 1, 0, 0, 0, 0], true));
  const reference = rmsOf(delayThenDrive);
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
    Math.abs(rmsOf(emptyChain) - rmsOf(noEffects)) < rmsOf(noEffects) * 0.01,
    `${rmsOf(emptyChain).toFixed(5)} vs ${rmsOf(noEffects).toFixed(5)}`,
  );
}

// ------------------------------------------------- master tune is applied once
//
// `MASTER_TUNE` is baked into a voice's frequency when the note is tuned
// (`pitch_hz()` / `pitch_hz_with()`), and the render block used to add the same
// offset to `pitch_mod` a second time: every semitone of master tune moved the
// audio two semitones (+12 sounded +24, measured on this wasm core). The Rust
// test `master_tune_moves_the_rendered_pitch_once` covers the engine; this is
// the same claim on the real wasm module, because the bug lived in the render
// path and a unit test of `pitch_hz()` could not see it.
//
// Measured with the gate's existing spectrum ruler: one note 69 (A4, 440 Hz)
// through `aliasBase` (which pins every other parameter, master tune included),
// a whole 65536-sample window so a bin is 0.73 Hz, and the peak bin read back
// as semitones. One bin at the lowest probed pitch (220 Hz) is 0.079 semitone,
// so the 0.1 semitone tolerance is "a bin and a half"; the doubled answer sits
// 12 semitones away and is nowhere near it.
{
  const NFFT = 65536;
  const measuredHz = (tune) => {
    engine([...aliasBase, [P.MASTER_TUNE, tune]], [[69, 1]]);
    clearModMatrix();
    const buf = [];
    for (const [l] of render(NFFT / BLOCK)) buf.push(...l);
    const mag = spectrum(buf, NFFT);
    let peak = 1;
    for (let k = 2; k < mag.length; k++) if (mag[k] > mag[peak]) peak = k;
    return (peak * SR) / NFFT;
  };
  for (const [tune, want] of [[0, 0], [1, 1], [12, 12], [-12, -12]]) {
    const hz = measuredHz(tune);
    const got = 12 * Math.log2(hz / 440);
    const sign = (v) => `${v >= 0 ? '+' : ''}${v}`;
    check(
      `master tune ${sign(tune)} shifts the rendered pitch ${sign(want)} semitone(s), not the double`,
      Math.abs(got - want) < 0.1 && (want === 0 || Math.abs(got - want) < Math.abs(got - 2 * want)),
      `${hz.toFixed(1)} Hz = ${got >= 0 ? '+' : ''}${got.toFixed(2)} semitones`,
    );
  }
  // `engine()` keeps the parameter block across `gs_init`, so leave the shared
  // state where every later scenario expects it.
  ex.gs_set_param(P.MASTER_TUNE, 0);
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
  //
  // The step bound is a multiple of the *scene's own peak*, not an absolute
  // number. A click is a discontinuity, so what makes a step "large" is its
  // size relative to the signal: this scene is one voice at a pinned level, and
  // `gain = VOICE_GAIN * patch_gain` multiplies the whole waveform, so peak and
  // worst step scale by exactly the same factor. The bound used to be the
  // absolute `0.25`, which is a calibration at *one* bus gain, not a property
  // of hard sync: at the reference gain (VOICE_GAIN 0.22) the saw scene peaks
  // at 0.1355, so 0.25 was 1.84x its own peak. `1.8` reproduces that calibration
  // and rounds toward strict -- at the reference gain the new bound is 0.2439
  // (saw), 0.2107 (square) and 0.2194 (triangle), every one inside the old 0.25.
  // The wavetable/sampler section below already uses the same peak-relative
  // form (`pi * peak`, Bernstein's bound); this brings the hard-sync check in
  // line with it so no future bus-gain change has to touch a gate.
  const HARD_SYNC_STEP_RATIO = 1.8;
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
    const stepBound = HARD_SYNC_STEP_RATIO * peak;
    check(
      `hard sync stays bounded, click-free and periodic (${name})`,
      finite && peak <= 1.0 + 1e-6 && jump < stepBound && corr > 0.999,
      `peak ${peak.toFixed(4)}, largest step ${jump.toFixed(4)} < ${stepBound.toFixed(4)} (${HARD_SYNC_STEP_RATIO} x peak), correlation ${corr.toFixed(4)}`,
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
  const tone = (freq, morph, cut = cutoff) => {
    // The tone is played by pitch, and the oscillator's range is ±48 semitones
    // around C4 (the same ceiling the Rust tests keep bumping into): a silent
    // clamp there would be measured as a filter error.
    const pitch = 12 * Math.log2(freq / 261.6256);
    if (Math.abs(pitch) > 48) throw new Error(`gate frequency ${freq} Hz is outside the oscillator's range`);
    engine([...flat, [P.FILTER_CUTOFF, cut], [P.FILTER_MORPH, morph], [P.OSC1_PITCH, pitch]], [[60, 1]]);
    clearModMatrix();
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
  clearModMatrix();
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
  const tone = (freq, extra) => {
    const pitch = 12 * Math.log2(freq / 261.6256);
    if (Math.abs(pitch) > 48) throw new Error(`gate frequency ${freq} Hz is outside the oscillator's range`);
    engine([...flat, [P.OSC1_PITCH, pitch], ...extra], [[60, 1]]);
    clearModMatrix();
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
  clearModMatrix();
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
  const toDb = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  // C6 is 1046.5 Hz, and the pitch control spans ±48 semitones around it, so
  // this covers 65 Hz .. 16.7 kHz — both the crusher's mirror and every EQ
  // probe below.
  const BIN = (freq, probe, extra) => {
    const pitch = 12 * Math.log2(freq / 1046.502);
    if (Math.abs(pitch) > 48) throw new Error(`gate frequency ${freq} Hz is outside the oscillator's range`);
    engine([...flat, [P.OSC1_PITCH, pitch], ...extra], [[84, 1]]);
    clearModMatrix();
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
  clearModMatrix();
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
//
// The ruler and the patch live outside the scenario blocks: P9.4's graph
// section below measures the same quantity with the same code, so the two
// sections can never drift apart.

{
  const oneX = aliasFloor([
    // The drive is the only effect in the chain, so the alias source is
    // unambiguous whatever the previous scenario left behind.
    [P.FX_GRAPH, 0],
    [P.FX_CHAIN1, 6], [P.FX_CHAIN2, 0], [P.FX_CHAIN3, 0],
    [P.FX_CHAIN4, 0], [P.FX_CHAIN5, 0], [P.FX_CHAIN6, 0],
    [P.FX_DRIVE_ON, 1], [P.FX_DRIVE_AMT, 1], [P.FX_DRIVE_MIX, 1],
    [P.OVERSAMPLE, 0],
  ]);
  const twoX = aliasFloor([
    [P.FX_GRAPH, 0],
    [P.FX_CHAIN1, 6], [P.FX_CHAIN2, 0], [P.FX_CHAIN3, 0],
    [P.FX_CHAIN4, 0], [P.FX_CHAIN5, 0], [P.FX_CHAIN6, 0],
    [P.FX_DRIVE_ON, 1], [P.FX_DRIVE_AMT, 1], [P.FX_DRIVE_MIX, 1],
    [P.OVERSAMPLE, 1],
  ]);
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
      `(${drop.toFixed(1)} dB lower; ${twoX.samples} samples, exact bins, note ${ALIAS_NOTE})`,
  );
  // The mode is a quality switch, not a level control: a dropped fundamental
  // would mean the decimator, not the aliases, is what changed.
  check(
    '2x oversampling keeps the driven tone at the same level',
    Math.abs(20 * Math.log10(twoX.fund / oneX.fund)) < 1.0,
    `fundamental ${(20 * Math.log10(twoX.fund / oneX.fund)).toFixed(2)} dB vs 1x`,
  );
}

// ------------------- 4c. 2x oversampling of a *graph* drive node (P9.4)
//
// P6.5's section above covers the chain's drive insert. P9.4 gave the routing
// graph the same round trip plus per-edge delay compensation, and the failure
// that cost that batch a round was *inside* the node: the compensation was
// applied to the node's input as well as to the round trip after it, so the
// node's dry/wet crossfade mixed two copies 31 samples apart and the graph's
// output carried ~25 dB more non-harmonic energy at 2x than at 1x. The gate
// therefore has to measure the graph path itself, in both domains:
//
//   * frequency — the same Parseval ruler as 4b, with the drive in graph node 1
//     instead of chain slot 1. The drop is asked for the same >= 12 dB;
//   * time — the graph node's 2x round trip has to land the same signal the
//     chain's 2x insert lands, at the same time, and the engine has to report
//     the number of samples it added. See `graphDelayProbe` below: it compares
//     the two paths *inside one note*, which is the only way to do it on this
//     engine (the oscillator's start phase advances per started voice and
//     `gs_init` does not reset it, so two `engine()` calls are not
//     sample-comparable — the discipline's cross-instance rule).
//
// This rides on 4b's voice-phase counter: `gs_init` does not reset it, so it
// still sits last among the note-starting scenarios, and it restores the block
// on the way out like 4b does.
{
  /**
   * The 4b patch with the drive moved from chain slot 1 into graph node 1.
   *
   * `FX_CHAIN1 = 6` is the node's *kind* (the same code the chain's own test
   * writes), not a chain position: node 1 reads the dry bus and reaches the
   * output, so the graph is the only path and only that node runs. Writing 0
   * here would leave the node kind `None` — the graph would still be on, but
   * the drive would never run and the scenario would measure the engine's
   * residual release tail (it did, at -102 dB, until this was spelled out).
   */
  const graphPatch = (oversample) => [
    [P.FX_GRAPH, 1],
    [P.FX_CHAIN1, 6],
    [P.FX_CHAIN2, 0], [P.FX_CHAIN3, 0], [P.FX_CHAIN4, 0],
    [P.FX_CHAIN5, 0], [P.FX_CHAIN6, 0],
    [P.FX_NODE_IN1, 1], [P.FX_NODE_IN1_GAIN, 1],
    [P.FX_NODE_TO_OUT, 1], [P.FX_NODE_OUT_GAIN, 1],
    [P.FX_DRIVE_ON, 1], [P.FX_DRIVE_AMT, 1], [P.FX_DRIVE_MIX, 1],
    [P.OVERSAMPLE, oversample ? 1 : 0],
  ];
  const graph1x = aliasFloor(graphPatch(false));
  const graph2x = aliasFloor(graphPatch(true));
  // Read *after* the 2x render: the engine resolves its latency while
  // rendering, so the value a host would query after this block is the one the
  // 2x pass used, and the 1x pass would report zero.
  const latency = ex.gs_oversample_latency();

  /**
   * Time-domain probe for the graph node's round trip, phase free.
   *
   * A plain cross-correlation of the 1x and 2x *renders* cannot work on this
   * engine: the voice start phase comes from a golden-ratio sequence
   * (`Engine::next_phases`, one step per started voice) that `gs_init` does not
   * reset, so two `engine()` calls render the same patch at different carrier
   * phases. Measured: the same patch rendered twice at 1x peaks at lag 167 with
   * |corr| 0.9988 and only -0.529 at lag 0, and the graph 1x-vs-2x curve peaks
   * wherever that unknown phase lands, not at the round trip. (The Rust rig can
   * use the direct measurement because each `graph_drive_engine` builds a fresh
   * `Engine`, whose phase counter starts at the same value; it reads 0.998292
   * at exactly the reported 62.)
   *
   * What *is* comparable is two windows of one note. The oscillator phase is
   * continuous across a parameter change, so:
   *
   *   1. run the drive as a **chain insert at 2x** and capture window A;
   *   2. wait a known gap (so the phase advance over it is known, if only by
   *      the control run);
   *   3. either keep the chain (control) or switch `FX_GRAPH` to the **node**
   *      and capture window B.
   *
   * The control peak sits at `-(gap mod period)`, whatever the phase sequence
   * did; the graph peak must sit at exactly the same lag, because node 1 and
   * chain slot 1 are the same drive and must have the same latency. The apex is
   * a corner (1.000 at the lag, 0.984 two samples away), so a missing or
   * doubled 31-sample round trip moves it by 31 and is unmissable. The gap is
   * also checked against its own predicted lag, which proves the probe measures
   * time at all.
   */
  const graphDelayProbe = () => {
    const WINDOW = 96; // 0.25 s per capture
    const GAP = 16;
    const SETTLE = 60;
    const capture = (blocks) => {
      const out = new Float64Array(blocks * BLOCK);
      let w = 0;
      for (let b = 0; b < blocks; b += 1) {
        ex.gs_process(BLOCK);
        const ptr = ex.gs_left_ptr() / 4;
        const heap = new Float32Array(ex.memory.buffer);
        for (let i = 0; i < BLOCK; i += 1) out[w + i] = heap[ptr + i];
        w += BLOCK;
      }
      return out;
    };
    const run = (toGraph) => {
      engine(
        [
          ...aliasBase,
          [P.FX_GRAPH, 0],
          [P.FX_CHAIN1, 6], [P.FX_CHAIN2, 0], [P.FX_CHAIN3, 0],
          [P.FX_CHAIN4, 0], [P.FX_CHAIN5, 0], [P.FX_CHAIN6, 0],
          [P.FX_NODE_IN1, 1], [P.FX_NODE_IN1_GAIN, 1],
          [P.FX_NODE_TO_OUT, 1], [P.FX_NODE_OUT_GAIN, 1],
          [P.FX_DRIVE_ON, 1], [P.FX_DRIVE_AMT, 1], [P.FX_DRIVE_MIX, 1],
          // Both paths run at 2x, so the two windows have the same band limit:
          // the comparison is shape against shape, not square against alias.
          [P.OVERSAMPLE, 1],
        ],
        [[ALIAS_NOTE, 1]],
      );
      for (let i = 0; i < 8; i += 1) ex.gs_set_mod_route(i, 0, 0, 0, 0);
      capture(SETTLE);
      const a = capture(WINDOW);
      if (toGraph) ex.gs_set_param(P.FX_GRAPH, 1);
      capture(GAP);
      const b = capture(WINDOW);
      return [a, b];
    };
    const corr = (a, b, lag) => {
      let dot = 0;
      let ea = 0;
      let eb = 0;
      for (let i = 0; i < a.length; i += 1) {
        const j = i + lag;
        if (j < 0 || j >= b.length) continue;
        dot += a[i] * b[j];
        ea += a[i] * a[i];
        eb += b[j] * b[j];
      }
      return dot / Math.sqrt(Math.max(ea * eb, 1e-30));
    };
    // The gap puts the two windows a known number of base-rate samples apart;
    // the peak is where that gap lands modulo the tone's period.
    const period = SR / ALIAS_F0;
    const gapSamples = (WINDOW + GAP) * BLOCK;
    let expected = ((-gapSamples % period) + period) % period;
    if (expected > period / 2) expected -= period;
    const apex = (a, b) => {
      const centre = Math.round(expected);
      let best = [0, centre];
      for (let lag = centre - 6; lag <= centre + 6; lag += 1) {
        const c = corr(a, b, lag);
        if (Math.abs(c) > Math.abs(best[0])) best = [c, lag];
      }
      // The neighbours two samples out, so the checks can insist the peak is a
      // corner and not a plateau (a flat top would make the lag meaningless).
      return {
        corr: best[0],
        lag: best[1],
        centre,
        minus2: corr(a, b, best[1] - 2),
        plus2: corr(a, b, best[1] + 2),
      };
    };
    const [controlA, controlB] = run(false);
    const [graphA, graphB] = run(true);
    return { control: apex(controlA, controlB), graph: apex(graphA, graphB), expected };
  };
  const delay = graphDelayProbe();

  // Restore before the checks, so a thrown assertion cannot leave the graph or
  // the switch on for whatever runs after this.
  ex.gs_set_param(P.OVERSAMPLE, 0);
  ex.gs_set_param(P.FX_GRAPH, 0);
  ex.gs_set_param(P.FX_DRIVE_ON, 0);
  ex.gs_set_param(P.FX_NODE_TO_OUT, 0);
  ex.gs_set_param(P.FILTER_CUTOFF, 12000);
  ex.gs_set_param(P.FILTER_RES, 0.2);
  ex.gs_set_param(P.FILTER_DRIVE, 1);
  ex.gs_set_param(P.FILTER_ENV_AMT, 0);
  ex.gs_set_param(P.MASTER_VOLUME, 0.75);

  const drop = graph1x.db - graph2x.db;
  check(
    'the graph drive node at 2x drops its aliases by >= 12 dB',
    drop >= 12,
    `non-harmonic energy ${graph1x.db.toFixed(1)} dB at 1x, ${graph2x.db.toFixed(1)} dB at 2x ` +
      `(${drop.toFixed(1)} dB lower; node 1, ${graph2x.samples} samples, exact bins)`,
  );
  // The graph carries the voice path's round trip *and* the node's own, so a
  // node that forgot its compensation would report the wrong number here before
  // any ruler noticed.
  check(
    'the graph drive node reports both round trips as latency',
    latency === 62,
    `gs_oversample_latency() ${latency} samples at 2x (voice 31 + node 31)`,
  );
  // The probe's own control: the same chain insert on both sides of the gap.
  // Its peak has to land where the known gap puts it, or nothing below means
  // anything.
  check(
    'the delay probe reads the gap it stepped',
    delay.control.lag === delay.control.centre && Math.abs(delay.control.corr) >= 0.999,
    `chain-to-chain peaks at lag ${delay.control.lag} (predicted ${delay.expected.toFixed(2)}), ` +
      `|corr| ${Math.abs(delay.control.corr).toFixed(6)}`,
  );
  // The property this exists for: switching the same drive from the chain
  // insert to the graph node, inside one note, must not move the signal in
  // time. A node whose round trip is missing, doubled or merged into its input
  // delay shifts this by 31 samples.
  check(
    'the graph drive node lands exactly where the chain insert lands',
    delay.graph.lag === delay.control.lag && Math.abs(delay.graph.corr) >= 0.999,
    `graph 2x vs chain 2x peaks at lag ${delay.graph.lag} against the control's ` +
      `${delay.control.lag} (${delay.graph.lag - delay.control.lag} samples of relative ` +
      `delay), |corr| ${Math.abs(delay.graph.corr).toFixed(6)}; same note, so the ` +
      `oscillator phase is shared and the comparison is valid`,
  );
  // The apex has to be a corner, not a plateau: a plateau would make the exact
  // lag comparison above vacuous, because every lag on it would score the same.
  check(
    'the delay probe peaks on a corner, not a plateau',
    Math.abs(delay.control.corr) > Math.abs(delay.control.minus2) &&
      Math.abs(delay.control.corr) > Math.abs(delay.control.plus2),
    `|corr| ${Math.abs(delay.control.minus2).toFixed(6)} / ` +
      `${Math.abs(delay.control.corr).toFixed(6)} / ${Math.abs(delay.control.plus2).toFixed(6)} ` +
      `at lag ${delay.control.lag - 2}/${delay.control.lag}/${delay.control.lag + 2}`,
  );
  // The graph 2x render is the same square at the same level as its own 1x: a
  // node that combed its dry/wet mix would move this.
  const level = 20 * Math.log10(graph2x.rms / graph1x.rms);
  check(
    'the graph 2x render keeps the 1x waveform level',
    Math.abs(level) < 0.5,
    `rms ${graph1x.rms.toFixed(5)} at 1x, ${graph2x.rms.toFixed(5)} at 2x ` +
      `(${level.toFixed(2)} dB); peak ${graph1x.peak.toFixed(5)} -> ${graph2x.peak.toFixed(5)}`,
  );
  // A phase error wide enough to comb the node reads as a level change as well
  // as an alias one, so the fundamental is checked on the graph's own path too.
  check(
    'the graph 2x render keeps its fundamental level',
    Math.abs(20 * Math.log10(graph2x.fund / graph1x.fund)) < 1.0,
    `fundamental ${(20 * Math.log10(graph2x.fund / graph1x.fund)).toFixed(2)} dB vs 1x`,
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
    clearModMatrix();
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
    countNoteOn();
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
    clearModMatrix();
    ex.gs_note_on(84, 1);
    countNoteOn();
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
  clearModMatrix();
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

/** P9.6: the absolute phase seed this gate pins, the peak-relative time-domain
 * bound it holds, and how many fresh scenes the cheap backstop sweep renders.
 *
 * The bound used to be the absolute `0.13`. That was a calibration at one bus
 * gain, not a property of the oscillator: `gain = VOICE_GAIN * patch_gain`
 * multiplies the whole frame, so peak and worst adjacent step move by exactly
 * the same factor (measured x2.001 on the step and x2.001 on the peak when the
 * +6 dB change was applied). At the reference gain
 * (VOICE_GAIN 0.22) this C7 saw scene peaks at 0.1159, so 0.13 was 1.12x the
 * scene's own peak -- and the milder round of the P9.6 bug stepped 0.154
 * = 1.33x peak on other phases, which is what the line actually separates.
 * `1.10` keeps that verdict (it is 0.1275 absolute at the reference gain, a
 * shade *inside* the old 0.13) and makes the check independent of any future
 * bus-gain change. */
const P96_SEED = 707;
const P96_STEP_RATIO = 1.1;
const P96_SWEEP = 24;

// ------------------- P9.6: the BLEP wrap that lands on the table's node
//
// P9.1b's band-limited oscillator writes its corrections with a float table
// walk (`t += GS_BLEP_R` in `sync_emit`). The walk's ULP at `t ~ 4096` is
// 4.88e-4, so a wrap whose correction tap sits within half an ULP below the
// residual's jump rounds *onto* the node: the P9.1c fix keys on
// `i == GS_BLEP_OFF - 1`, no longer matches, the tap reads the right-hand
// limit instead of the left one, and one oversampled sample gets a full-step
// wrong correction. The window is `xw < ~2e-6` of a sample wide, so it is rare
// -- 1 of 150 fresh C7-saw scenes through the factory filter read about
// -44 dB where the other 149 read -110...-114 -- and, crucially, *which*
// scene is hit changes with the phase sequence. Any check that merely samples
// start phases can miss it, and one did: the plan's `res = 0` scan read 0/150
// while `res = 0.05` read 1/150 on the *same* phases, and that sampling
// artefact is what made the outlier look like a resonance problem.
//
// So this section pins one concrete phase instead of hoping. `gs_init` does
// not reset the engine's phase counter, so the Nth `gs_note_on` of a process
// always starts on the same phase; N is the only thing that moves (the
// sections above ran some number of them), so the section walks the counter to
// the pinned *absolute* seed with cheap release-cycle note-ons and then
// measures that one scene. Phase 707 is an empirically confirmed trigger: it
// read -44.8 dB before the fix and -112 dB after it, on the shipped wasm.
{
  const hz = 440 * 2 ** ((96 - 69) / 12);

  // Cheap backstop: a short natural sweep, time domain only. A normal wrap
  // through the factory filter steps by about 0.106, or 0.92x its own peak.
  let swept = { step: 0, peak: 1, ratio: 0 };
  for (let i = 0; i < P96_SWEEP; i++) {
    const scene = worstStepOf(renderFloor([[P.OSC1_WAVE, WAVE.saw]], 96));
    if (scene.ratio > swept.ratio) swept = scene;
  }
  check(
    'no fresh C7 saw scene through the factory filter clicks',
    swept.ratio < P96_STEP_RATIO,
    `worst adjacent step ${swept.step.toFixed(4)} on a ${swept.peak.toFixed(4)} peak = ${(swept.ratio * 100).toFixed(1)}% of peak over ${P96_SWEEP} scenes (bound ${(P96_STEP_RATIO * 100).toFixed(0)}% of peak = ${(P96_STEP_RATIO * swept.peak).toFixed(4)} at this scene)`,
  );

  // Walk the phase counter to the pinned seed. Note-ons cost a block each, not
  // a scene, so this is cheap; the release cycle keeps the voices free.
  const need = P96_SEED - 1 - noteOnCount();
  check(
    'the pinned P9.6 phase is still reachable',
    need >= 0,
    `${noteOnCount()} note-ons have already fired, so phase ${P96_SEED} is behind us`,
  );
  ex.gs_set_param(P.ENV_RELEASE, 0.005);
  ex.gs_set_param(P.FX_REVERB_ON, 0);
  ex.gs_set_param(P.FX_DELAY_ON, 0);
  for (let k = 0; k < need; k++) {
    ex.gs_note_on(96, 1);
    countNoteOn();
    ex.gs_all_notes_off();
    ex.gs_process(BLOCK);
  }
  const pinned = renderFloor([[P.OSC1_WAVE, WAVE.saw]], 96); // note-on #P96_SEED
  countNoteOn();
  const pinnedDb = offGridFloor(pinned, hz);
  check(
    `the pinned P9.6 phase (note-on ${P96_SEED}) stays on its harmonic grid`,
    pinnedDb < -95,
    `phase ${P96_SEED} reads ${pinnedDb.toFixed(1)} dB (bound -95; this exact phase read -44.8 dB before the fix, and it does not move when the factory resonance does)`,
  );
  const pinnedScene = worstStepOf(pinned);
  check(
    `the pinned P9.6 phase does not click`,
    pinnedScene.ratio < P96_STEP_RATIO,
    `phase ${P96_SEED} steps by ${pinnedScene.step.toFixed(4)} on a ${pinnedScene.peak.toFixed(4)} peak = ${(pinnedScene.ratio * 100).toFixed(1)}% of peak (bound ${(P96_STEP_RATIO * 100).toFixed(0)}% of peak; the milder round of this bug stepped 0.154 on other phases)`,
  );
}

// ------------------------- P9.5/P9.7: the wavetable and sampler above 1 kHz
//
// P9.1b band-limited the saw/square/triangle/pulse oscillator and deliberately
// left two paths on the old code: the wavetable (`Wave::Wavetable`) and the
// sampler (`Wave::Sample`). Neither is generated by DaisySP's oscillator — each
// is a **mipmap of short tables read with an interpolator** — so neither was
// covered by the BH-7 scans above. P9.5 reviewed those two sources with the
// same P9.1a ruler as the rest of the file (four whole seconds, exact bins,
// +-8 bins around every harmonic, clean modulation matrix, real wasm, every
// scenario's whole parameter block pinned by `renderFloor`) and found them at
// -25.8...-46.7 dB (wavetable) and -29.9...-31.0 dB (sampler), nowhere near the
// -60 dB acceptance line. The attribution was the **read**, not the tables:
//
//   * the strongest off-grid lines sat on `SR - k*f0`, and an independent JS
//     replica of the read reproduced them to the bin. A 16- or 32-sample level
//     read with linear interpolation is a piecewise-linear approximation whose
//     chord error is a train of high harmonics; above Nyquist they fold back
//     onto frequencies that are not on the note's grid.
//   * same content, longer level: -24.4 dB at 16 samples, -34.0 at 32, -46.4 at
//     64, -58.5 at 128, -82.6 at 512, -106.6 at 2048 — the 1/N² signature of
//     linear interpolation's chord error. Nearest-neighbour is -10.4 dB and a
//     4-point cubic only 6 dB better than linear, so this is not a rounding
//     detail.
//   * the sampler had a second, independent layer: `ReadState.position` was an
//     f32 counting *level samples* (up to 192000), so its unit in the last
//     place was a few 1e-4 samples. Because the loop is seamless that error
//     does not average out; it repeats at the loop rate and puts a family of
//     sidebands `± loop_rate` around every harmonic (measured at 2084.84 /
//     2101.50 Hz for a 2093 Hz note, i.e. ±8.2 Hz).
//
// P9.7 fixed both. Every wavetable level is now **full length** and differs
// only in its harmonic ceiling, so a high note reads a long table holding few
// harmonics: the read is nearly sample-for-sample and the fold-back is gone.
// The sampler's read position and step are f64 and the interpolator is cubic.
// Measured here: the worst factory bank -98.0 dB (was -25.8), an imported saw
// -102.8 dB (was -31.2), and the sampler -33.4 dB (was -29.9).
//
// P9.8 finished the sampler. The remaining -33 dB was the *level*, not the
// interpolator: a level built by decimating by 2^k leaves its content at 0.44 of
// its own Nyquist whatever k is, so the chord error stayed put no matter how the
// chain was shuffled. A level is now as long as its band allows, and its content
// sits at 1/4 of the level's Nyquist rather than 0.44. That quarter is only
// affordable because the read is a 16-tap Blackman-Harris-windowed sinc (a
// 1024-phase table, blended between phases) instead of the four-point cubic:
// measured on this ruler the cubic is -34 dB of images at a quarter of Nyquist
// and the sinc is -86 dB. Every level therefore gets the widest band its own
// rate range allows (`SR / 2^(k+1)`, i.e. 12-24 kHz of output at every level)
// and the sampler reads **-86.4 dB worst at high notes** against the -60 dB
// P9.1b line, with the whole keyboard at -81 dB or better. The ceilings below
// are the measured worst case plus 5 dB, exactly as the P9.1b and P9.7 rows are.
//
// Two things are worth knowing about the implementation. The phase table has
// `KERNEL_PHASES + 1` rows because the last phase blends into the kernel at
// `x = 1`, which is not the kernel at `x = 0` — using row zero there put every
// thousandth sample through a kernel shifted by a whole sample and cost 30 dB
// (that is what `the_phase_table_has_a_row_past_the_last_phase` guards). And the
// chain's filters are 192 taps for the first three stages and 96 after that: the
// early stages need the sharper transition, the late ones build short tables
// whose loop sits inside a long filter's edge-clamped region (8372 Hz read
// -58 dB with 192 taps everywhere, -81 dB with the split).
//
// What it cost: the levels are ~1.5× longer (a 4 s sample's mipmap is 2.3 MB,
// and the arena went 8 → 12 MiB), the read is 16 taps instead of 4, and the
// import filter still runs on the message path. All of the arithmetic, the
// before/after per note and the self-proofs are in
// `docs/notes/band-limited-oscillators.md` §P9.8.
{

  // There is no factory sample: a sample is instrument state the player
  // imports, so the review imports a deterministic one. It is 32768 samples at
  // 48 kHz holding **exactly 256 cycles of 375 Hz** (period 128 samples),
  // harmonics 1..48 with 1/k amplitudes:
  //
  //   for i in 0..32768:  s[i] = sum(sin(2*pi*k*i/128)/k, k = 1..48)
  //
  // Every harmonic is an exact multiple of the loop's fundamental, so anything
  // this transfer puts off the played note's grid is the sampler's own doing
  // and not the test signal's. The root is set to 375 Hz through the
  // fractional `SMP_ROOT` (a MIDI note, not a frequency), and the loop runs
  // from 32 to 4064 samples of the longest level: both bounds land on the same
  // point of the period and the loop holds a whole number of periods at every
  // mip level, so a seam cannot be mistaken for aliasing.
  const SAMPLE_LEN = 32768;
  const SAMPLE_HZ = 375;
  const sampleCycle = new Float32Array(SAMPLE_LEN);
  for (let i = 0; i < SAMPLE_LEN; i++) {
    let sum = 0;
    for (let k = 1; k <= 48; k++) sum += Math.sin((2 * Math.PI * k * i) / 128) / k;
    sampleCycle[i] = sum;
  }
  const SAMPLE_ROOT = 69 + 12 * Math.log2(SAMPLE_HZ / 440);
  const LOOP_START = 256 / SAMPLE_LEN;
  const LOOP_END = 1 - LOOP_START;
  const samplerPatch = (root) => [
    [P.OSC1_WAVE, WAVE.sample], [P.WT_USER, 0],
    [P.SMP_ROOT, root], [P.SMP_MODE, 1],
    [P.SMP_LOOP_START, LOOP_START], [P.SMP_LOOP_END, LOOP_END],
  ];
  check(
    'the review sample imports',
    importSample(sampleCycle, SR) === 0,
    `${SAMPLE_LEN} samples, 256 cycles of ${SAMPLE_HZ} Hz, loop ${LOOP_START.toFixed(5)}..${LOOP_END.toFixed(5)}`,
  );

  const hz = (n) => 440 * 2 ** ((n - 69) / 12);
  const at = (notes, values) =>
    notes.map((n, i) => `${hz(n).toFixed(0)} Hz ${values[i].toFixed(1)}`).join(' / ');
  const floors = (extra, notes) => {
    const values = notes.map((n) => offGridFloor(renderFloor(extra, n), hz(n)));
    return { values, worst: Math.max(...values) };
  };

  // The five factory banks. Each is selected by the PW knob (0.05..0.95 maps
  // onto the five recipes in `WAVETABLE_RECIPES` order), so one scan covers the
  // whole factory content. Four notes from 1 kHz up, where P9.5 measured the
  // failure; each bound is the measured worst case plus about 5 dB, the same
  // headroom the P9.1b bounds above use.
  const WT_NOTES = [84, 96, 105, 108];
  ex.gs_wavetable_clear();
  for (const [name, pw, bound] of [
    ['organ', 0, -95],
    ['hollow', 0.25, -95],
    ['vocal', 0.5, -95],
    ['metallic', 0.75, -90],
    ['glass', 1.0, -95],
  ]) {
    const { values, worst } = floors(
      [[P.OSC1_WAVE, WAVE.wavetable], [P.OSC1_PW, pw], [P.WT_USER, 0]],
      WT_NOTES,
    );
    check(
      `the ${name} wavetable bank stays inside its measured high-note floor`,
      values.every((v) => Number.isFinite(v) && v < bound),
      `${at(WT_NOTES, values)} (worst ${worst.toFixed(1)} dB, ceiling ${bound}, measured +5 dB headroom)`,
    );
  }

  // The same banks at C2/C3. The old read was at its *best* there (-46.7 dB at
  // 1047 Hz), but the level a bass note picks was a long table even before the
  // fix, so this is a regression guard rather than a headline. The bound is
  // looser on purpose: at these pitches almost every factory harmonic is below
  // the engine's own 18 kHz filter, so the floor here is the *filter's*
  // stopband (about -88 dB) rather than the table, and pinning it at the
  // high-note line would assert something the measurement cannot deliver.
  for (const [name, pw, bound] of [
    ['organ', 0, -100],
    ['hollow', 0.25, -100],
    ['vocal', 0.5, -100],
    ['metallic', 0.75, -90],
    ['glass', 1.0, -84],
  ]) {
    const { values, worst } = floors(
      [[P.OSC1_WAVE, WAVE.wavetable], [P.OSC1_PW, pw], [P.WT_USER, 0]],
      [36, 48],
    );
    check(
      `the ${name} wavetable bank stays inside its measured low-note floor`,
      values.every((v) => Number.isFinite(v) && v < bound),
      `${at([36, 48], values)} (worst ${worst.toFixed(1)} dB, ceiling ${bound}; at these pitches the engine's own 18 kHz filter sets the floor)`,
    );
  }

  // The player's own single cycle, the same saw §5 uses, through the same ruler.
  const sawCycle = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) {
    let sum = 0;
    for (let k = 1; k <= 1024; k++) sum += Math.sin((2 * Math.PI * k * i) / 2048) / k;
    sawCycle[i] = sum;
  }
  check('the review cycle imports', importWavetableCycle(sawCycle) === 0, 'code 0');
  const importedCycleFloor = floors(
    [[P.OSC1_WAVE, WAVE.wavetable], [P.WT_USER, 1]],
    [84, 96, 105, 108],
  );
  {
    const { values, worst } = importedCycleFloor;
    check(
      'an imported single cycle stays inside its measured high-note floor',
      values.every((v) => Number.isFinite(v) && v < -90),
      `${at([84, 96, 105, 108], values)} (worst ${worst.toFixed(1)} dB, ceiling -90)`,
    );
  }
  ex.gs_wavetable_clear();

  {
    const C7 = 96;
    const f0 = hz(C7);
    const rendered = renderFloor(
      [[P.OSC1_WAVE, WAVE.wavetable], [P.OSC1_PW, 0.5], [P.WT_USER, 0]],
      C7,
    );
    const fundamental = binMagHann(rendered, f0);
    // Gaps: 2093*4 = 8372 and 2093*5 = 10465, so 9000/9200/9500 Hz are 528/328/
    // 28 Hz from the nearest line and 1000+ Hz from the next one.
    const gaps = [9000, 9200, 9500].map(
      (f) => 20 * Math.log10(Math.max(binMagHann(rendered, f), 1e-30) / Math.max(fundamental, 1e-30)),
    );
    const worst = Math.max(...gaps);
    const bh7 = offGridFloor(rendered, f0);
    check(
      'the second ruler sees no floor between the wavetable harmonics',
      Number.isFinite(worst) && worst < -150 && bh7 < -95,
      `vocal bank at C7: BH-7 (whole off-grid spectrum) ${bh7.toFixed(1)} dB, Hann probes in the harmonic gaps ${gaps.map((v) => v.toFixed(1)).join(' / ')} dB below the fundamental at 9000/9200/9500 Hz (worst ${worst.toFixed(1)} dB, ceiling -150)`,
    );
  }
  {
    // The same probe on the sampler. The imported content is harmonics of
    // 375 Hz too, so at C7 every line lands on the same whole-Hz grid and the
    // gaps are just as empty; this is the P9.8 sampler floor seen by a ruler
    // that has nothing to do with the BH-7 one above (a single-frequency Hann
    // Goertzel rather than a whole-spectrum windowed transform).
    const C7 = 96;
    const f0 = hz(C7);
    const rendered = renderFloor(samplerPatch(SAMPLE_ROOT), C7);
    const fundamental = binMagHann(rendered, f0);
    const gaps = [9000, 9200, 9500].map(
      (f) => 20 * Math.log10(Math.max(binMagHann(rendered, f), 1e-30) / Math.max(fundamental, 1e-30)),
    );
    const worst = Math.max(...gaps);
    const bh7 = offGridFloor(rendered, f0);
    check(
      'the second ruler sees no floor between the sampler harmonics',
      Number.isFinite(worst) && worst < -120 && bh7 < -85,
      `sample at C7: BH-7 ${bh7.toFixed(1)} dB, Hann probes ${gaps.map((v) => v.toFixed(1)).join(' / ')} dB below the fundamental at 9000/9200/9500 Hz (worst ${worst.toFixed(1)} dB, ceiling -120)`,
    );
  }

  // The sampler, on the deterministic content imported above, at three notes
  // above 1 kHz (rate = note/root: 2.8, 5.6 and 11.2, so three different mip
  // levels and a fractional rate in every case). P9.8 brought this path inside
  // the P9.1b line (-86.4 dB worst against -60), and the ceiling is the measured
  // worst plus 5 dB.
  const sampleNotes = [84, 96, 108];
  {
    const { values, worst } = floors(samplerPatch(SAMPLE_ROOT), sampleNotes);
    check(
      'the sampler stays inside its measured high-note floor',
      values.every((v) => Number.isFinite(v) && v < -81),
      `${at(sampleNotes, values)} (worst ${worst.toFixed(1)} dB, ceiling -81: the measured worst plus 5 dB, against the -60 dB P9.1b line)`,
    );
  }

  // The top of the keyboard, where the mip tables are only a few hundred samples
  // long and a filter's edge-clamped region can cover a whole loop. This row is
  // what pins the chain's per-stage filter length: with 192 taps everywhere
  // 8372 Hz folds back to -58 dB, with the shorter late-stage filters it is
  // -81 dB. Without it that choice could be undone silently.
  {
    const topNotes = [114, 120];
    const { values, worst } = floors(samplerPatch(SAMPLE_ROOT), topNotes);
    check(
      'the sampler stays inside its measured top-note floor',
      values.every((v) => Number.isFinite(v) && v < -75),
      `${at(topNotes, values)} (worst ${worst.toFixed(1)} dB, ceiling -75: the measured worst plus 5 dB)`,
    );
  }

  // Below the root the sampler reads mip level 0, the recording itself at full
  // band. P9.8's interpolator is flat and DC-exact there, so this row is 40 dB
  // better than the cubic it replaced (-82.0 dB against -47.3 in §P9.7) rather
  // than the loose regression guard it used to be.
  {
    const lowNotes = [36, 48, 60];
    const { values, worst } = floors(samplerPatch(SAMPLE_ROOT), lowNotes);
    check(
      'the sampler stays inside its measured low-note floor',
      values.every((v) => Number.isFinite(v) && v < -77),
      `${at(lowNotes, values)} (worst ${worst.toFixed(1)} dB, ceiling -77: the measured worst plus 5 dB)`,
    );
  }

  // The calibration that makes the numbers readable: the same sample rooted at
  // A4 instead of 375 Hz plays its content off the note's grid, so the same
  // ruler reads it at 0 dB. Without this, a ruler that quietly measured nothing
  // would look exactly like a pass.
  {
    const misRooted = offGridFloor(renderFloor(samplerPatch(69), 96), hz(96));
    check(
      'the off-grid ruler does see a sample off the note grid',
      misRooted > -3,
      `${misRooted.toFixed(1)} dB at C7 with SMP_ROOT = A4 (the honest grid sits under -29)`,
    );
  }

  // Time domain alongside it: bounded peak, no NaN/Inf, and no step larger than
  // the signal's own bandwidth allows. A signal with peak P and no content above
  // Nyquist cannot step by more than pi*P per sample (Bernstein: |x'| <= 2*pi*
  // f_top*P, and f_top <= SR/2), so the bound is the source's own band rather
  // than a hand-picked number. The control below proves the metric can fail.
  const worstStep = (frames) => {
    let worst = 0;
    for (let i = 1; i < frames.length; i++) {
      const d = Math.abs(frames[i] - frames[i - 1]);
      if (d > worst) worst = d;
    }
    return worst;
  };
  const timeDomain = (name, extra, note) => {
    const frames = renderFloor(extra, note);
    let peak = 0;
    let finite = true;
    for (const v of frames) {
      finite = finite && Number.isFinite(v);
      peak = Math.max(peak, Math.abs(v));
    }
    const step = worstStep(frames);
    const bound = Math.PI * peak + 1e-6;
    check(
      `the ${name} stays bounded, finite and click-free`,
      finite && peak <= 1.0 + 1e-6 && step < bound,
      `peak ${peak.toFixed(3)}, largest step ${step.toFixed(4)} < ${bound.toFixed(3)} (pi x peak), ${frames.length} samples`,
    );
    return { frames, bound };
  };
  let clickControl = null;
  for (const [name, pw] of [['organ', 0], ['vocal', 0.5], ['glass', 1.0]]) {
    const result = timeDomain(
      `wavetable ${name} bank at C8`,
      [[P.OSC1_WAVE, WAVE.wavetable], [P.OSC1_PW, pw], [P.WT_USER, 0]],
      108,
    );
    if (name === 'vocal') clickControl = result;
  }
  timeDomain('imported cycle at C8', [[P.OSC1_WAVE, WAVE.wavetable], [P.WT_USER, 1]], 108);
  for (const note of sampleNotes) timeDomain(`sampler at note ${note}`, samplerPatch(SAMPLE_ROOT), note);
  // A gate that cannot fail is not a gate: one jammed sample has to trip the
  // same metric against the clean signal's own bound.
  {
    const broken = Float64Array.from(clickControl.frames);
    broken[broken.length >> 1] += 1.0;
    check(
      'the click detector can see a step that big',
      worstStep(broken) >= clickControl.bound,
      `one jammed sample steps ${worstStep(broken).toFixed(3)} against the clean ${clickControl.bound.toFixed(3)} bound`,
    );
  }

  // Leave the instrument state as the host found it: nothing after this reads
  // it, but a gate that silently leaves a sample loaded is a trap for the next
  // section someone adds.
  ex.gs_wavetable_clear();
  ex.gs_sample_clear();
}

console.log('[audio] quality gate');
for (const line of report) console.log(line);
// The verdict comes last on purpose: every section above reports into `report`,
// and one added at the end of the file would otherwise report into nothing.
if (failures.length) {
  console.error(`[audio] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
// P14.2: a green that hides an unjudged timing check is the bug this batch
// exists to kill, so when the host could not decide the CPU gate the verdict
// says it in words — with the load and the probe that made it say so. It is
// still an exit 0: a shared dev box or a CI runner must not go red because
// someone else was building.
if (timingNotJudged) {
  const { host } = timingNotJudged;
  console.log(
    `[audio] PASS (correctness only — timing not judged: load ${host.load.toFixed(1)} on ${host.cpus} cpus, ` +
      `cpu probe ${host.probeUs.toFixed(0)} µs vs ${PROBE_REFERENCE_US} µs idle)`,
  );
  console.log(`[audio]   ↳ ${timingNotJudged.name}: ${timingNotJudged.reason}`);
} else {
  console.log('[audio] PASS');
}
