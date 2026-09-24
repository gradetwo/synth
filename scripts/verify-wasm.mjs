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
check('ABI version', ex.gs_abi_version() === 9, `v${ex.gs_abi_version()}`);
check('exposes the meter exports', typeof ex.gs_take_true_peak === 'function' && typeof ex.gs_loudness_rms === 'function');
check(
  'exposes the second instance',
  typeof ex.gs_set_param_inst === 'function' &&
    typeof ex.gs_set_instance_route === 'function' &&
    typeof ex.gs_instance_voices === 'function',
);
check(
  'exposes the sample import',
  typeof ex.gs_sample_import === 'function' &&
    typeof ex.gs_sample_import_ptr === 'function' &&
    typeof ex.gs_sample_clear === 'function' &&
    typeof ex.gs_sample_has === 'function' &&
    ex.gs_sample_capacity() > 0,
);
check(
  'exposes the impulse-response import',
  typeof ex.gs_ir_import === 'function' &&
    typeof ex.gs_ir_import_ptr === 'function' &&
    typeof ex.gs_ir_clear === 'function' &&
    typeof ex.gs_ir_has === 'function' &&
    ex.gs_ir_capacity() > 0,
);
check(
  'exposes the wavetable import',
  typeof ex.gs_wavetable_import === 'function' &&
    typeof ex.gs_wavetable_import_ptr === 'function' &&
    typeof ex.gs_wavetable_clear === 'function' &&
    typeof ex.gs_wavetable_has === 'function' &&
    ex.gs_wavetable_capacity() > 0,
);
check(
  'exposes the effect routing graph',
  typeof ex.gs_fx_graph_sync === 'function',
);
check(
  'every effect node has its own state slot',
  ex.gs_fx_slot_count() === 6,
  `slots ${ex.gs_fx_slot_count()}`,
);
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

// P7.1: the delay and convolution pools have to fit a second node of each kind,
// and report how much of the (message-path allocated) pool is in use.
check(
  'the delay pool fits a second node',
  typeof ex.gs_delay_pool_capacity === 'function' &&
    typeof ex.gs_delay_pool_used === 'function' &&
    typeof ex.gs_delay_max_seconds === 'function' &&
    ex.gs_delay_pool_capacity() >= 2 &&
    ex.gs_delay_max_seconds() > 0 &&
    ex.gs_delay_pool_used() <= ex.gs_delay_pool_capacity(),
  `${ex.gs_delay_pool_used()}/${ex.gs_delay_pool_capacity()} × ${ex.gs_delay_max_seconds()}s`,
);
check(
  'the convolution pool fits a second node',
  typeof ex.gs_conv_pool_capacity === 'function' &&
    typeof ex.gs_conv_pool_used === 'function' &&
    ex.gs_conv_pool_capacity() >= 2 &&
    ex.gs_conv_pool_used() <= ex.gs_conv_pool_capacity(),
  `${ex.gs_conv_pool_used()}/${ex.gs_conv_pool_capacity()}`,
);
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

// --------------------------------------------------- effect routing graph
// The graph may only ever be an alternative way of saying what the chain says:
// deriving it from the current chain has to render the same samples.
{
  const chain = [1, 2, 3, 4, 5, 6];
  const patch = (core) => {
    for (const [id, value] of [
      [Param.MASTER_VOLUME, 0.8], [1, 1], [2, 2], [5, 0.8], [7, 0], [14, 16000], [17, 0],
      [19, 0.002], [21, 1], [23, 0], [29, 1], [31, 0.3], [32, 1], [35, 0.25], [43, 1],
      [46, 0.5], [47, 1], [50, 0.4], [51, 1], [54, 0.4], [55, 1], [57, 0.5], [100, 0],
    ]) {
      core.gs_set_param(id, value);
    }
    chain.forEach((kind, slot) => core.gs_set_param(82 + slot, kind));
  };
  const renderGraph = (core) => {
    core.gs_all_notes_off();
    core.gs_note_on(60, 0.9);
    const out = [];
    for (let block = 0; block < 30; block++) {
      core.gs_process(128);
      const view = new Float32Array(core.memory.buffer, core.gs_left_ptr(), 128);
      out.push(...view);
    }
    return out;
  };

  // A fresh instance per variant: the DSP keeps its delay lines and reverb
  // tail across `gs_init`, and a leftover tail would show up as a difference
  // that has nothing to do with the routing.
  const fresh = () =>
    new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {}).exports;
  const legacy = (() => {
    const core = fresh();
    core.gs_init(48000, 16);
    patch(core);
    return renderGraph(core);
  })();
  const graph = (() => {
    const core = fresh();
    core.gs_init(48000, 16);
    patch(core);
    core.gs_fx_graph_sync();
    return renderGraph(core);
  })();
  let worst = 0;
  for (let i = 0; i < legacy.length; i++) worst = Math.max(worst, Math.abs(legacy[i] - graph[i]));
  check(
    'the routing graph renders exactly the chain it came from',
    worst === 0 && legacy.some((v) => Math.abs(v) > 0.01),
    `worst sample difference ${worst}`,
  );
}

// ------------------------------------------------------- per-note stereo pan
// The player pans each song layer, so a note-on can carry a stereo position.
{
  const rms = (ptr, frames) => {
    const samples = new Float32Array(ex.memory.buffer, ptr, frames);
    let sum = 0;
    for (const v of samples) sum += v * v;
    return Math.sqrt(sum / frames);
  };
  // A dry mono patch: a stereo effect would spread the image on its own and
  // hide whether the pan did anything.
  for (const [id, value] of [
    [Param.OSC1_WAVE, 2], [Param.OSC1_PAN, 0], [Param.FX_REVERB_ON, 0],
    [Param.FX_DELAY_ON, 0], [43, 0], [47, 0], [51, 0], [55, 0], [Param.MASTER_VOLUME, 0.8],
    // A short release so the previous check's note is gone before this one
    // starts: a ringing tail is a centred voice mixed into the measurement.
    [Param.ENV_RELEASE, 0.01],
  ]) {
    ex.gs_set_param(id, value);
  }
  const renderPan = (pan) => {
    ex.gs_all_notes_off();
    for (let i = 0; i < 80; i++) ex.gs_process(128);
    ex.gs_note_on_pan(60, 1, pan);
    let l = 0;
    let r = 0;
    for (let i = 0; i < 40; i++) {
      ex.gs_process(128);
      l = Math.max(l, rms(ex.gs_left_ptr(), 128));
      r = Math.max(r, rms(ex.gs_right_ptr(), 128));
    }
    return { l, r };
  };
  const left = renderPan(-0.9);
  check('a note panned left stays left', left.l > left.r * 4, `L ${left.l.toFixed(3)} R ${left.r.toFixed(3)}`);
  const right = renderPan(0.9);
  check('a note panned right stays right', right.r > right.l * 4, `L ${right.l.toFixed(3)} R ${right.r.toFixed(3)}`);
  const centre = renderPan(0);
  check(
    'a centred note stays balanced',
    centre.l / centre.r > 0.9 && centre.l / centre.r < 1.1,
    `L/R ${(centre.l / centre.r).toFixed(3)}`,
  );
  ex.gs_all_notes_off();
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
