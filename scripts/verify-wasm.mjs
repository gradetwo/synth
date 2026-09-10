#!/usr/bin/env node
/**
 * End-to-end verification of the compiled WASM core in Node (no browser needed).
 *
 * Covers the prd.md quality gates that can be checked without an audio device:
 *   - frequency accuracy (zero-crossing measurement)
 *   - dynamic block sizes 128..1024
 *   - polyphony cap and smooth downgrade
 *   - zero heap allocation during `gs_process`
 *   - spectrum analysis produces energy
 *   - note-off returns to silence
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, process.argv[2] ?? 'src/generated/synth_core.wasm');
if (!existsSync(wasmPath)) {
  console.error(`[verify] ${wasmPath} missing — run "npm run build:wasm" first`);
  process.exit(1);
}

const instance = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {});
const ex = instance.exports;

const Param = {
  MASTER_VOLUME: 0, OSC1_ON: 1, OSC1_WAVE: 2, OSC1_PITCH: 3, OSC1_DETUNE: 4, OSC1_LEVEL: 5,
  OSC2_ON: 7, OSC2_LEVEL: 11, FILTER_TYPE: 13, FILTER_CUTOFF: 14, FILTER_RES: 15,
  FILTER_DRIVE: 16, FILTER_ENV_AMT: 17, FILTER_KBD: 18, ENV_ATTACK: 19, ENV_DECAY: 20,
  ENV_SUSTAIN: 21, ENV_RELEASE: 22, LFO_ON: 23, FX_REVERB_ON: 29, FX_REVERB_MIX: 31,
  FX_DELAY_ON: 32, FX_DELAY_MIX: 35,
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const peak = (ptr, frames) => {
  const view = new Float32Array(ex.memory.buffer, ptr, frames);
  let m = 0;
  for (const v of view) m = Math.max(m, Math.abs(v));
  return m;
};

console.log('[verify] WASM core');

// Bump this together with `ABI_VERSION` in crates/synth-core/src/abi.rs.
check('ABI version', ex.gs_abi_version() === 2, `v${ex.gs_abi_version()}`);
check('exposes the meter exports', typeof ex.gs_take_true_peak === 'function' && typeof ex.gs_loudness_rms === 'function');
check('max block size is 1024', ex.gs_max_block_size() === 1024);
check('voice pool is 32', ex.gs_max_voices() === 32);
check('spectrum exposes 36 bins', ex.gs_spectrum_bins() === 36);

// The C++ layer must not need dynamic initialization.
//
// This is the guard for a bug that only existed in wasm and cost days:
// in-class member initialisers in a vendored class made the global voice array
// require a C++ global constructor, and because this module is linked as a
// *command* module wasm-ld wraps every exported call in a shim that re-runs
// `__wasm_call_ctors` — so every `gs_*` call silently reset filter state, which
// showed up as a click at every render-block boundary. Native never saw it
// (ELF runs `.init_array` once). See docs/notes/wasm-ladder-root-cause.md.
{
  const raw = readFileSync(wasmPath);
  const text = raw.toString('latin1');
  const ctors = text.includes('__wasm_call_ctors');
  const globals = text.includes('_GLOBAL__sub_I');
  check(
    'no C++ global constructors in the core',
    !ctors && !globals,
    ctors || globals
      ? 'a dynamically-initialised global would be re-initialised on every call'
      : 'static initialization only',
  );
}

// ---------------------------------------------------------------- frequency
ex.gs_init(48000, 16);
ex.gs_set_param(Param.OSC1_ON, 1);
ex.gs_set_param(Param.OSC1_WAVE, 0); // sine
ex.gs_set_param(Param.OSC1_LEVEL, 1);
ex.gs_set_param(Param.OSC1_DETUNE, 0);
ex.gs_set_param(Param.OSC2_ON, 0);
ex.gs_set_param(Param.FILTER_TYPE, 0);
ex.gs_set_param(Param.FILTER_CUTOFF, 20000);
ex.gs_set_param(Param.FILTER_RES, 0);
ex.gs_set_param(Param.FILTER_ENV_AMT, 0);
ex.gs_set_param(Param.ENV_ATTACK, 0.001);
ex.gs_set_param(Param.ENV_SUSTAIN, 1);
ex.gs_set_param(Param.LFO_ON, 0);
ex.gs_set_param(Param.FX_REVERB_ON, 0);
ex.gs_set_param(Param.FX_DELAY_ON, 0);

const measureHz = (midi, block) => {
  ex.gs_all_notes_off();
  ex.gs_note_on(midi, 1);
  // settle
  for (let i = 0; i < 40; i++) ex.gs_process(block);
  let crossings = 0;
  let samples = 0;
  // Schmitt-trigger zero crossing: reject filter/DC-blocker ripple near zero.
  let armed = true;
  const HI = 0.04;
  const LO = -0.04;
  const blocks = Math.ceil(48000 / block);
  for (let b = 0; b < blocks; b++) {
    ex.gs_process(block);
    const view = new Float32Array(ex.memory.buffer, ex.gs_left_ptr(), block);
    for (const v of view) {
      if (armed && v > HI) {
        crossings += 1;
        armed = false;
      } else if (!armed && v < LO) {
        armed = true;
      }
      samples += 1;
    }
  }
  ex.gs_note_off(midi);
  return (crossings * 48000) / samples;
};

const hzA4 = measureHz(69, 128);
check('440 Hz accuracy (block 128)', Math.abs(hzA4 - 440) < 1.5, `${hzA4.toFixed(2)} Hz`);
const hzA4b = measureHz(69, 512);
check('440 Hz accuracy (block 512)', Math.abs(hzA4b - 440) < 1.5, `${hzA4b.toFixed(2)} Hz`);
const hzC4 = measureHz(60, 256);
check('C4 261.63 Hz accuracy', Math.abs(hzC4 - 261.63) < 1.5, `${hzC4.toFixed(2)} Hz`);

// ------------------------------------------------------- block sizes + audio
for (const block of [128, 256, 512, 1024]) {
  ex.gs_all_notes_off();
  ex.gs_note_on(60, 1);
  let m = 0;
  for (let i = 0; i < 60; i++) {
    ex.gs_process(block);
    m = Math.max(m, peak(ex.gs_left_ptr(), block));
  }
  check(`renders block size ${block}`, m > 0.05, `peak ${m.toFixed(3)}`);
}

// ------------------------------------------------------------- zero alloc
ex.gs_reset_alloc_violations();
const before = ex.gs_alloc_count();
for (let i = 0; i < 400; i++) ex.gs_process(128);
check('no allocation during process', ex.gs_alloc_count() === before, `count ${before}`);
check('no allocation violations', ex.gs_alloc_violations() === 0);

// --------------------------------------------------------------- spectrum
ex.gs_note_on(69, 1);
for (let i = 0; i < 60; i++) ex.gs_process(128);
const bins = new Float32Array(ex.memory.buffer, ex.gs_spectrum_ptr(), ex.gs_spectrum_bins());
check('spectrum shows energy', Math.max(...bins) > 0.1, `max ${Math.max(...bins).toFixed(3)}`);

// -------------------------------------------------------------- polyphony
ex.gs_all_notes_off();
for (let n = 0; n < 20; n++) ex.gs_note_on(48 + n, 0.8);
ex.gs_process(128);
check('polyphony capped at 16', ex.gs_active_voices() <= 16, `${ex.gs_active_voices()} voices`);
ex.gs_trigger_smooth_downgrade();
for (let i = 0; i < 40; i++) ex.gs_process(128);
check('smooth downgrade does not crash', ex.gs_active_voices() <= 16);

// ----------------------------------------------------------------- silence
ex.gs_all_notes_off();
for (let i = 0; i < 400; i++) ex.gs_process(128);
check('returns to silence after note-off', peak(ex.gs_left_ptr(), 128) < 1e-4);

console.log(failures === 0 ? '\n[verify] PASS' : `\n[verify] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
