#!/usr/bin/env node
/**
 * Generate the Rust preset/parameter tables for the VST3 plugin from the
 * TypeScript sources (single source of truth).
 *
 * Usage:
 *   node scripts/gen-vst3-presets.mjs           # write crates/synth-vst3/src/generated.rs
 *   node scripts/gen-vst3-presets.mjs --check   # fail if generated.rs is out of date
 *
 * Method (same technique as scripts/verify-presets.mjs): bundle a small entry
 * with esbuild (alias @ -> src) and evaluate it, so the generator reads the
 * real TS values instead of parsing TS text. esbuild comes from `npm ci`
 * (vite ships it); ESBUILD_PATH may point at an esbuild package directory
 * instead (used on machines without node_modules installed).
 *
 * Hard checks (any failure exits non-zero, nothing is written):
 * - TS Param enum values == Rust params.rs `id` constants == 0..223.
 * - PARAM_NAMES covers all 224 ids; cleaned Rust field names are unique.
 * - Every default and every preset overlay value lies inside its emitted range.
 * - Discrete Int parameters have integer defaults and overlays.
 * - Factory presets carry no custom routes / params2 / instanceMode (the
 *   plugin applies DEFAULT_ROUTES to every preset; a preset that gains one
 *   must extend the plugin first, not silently drop it).
 * - The TS->Rust modulation-route code mapping tables cover exactly the
 *   TS MOD_SOURCES / MOD_DESTS keys (the two orders differ; see the README).
 */
import { mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'crates/synth-vst3/src/generated.rs');
const checkOnly = process.argv.includes('--check');

