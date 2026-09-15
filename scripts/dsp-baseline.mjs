#!/usr/bin/env node
/**
 * DSP regression baseline.
 *
 * Renders a fixed, deterministic patch through the WASM core and fingerprints
 * the result (RMS + 12 log-spaced band magnitudes). The committed baseline in
 * `tests/dsp-baseline.json` catches unintended sound changes: run with
 * `--update` after an intentional DSP change.
 *
 * P6.5 added a second mode, so there are two fingerprints: the default 1x path
 * (`tests/dsp-baseline.json`) and the oversampled one
 * (`tests/dsp-baseline-2x.json`, selected with `--oversampled`, wired up as
 * `npm run verify:dsp:2x`). Both are hard gates — a change to either mode has
 * to be acknowledged explicitly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'src/generated/synth_core.wasm');
const update = process.argv.includes('--update');
const oversampled = process.argv.includes('--oversampled');
const baselinePath = resolve(
  root,
  oversampled ? 'tests/dsp-baseline-2x.json' : 'tests/dsp-baseline.json',
);

if (!existsSync(wasmPath)) {
  console.error('[dsp] src/generated/synth_core.wasm missing — run "npm run build:wasm"');
  process.exit(1);
}

const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {}).exports;
const SR = 48000;
const BLOCK = 128;
const SECONDS = 2;

const P = {
  MASTER_VOLUME: 0, OSC1_ON: 1, OSC1_WAVE: 2, OSC1_PITCH: 3, OSC1_DETUNE: 4, OSC1_LEVEL: 5,
  OSC2_ON: 7, OSC2_LEVEL: 11, FILTER_TYPE: 13, FILTER_CUTOFF: 14, FILTER_RES: 15,
  FILTER_DRIVE: 16, FILTER_ENV_AMT: 17, FILTER_KBD: 18, ENV_ATTACK: 19, ENV_DECAY: 20,
  ENV_SUSTAIN: 21, ENV_RELEASE: 22, LFO_ON: 23, FX_REVERB_ON: 29, FX_DELAY_ON: 32,
  VOICE_MODE: 42, LFO2_ON: 62, OVERSAMPLE: 166,
};

ex.gs_init(SR, 16);
for (const [id, value] of [
  [P.MASTER_VOLUME, 1], [P.OSC1_ON, 1], [P.OSC1_WAVE, 2], [P.OSC1_DETUNE, 0], [P.OSC1_LEVEL, 0.8],
  [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0], [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 5000],
  [P.FILTER_RES, 0.3], [P.FILTER_DRIVE, 0.2], [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0],
  [P.ENV_ATTACK, 0.001], [P.ENV_DECAY, 0.1], [P.ENV_SUSTAIN, 1], [P.ENV_RELEASE, 0.2],
  [P.LFO_ON, 0], [P.LFO2_ON, 0], [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.VOICE_MODE, 0],
  [P.OVERSAMPLE, oversampled ? 1 : 0],
]) {
  ex.gs_set_param(id, value);
}

const samples = new Float32Array(SR * SECONDS);
ex.gs_note_on(69, 1);
let offset = 0;
for (let b = 0; b < (SR * SECONDS) / BLOCK; b++) {
  ex.gs_process(BLOCK);
  const view = new Float32Array(ex.memory.buffer, ex.gs_left_ptr(), BLOCK);
  samples.set(view, offset);
  offset += BLOCK;
}
ex.gs_note_off(69);

// Fingerprint the steady-state second.
const window = samples.subarray(SR, SR + 8192);
let rms = 0;
for (const x of window) rms += x * x;
rms = Math.sqrt(rms / window.length);

const BANDS = [80, 160, 320, 640, 1280, 2560, 5120, 10240, 200, 500, 1000, 4000];
const goertzel = (data, freq, sampleRate) => {
  const k = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(k);
  let s0;
  let s1 = 0;
  let s2 = 0;
  for (const x of data) {
    s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / data.length;
};
const bands = BANDS.map((f) => Number(goertzel(window, f, SR).toFixed(6)));
const fingerprint = { rms: Number(rms.toFixed(6)), bands };

if (update || !existsSync(baselinePath)) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(fingerprint, null, 2)}\n`);
  console.log(
    `[dsp${oversampled ? ' 2x' : ''}] baseline written (${update ? '--update' : 'first run'})`,
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const tolerance = 1e-4;
const diffs = [];
if (Math.abs(baseline.rms - fingerprint.rms) > tolerance) {
  diffs.push(`rms ${baseline.rms} -> ${fingerprint.rms}`);
}
baseline.bands.forEach((value, i) => {
  if (Math.abs(value - fingerprint.bands[i]) > tolerance) {
    diffs.push(`band ${BANDS[i]}Hz ${value} -> ${fingerprint.bands[i]}`);
  }
});

if (diffs.length) {
  console.error(`[dsp${oversampled ? ' 2x' : ''}] REGRESSION detected:`);
  for (const d of diffs) console.error(`  ${d}`);
  const script = oversampled ? 'npm run verify:dsp:2x' : 'npm run test:dsp';
  console.error(`[dsp] if the change is intentional, run: ${script} -- --update`);
  process.exit(1);
}
console.log(
  `[dsp${oversampled ? ' 2x' : ''}] baseline OK · rms ${fingerprint.rms} · ${bands.length} bands`,
);