const fail = (msg) => {
  console.error(`gen-vst3-presets: FAIL: ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------- esbuild
let esbuildBuild;
try {
  ({ build: esbuildBuild } = await import('esbuild'));
} catch {
  let fallback = process.env.ESBUILD_PATH;
  if (!fallback) {
    console.error(
      'gen-vst3-presets: esbuild is required — run "npm ci" or set ESBUILD_PATH',
    );
    process.exit(1);
  }
  // ESM cannot import a directory: a package directory means lib/main.js.
  if (!fallback.endsWith('.js')) fallback = join(fallback, 'lib', 'main.js');
  ({ build: esbuildBuild } = await import(pathToFileURL(fallback).href));
}

// ------------------------------------------------------------------ input
const tmp = await mkdtemp(join(tmpdir(), 'gen-vst3-'));
const entryPath = join(tmp, 'entry.mjs');
const bundlePath = join(tmp, 'bundle.mjs');
await writeFile(
  entryPath,
  `import { Param, PARAM_NAMES, PARAM_SPECS, DEFAULT_PARAMS, DEFAULT_ROUTES,
          DISCRETE_PARAMS, WAVES, FILTER_TYPES, LFO_WAVES, LFO_TARGETS,
          MOD_SOURCES, MOD_DESTS, FX_KINDS, DELAY_SYNCS } from '@/audio/params';
   import { FACTORY_PRESETS } from '@/state/presets';
   export { Param, PARAM_NAMES, PARAM_SPECS, DEFAULT_PARAMS, DEFAULT_ROUTES,
            DISCRETE_PARAMS, WAVES, FILTER_TYPES, LFO_WAVES, LFO_TARGETS,
            MOD_SOURCES, MOD_DESTS, FX_KINDS, DELAY_SYNCS, FACTORY_PRESETS };`,
);
await esbuildBuild({
  entryPoints: [entryPath],
  bundle: true,
  alias: { '@': join(root, 'src') },
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
});
const ts = await import(pathToFileURL(bundlePath).href);
await rm(tmp, { recursive: true, force: true });

// ------------------------------------------------------- TS Param enum
// A TS numeric enum object also carries reverse mappings (number -> name);
// keep only NAME -> number entries.
const tsParams = {};
for (const [k, v] of Object.entries(ts.Param)) {
  if (/^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === 'number') tsParams[k] = v;
}
const tsIds = Object.values(tsParams).sort((a, b) => a - b);
if (tsIds.length !== 224 || tsIds.some((id, i) => id !== i)) {
  fail(`TS Param ids are not exactly 0..223 (got ${tsIds.length} entries)`);
}

// ------------------------------------------------------- Rust id check
const paramsRs = await readFile(
  join(root, 'crates/synth-core/src/params.rs'),
  'utf8',
);
const rustIds = new Map();
for (const [, name, value] of paramsRs.matchAll(
  /pub const ([A-Z][A-Z0-9_]*): u32 = (\d+);/g,
)) {
  const n = Number(value);
  if (rustIds.has(name) && rustIds.get(name) !== n) {
    fail(`Rust id constant ${name} is defined twice with different values`);
  }
  rustIds.set(name, n);
}
// One naming family differs: TS enumerates graph nodes per node
// (FX_NODE1_IN1 .. FX_NODE6_OUT_GAIN) while Rust keeps a base constant per
// field (FX_NODE_IN1 = 101, …) plus a node offset. Map those explicitly.
const rustIdFor = (name) => {
  if (rustIds.has(name)) return rustIds.get(name);
  const m = /^FX_NODE([1-6])_(IN1_GAIN|IN2_GAIN|TO_OUT|OUT_GAIN|IN1|IN2)$/.exec(name);
  if (m) {
    const base = rustIds.get(`FX_NODE_${m[2]}`);
    if (base !== undefined) return base + (Number(m[1]) - 1);
  }
  return undefined;
};
for (const [name, id] of Object.entries(tsParams)) {
  const rust = rustIdFor(name);
  if (rust === undefined) fail(`TS Param ${name} has no Rust id constant`);
  if (rust !== id) {
    fail(`TS Param ${name} = ${id} but Rust id constant = ${rust}`);
  }
}

// ------------------------------------------------------------ spec table
const specById = new Map();
for (const spec of ts.PARAM_SPECS) {
  if (specById.has(spec.id)) fail(`duplicate PARAM_SPECS entry for id ${spec.id}`);
  specById.set(spec.id, spec);
}

// Coverage ranges for ids without PARAM_SPECS. [min, max, evidence].
// The generator prefers PARAM_SPECS when present; these are fallback only.
const COVERAGE = {
  // Enum lengths from the TS enum tables.
  2: [0, 9, 'WAVES len 10'],
  8: [0, 9, 'WAVES len 10'],
  13: [0, 6, 'FILTER_TYPES len 7'],
  147: [0, 6, 'FILTER_TYPES len 7'],
  24: [0, 3, 'LFO_WAVES len 4'],
  63: [0, 3, 'LFO_WAVES len 4'],
  27: [0, 3, 'LFO_TARGETS len 4'],
  66: [0, 3, 'LFO_TARGETS len 4'],
  82: [0, 9, 'FX_KINDS len 10'],
  83: [0, 9, 'FX_KINDS len 10'],
  84: [0, 9, 'FX_KINDS len 10'],
  85: [0, 9, 'FX_KINDS len 10'],
  86: [0, 9, 'FX_KINDS len 10'],
  87: [0, 9, 'FX_KINDS len 10'],
  88: [0, 1, 'parallel on/off'],
  89: [0, 1, 'parallel on/off'],
  90: [0, 1, 'parallel on/off'],
  91: [0, 1, 'parallel on/off'],
  92: [0, 1, 'parallel on/off'],
  93: [0, 1, 'parallel on/off'],
  // Rust set() clamps / thresholds in crates/synth-core/src/params.rs.
  37: [20, 300, 'params.rs TEMPO clamp'],
  38: [0, 24, 'params.rs PITCH_BEND_RANGE clamp'],
  41: [-24, 24, 'params.rs MASTER_TUNE clamp'],
  42: [0, 2, 'params.rs VOICE_MODE min(2)'],
  78: [0, 8, 'params.rs PATCH_GAIN clamp'],
  94: [0, 1, 'params.rs reverb_mode threshold >= 0.5'],
  95: [0, 4, 'params.rs conv_trim clamp'],
  96: [0, 127, 'params.rs sample_root clamp'],
  97: [0, 2, 'params.rs sample_mode min(2)'],
  98: [0, 1, 'params.rs clamp01'],
  99: [0, 1, 'params.rs clamp01'],
  100: [0, 1, 'params.rs graph threshold >= 0.5'],
  145: [0, 1, 'params.rs clamp01'],
  146: [0, 2, 'params.rs FilterRouting::from_u32'],
  151: [0, 1, 'params.rs clamp01'],
  166: [0, 1, 'params.rs oversample threshold > 0.5'],
  179: [0, 1, 'params.rs transient_on threshold > 0.5'],
  // Graph node sources: 0 = nothing, 1 = dry bus, 2..=7 = nodes 1..=6.
  101: [0, 7, 'params.rs graph src codes'],
  102: [0, 7, 'params.rs graph src codes'],
  103: [0, 7, 'params.rs graph src codes'],
  104: [0, 7, 'params.rs graph src codes'],
  105: [0, 7, 'params.rs graph src codes'],
  106: [0, 7, 'params.rs graph src codes'],
  113: [0, 7, 'params.rs graph src codes'],
  114: [0, 7, 'params.rs graph src codes'],
  115: [0, 7, 'params.rs graph src codes'],
  116: [0, 7, 'params.rs graph src codes'],
  117: [0, 7, 'params.rs graph src codes'],
  118: [0, 7, 'params.rs graph src codes'],
  107: [0, 1, 'graph gain'],
  108: [0, 1, 'graph gain'],
  109: [0, 1, 'graph gain'],
  110: [0, 1, 'graph gain'],
  111: [0, 1, 'graph gain'],
  112: [0, 1, 'graph gain'],
  119: [0, 1, 'graph gain'],
  120: [0, 1, 'graph gain'],
  121: [0, 1, 'graph gain'],
  122: [0, 1, 'graph gain'],
  123: [0, 1, 'graph gain'],
  124: [0, 1, 'graph gain'],
  125: [0, 1, 'graph to_out'],
  126: [0, 1, 'graph to_out'],
  127: [0, 1, 'graph to_out'],
  128: [0, 1, 'graph to_out'],
  129: [0, 1, 'graph to_out'],
  130: [0, 1, 'graph to_out'],
  131: [0, 1, 'graph out_gain'],
  132: [0, 1, 'graph out_gain'],
  133: [0, 1, 'graph out_gain'],
  134: [0, 1, 'graph out_gain'],
  135: [0, 1, 'graph out_gain'],
  136: [0, 1, 'graph out_gain'],
  // Modulation-bus slots (P9.3).
  167: [0, 7, 'MOD_SOURCES len 8'],
  170: [0, 7, 'MOD_SOURCES len 8'],
  173: [0, 7, 'MOD_SOURCES len 8'],
  176: [0, 7, 'MOD_SOURCES len 8'],
  168: [0, 18, 'graphModDst 1-based 1..18, 0 = off'],
  171: [0, 18, 'graphModDst 1-based 1..18, 0 = off'],
  174: [0, 18, 'graphModDst 1-based 1..18, 0 = off'],
  177: [0, 18, 'graphModDst 1-based 1..18, 0 = off'],
  169: [-1, 1, 'params.rs ovr_depth clamp'],
  172: [-1, 1, 'params.rs ovr_depth clamp'],
  175: [-1, 1, 'params.rs ovr_depth clamp'],
  178: [-1, 1, 'params.rs ovr_depth clamp'],
  // Override pool: node values are stored raw, default is FX_OVR_UNSET (-2).
  183: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  184: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  185: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  186: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  187: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  188: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  189: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  190: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  191: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  192: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  193: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  194: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  195: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  196: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  197: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  198: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  199: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  200: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  201: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  202: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  203: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  204: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  205: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  206: [-2, 1, 'FX_OVR_UNSET -2 + kind values'],
  207: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  208: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  209: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  210: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  211: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  212: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  213: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  214: [0, 24, 'params.rs ovr_target_code 0..=FX_OVR_POOL'],
  215: [-1, 1, 'params.rs ovr_depth clamp'],
  216: [-1, 1, 'params.rs ovr_depth clamp'],
  217: [-1, 1, 'params.rs ovr_depth clamp'],
  218: [-1, 1, 'params.rs ovr_depth clamp'],
  219: [-1, 1, 'params.rs ovr_depth clamp'],
  220: [-1, 1, 'params.rs ovr_depth clamp'],
  221: [-1, 1, 'params.rs ovr_depth clamp'],
  222: [-1, 1, 'params.rs ovr_depth clamp'],
  223: [0, 3, 'params.rs ovr_src min(3)'],
  // On/off + sync switches: engine thresholds (> 0.5) in params.rs.
  1: [0, 1, 'osc1 on/off'],
  7: [0, 1, 'osc2 on/off'],
  18: [0, 1, 'params.rs kbd threshold > 0.5'],
  23: [0, 1, 'lfo on/off'],
  28: [0, 1, 'params.rs lfo sync threshold > 0.5'],
  29: [0, 1, 'reverb on/off'],
  32: [0, 1, 'delay on/off'],
  33: [0, 3, 'DELAY_SYNCS len 4'],
  43: [0, 1, 'chorus on/off'],
  47: [0, 1, 'flanger on/off'],
  51: [0, 1, 'phaser on/off'],
  55: [0, 1, 'drive on/off'],
  62: [0, 1, 'lfo2 on/off'],
  74: [0, 1, 'params.rs retrig threshold > 0.5'],
  75: [0, 1, 'params.rs oneshot threshold > 0.5'],
  76: [0, 1, 'params.rs retrig threshold > 0.5'],
  77: [0, 1, 'params.rs oneshot threshold > 0.5'],
  79: [0, 1, 'params.rs wt_user threshold >= 0.5'],
  // Generic fallbacks (only used if PARAM_SPECS lacks the id).
  0: [0, 1, 'gain'],
  36: [0, 1, 'glide 0..1'],
  80: [0, 1, 'params.rs clamp01'],
  81: [0, 1, 'pingpong on/off'],
  144: [0, 1, 'noise mix'],
  152: [0, 1, 'crush on/off'],
  153: [4, 16, 'crush bits'],
  154: [1, 64, 'params.rs crush_down clamp'],
  155: [0, 1, 'params.rs clamp01'],
  156: [0, 1, 'crush mix'],
  157: [0, 1, 'eq on/off'],
  158: [-18, 18, 'params.rs eq gain clamp'],
  159: [40, 1000, 'params.rs eq freq clamp'],
  160: [-18, 18, 'params.rs eq gain clamp'],
  161: [40, 10000, 'eq mid freq'],
  162: [0.3, 6, 'params.rs eq mid q clamp'],
  163: [-18, 18, 'params.rs eq gain clamp'],
  164: [1000, 20000, 'eq high freq'],
  165: [0, 1, 'eq mix'],
};

// ------------------------------------------------------- route code maps
// TS order (MOD_SOURCES / MOD_DESTS) differs from Rust ModSrc::from_u32 /
// ModDst::from_u32 order in the lfo2/env/modwheel/velocity slots. The plugin
// must emit Rust codes; these tables are the conversion, checked against the
// TS tables below so a TS reorder fails loudly instead of misrouting.
const SRC_RUST = {
  lfo: 0,
  env: 1,
  modwheel: 2,
  velocity: 3,
  lfo2: 4,
  aftertouch: 5,
  random: 6,
  keytrack: 7,
};
const DST_RUST = {
  cutoff: 0,
  pitch: 1,
  volume: 2,
  pwm: 3,
  pan: 4,
  res: 5,
  fm: 6,
  ring: 7,
};
if (Object.keys(SRC_RUST).sort().join() !== [...ts.MOD_SOURCES].sort().join()) {
  fail('SRC_RUST keys drifted from TS MOD_SOURCES');
}
if (Object.keys(DST_RUST).sort().join() !== [...ts.MOD_DESTS].sort().join()) {
  fail('DST_RUST keys drifted from TS MOD_DESTS');
}
const routes = ts.DEFAULT_ROUTES.map((r) => {
  if (!(r.src in SRC_RUST) || !(r.dst in DST_RUST)) {
    fail(`unknown route ${r.src} -> ${r.dst}`);
  }
  return [SRC_RUST[r.src], DST_RUST[r.dst], r.amount, r.enabled];
});

// ------------------------------------------------------------ param rows
const RUST_KEYWORDS = new Set(
  'as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn abstract become box do final macro override priv typeof unsized virtual yield try union'.split(
    ' ',
  ),
);
const cleanField = (name) => {
  let f = /^[A-Za-z_]/.test(name) ? name : `_${name}`;
  f = f.replace(/[^A-Za-z0-9_]/g, '_');
  if (RUST_KEYWORDS.has(f)) f += '_';
  return f;
};

// Engine-acceptance overrides: the emitted range must cover everything the
// engine can actually receive, so preset switching is lossless. The web UI
// knob range (PARAM_SPECS) is narrower for pitch/detune than the engine
// clamp, and factory presets use values outside the knob range (phonk sets
// osc2Pitch to 31). params.rs arms: pitch clamp(-48, 48), detune clamp(-100, 100).
const OVERRIDES = {
  3: [-48, 48],
  9: [-48, 48],
  4: [-100, 100],
  10: [-100, 100],
};

const rows = [];
const seenFields = new Set();
let specCount = 0;
let coverageCount = 0;
const missingRange = [];
for (let id = 0; id < 224; id++) {
  const _name0 = ts.PARAM_NAMES[id];
  if (!specById.has(id) && !COVERAGE[id]) missingRange.push(`${id} (${_name0})`);
}
if (missingRange.length) {
  fail(`no PARAM_SPECS and no COVERAGE range for: ${missingRange.join(', ')}`);
}
for (let id = 0; id < 224; id++) {
  const name = ts.PARAM_NAMES[id];
  if (typeof name !== 'string' || !name) fail(`PARAM_NAMES lacks id ${id}`);
  const def = ts.DEFAULT_PARAMS[id];
  if (typeof def !== 'number' || !Number.isFinite(def)) {
    fail(`DEFAULT_PARAMS lacks id ${id} (${name})`);
  }
  const spec = specById.get(id);
  let min;
  let max;
  let label = name;
  let log = false;
  if (spec) {
    min = spec.min;
    max = spec.max;
    label = spec.label;
    log = spec.curve === 'log';
    specCount++;
    if (spec.def !== def) {
      console.error(
        `gen-vst3-presets: WARN: PARAM_SPECS def ${spec.def} != DEFAULT_PARAMS ${def} for id ${id} (${name})`,
      );
    }
  } else if (COVERAGE[id]) {
    [min, max] = COVERAGE[id];
    coverageCount++;
  } else {
    fail(`no PARAM_SPECS and no COVERAGE range for id ${id} (${name})`);
  }
  if (OVERRIDES[id]) {
    [min, max] = OVERRIDES[id];
  }
  const discrete =
    spec?.discrete === true || ts.DISCRETE_PARAMS.has(id);
  const kind =
    discrete && min === 0 && max === 1 ? 'Bool' : discrete ? 'Int' : 'Float';
  if (def < min - 1e-6 || def > max + 1e-6) {
    fail(`default ${def} of id ${id} (${name}) outside range [${min}, ${max}]`);
  }
  if (kind === 'Int' && Math.round(def) !== def) {
    fail(`discrete Int id ${id} (${name}) has non-integer default ${def}`);
  }
  const field = cleanField(name);
  if (seenFields.has(field)) fail(`duplicate Rust field name ${field}`);
  seenFields.add(field);
  rows.push({ id, name, field, label, min, max, def, discrete, kind, log });
}

// --------------------------------------------------------------- presets
const presets = ts.FACTORY_PRESETS;
if (!Array.isArray(presets) || presets.length === 0) {
  fail('FACTORY_PRESETS is empty');
}
const seenPresetIds = new Set();
const presetRows = presets.map((p, i) => {
  if (seenPresetIds.has(p.id)) fail(`duplicate preset id ${p.id}`);
  seenPresetIds.add(p.id);
  if (p.routes) fail(`preset ${p.id} carries custom routes (plugin assumes DEFAULT_ROUTES)`);
  if (p.params2 || p.instanceMode) {
    fail(`preset ${p.id} carries params2/instanceMode (plugin is single-instance)`);
  }
  const overlay = Object.entries(p.params ?? {})
    .map(([k, v]) => [Number(k), v])
    .sort((a, b) => a[0] - b[0]);
  for (const [id, v] of overlay) {
    if (!Number.isInteger(id) || id < 0 || id > 223) {
      fail(`preset ${p.id} has out-of-range overlay id ${id}`);
    }
    const row = rows[id];
    if (v < row.min - 1e-6 || v > row.max + 1e-6) {
      fail(`preset ${p.id} overlay ${v} for id ${id} (${row.name}) outside [${row.min}, ${row.max}]`);
    }
    if (row.kind === 'Int' && Math.round(v) !== v) {
      fail(`preset ${p.id} overlay ${v} for discrete Int id ${id} (${row.name}) is not an integer`);
    }
  }
  return { index: i, id: p.id, name: p.name, overlay };
});
if (presetRows[0].id !== 'pluck') {
  fail(`first factory preset is ${presetRows[0].id}, expected pluck`);
}

// ------------------------------------------------------------ Rust emit
const f32 = (v) => {
  if (!Number.isFinite(v)) fail(`non-finite value ${v} cannot be emitted`);
  let s = String(v);
  if (!/[.eE]/.test(s)) s += '.0';
  return s;
};
const rsStr = (s) =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;

const out = [];
out.push('// GENERATED — do not edit by hand.');
out.push('// Regenerate with: node scripts/gen-vst3-presets.mjs');
out.push('// Source: src/audio/params.ts + src/state/presets.ts (+ src/state/preset-model.ts).');
out.push('');
out.push('use nih_plug::params::Param;');
out.push('use nih_plug::prelude::*;');
out.push('use nih_plug_egui::EguiState;');
out.push('use std::sync::{Arc, RwLock};');
out.push('');
out.push('use crate::EngineState;');
out.push('');
out.push('/// Number of TS parameters (Param 0..223).');
out.push('pub const PARAM_COUNT: usize = 224;');
out.push('');
out.push('/// TS parameter id -> camelCase name (the stable VST3 parameter id).');
out.push('pub const PARAM_NAMES: [&str; PARAM_COUNT] = [');
for (const r of rows) out.push(`    ${rsStr(r.name)},`);
out.push('];');
out.push('');
out.push('/// TS parameter id -> default value (DEFAULT_PARAMS).');
out.push('pub const PARAM_DEFAULTS: [f32; PARAM_COUNT] = [');
for (const r of rows) out.push(`    ${f32(r.def)},`);
out.push('];');
out.push('');
out.push('/// TS parameter id -> (min, max) range emitted to the host.');
out.push('pub const PARAM_RANGES: [(f32, f32); PARAM_COUNT] = [');
for (const r of rows) out.push(`    (${f32(r.min)}, ${f32(r.max)}),`);
out.push('];');
out.push('');
out.push('/// TS parameter id -> whether the parameter is discrete.');
out.push('pub const PARAM_IS_DISCRETE: [bool; PARAM_COUNT] = [');
for (const r of rows) out.push(`    ${r.discrete},`);
out.push('];');
out.push('');
out.push('/// Default modulation routes as ENGINE (Rust) codes, not TS codes.');
out.push('/// (src, dst, amount, enabled); src: lfo=0 env=1 modwheel=2 velocity=3');
out.push('/// lfo2=4 aftertouch=5 random=6 keytrack=7; dst: cutoff=0 pitch=1');
out.push('/// volume=2 pwm=3 pan=4 res=5 fm=6 ring=7.');
out.push('pub const DEFAULT_ROUTES: [(u32, u32, f32, bool); 4] = [');
for (const [s, d, a, e] of routes) out.push(`    (${s}, ${d}, ${f32(a)}, ${e}),`);
out.push('];');
out.push('');
out.push('/// One factory preset: id, display name, sparse overlay over DEFAULT_PARAMS.');
out.push('pub struct PresetDef {');
out.push('    pub id: &\'static str,');
out.push('    pub name: &\'static str,');
out.push('    pub overlay: &\'static [(u32, f32)],');
out.push('}');
out.push('');
out.push('/// All factory presets, in FACTORY_PRESETS order. Index 0 is pluck.');
out.push('pub const PRESETS: &[PresetDef] = &[');
for (const p of presetRows) {
  out.push(`    PresetDef { id: ${rsStr(p.id)}, name: ${rsStr(p.name)}, overlay: &[`);
  for (const [id, v] of p.overlay) out.push(`        (${id}, ${f32(v)}),`);
  out.push('    ] },');
}
out.push('];');
out.push('');
out.push('/// nih-plug parameter block. `preset` is plugin-local (not a TS');
out.push('/// parameter): the preset selector, 0..=119, default 0 = pluck.');
out.push('/// nih-plug has no native VST3 program list, so the selector is a');
out.push('/// plain integer parameter instead (see the crate README).');
out.push('/// `editor_state` and `engine_state` are NOT parameters: they are');
out.push('/// #[persist] fields, saved with the plugin state. The editor');
out.push('/// state holds the window size; the engine state holds the');
out.push('/// engine-effective parameter values (preset + post-switch host');
out.push('/// tweaks) so a host save/reload restores the tweaks instead of');
out.push('/// losing them to the first-block preset re-apply (see lib.rs).');
out.push('#[derive(Params)]');
out.push('// Field names mirror the TS camelCase parameter names on purpose.');
out.push('#[allow(non_snake_case)]');
out.push('pub struct Gs1Params {');
out.push('    #[id = "preset"]');
out.push('    pub preset: IntParam,');
out.push('    #[persist = "editor-state"]');
out.push('    pub editor_state: Arc<EguiState>,');
out.push('    #[persist = "engine-state"]');
out.push('    pub engine_state: Arc<RwLock<Option<EngineState>>>,');
for (const r of rows) {
  out.push(`    #[id = ${rsStr(r.name)}]`);
  if (r.kind === 'Bool') {
    out.push(`    pub ${r.field}: BoolParam,`);
  } else if (r.kind === 'Int') {
    out.push(`    pub ${r.field}: IntParam,`);
  } else {
    out.push(`    pub ${r.field}: FloatParam,`);
  }
}
out.push('}');
out.push('');
out.push('impl Default for Gs1Params {');
out.push('    fn default() -> Self {');
out.push('        Self {');
out.push(
  `            preset: IntParam::new("Preset", 0, IntRange::Linear { min: 0, max: ${presetRows.length - 1} }),`,
);
out.push('            editor_state: EguiState::from_size(880, 660),');
out.push('            engine_state: Arc::new(RwLock::new(None)),');
for (const r of rows) {
  if (r.kind === 'Bool') {
    out.push(
      `            ${r.field}: BoolParam::new(${rsStr(r.label)}, ${r.def >= 0.5}),`,
    );
  } else if (r.kind === 'Int') {
    out.push(
      `            ${r.field}: IntParam::new(${rsStr(r.label)}, ${Math.round(r.def)}, IntRange::Linear { min: ${Math.round(r.min)}, max: ${Math.round(r.max)} }),`,
    );
  } else if (r.log) {
    out.push(
      `            ${r.field}: FloatParam::new(${rsStr(r.label)}, ${f32(r.def)}, FloatRange::Skewed { min: ${f32(r.min)}, max: ${f32(r.max)}, factor: FloatRange::skew_factor(2.0) }),`,
    );
  } else {
    out.push(
      `            ${r.field}: FloatParam::new(${rsStr(r.label)}, ${f32(r.def)}, FloatRange::Linear { min: ${f32(r.min)}, max: ${f32(r.max)} }),`,
    );
  }
}
out.push('        }');
out.push('    }');
out.push('}');
out.push('');
out.push('/// Generic read access to the 224 TS parameters by numeric id.');
out.push('/// There is intentionally no set closure: nih-plug parameters are');
out.push('/// host-owned and ParamMut::set_plain_value is pub(crate), so plugin');
out.push('/// code cannot write parameter values. Preset switching therefore');
out.push('/// writes to the engine only, and host values are change-tracked');
out.push('/// (see RenderState in lib.rs).');
out.push('pub struct ParamAccessor {');
out.push('    pub id: u32,');
out.push('    pub get: fn(&Gs1Params) -> f32,');
out.push('}');
out.push('');
out.push('pub static PARAM_ACCESSORS: &[ParamAccessor] = &[');
for (const r of rows) {
  if (r.kind === 'Bool') {
    out.push(
      `    ParamAccessor { id: ${r.id}, get: |p| if p.${r.field}.unmodulated_plain_value() { 1.0 } else { 0.0 } },`,
    );
  } else if (r.kind === 'Int') {
    out.push(
      `    ParamAccessor { id: ${r.id}, get: |p| p.${r.field}.unmodulated_plain_value() as f32 },`,
    );
  } else {
    out.push(
      `    ParamAccessor { id: ${r.id}, get: |p| p.${r.field}.unmodulated_plain_value() },`,
    );
  }
}
out.push('];');
out.push('');

let text = out.join('\n');
// The committed file must be rustfmt-clean (the generator's own one-item-per
// line layout is not what rustfmt emits for these tables), so format the
// fresh output with rustfmt before comparing or writing. rustfmt ships with
// the Rust toolchain; if it is missing this fails loudly rather than
// emitting a file --check would reject.
{
  const tmpPath = `${outPath}.tmp.rs`;
  await writeFile(tmpPath, text);
  try {
    execFileSync('rustfmt', ['--edition', '2021', tmpPath], { stdio: 'pipe' });
  } catch (e) {
    await unlink(tmpPath);
    fail(`rustfmt failed (is rustfmt on PATH?): ${e.message}`);
  }
  text = await readFile(tmpPath, 'utf8');
  await unlink(tmpPath);
}
if (checkOnly) {
  let current = null;
  try {
    current = await readFile(outPath, 'utf8');
  } catch {
    fail('generated.rs does not exist');
  }
  if (current !== text) fail('generated.rs is out of date (run without --check)');
  console.log('gen-vst3-presets: generated.rs is up to date');
} else {
  await writeFile(outPath, text);
  console.log(
    `gen-vst3-presets: wrote ${outPath}: ${rows.length} params ` +
      `(${specCount} from PARAM_SPECS, ${coverageCount} from COVERAGE), ` +
      `${presetRows.length} presets`,
  );
}
