#!/usr/bin/env node
/**
 * Preset fingerprint gate.
 *
 * Two gates already watch the sound. `scripts/dsp-baseline.mjs` fingerprints
 * **one** fixed patch, and the loudness test watches how loud each preset is.
 * Between them, eighty factory presets could still break quietly: a filter
 * envelope pointed at the wrong amount, a detune that became a ring modulation,
 * a wavetable index off by one — each one passes a loudness check, and the DSP
 * fingerprint is not looking at that patch.
 *
 * So this gate renders *every* factory preset through the same phrase and
 * records what came out: twenty-four third-octave band levels (Goertzel, so the
 * measurement is cheap and deterministic), the RMS, the peak and the
 * left/right balance. A preset whose numbers move has to be confirmed on
 * purpose —
 *
 *   npm run presets:update -- --reason "why the presets sound different now"
 *
 * — and the reason is stored in the baseline, because changing what a preset
 * sounds like is a decision and not a diff.
 *
 * The preset definitions live in TypeScript, so the script bundles the one
 * module it needs with esbuild (which vite already brings) and imports the
 * result from `.tmp/`. It never touches the app bundle.
 *
 * P11.4 adds the oversampled path. `scripts/dsp-baseline.mjs` already keeps two
 * fingerprints for its one patch; the presets were only fingerprinted on the
 * default 1x path, so a preset that breaks *because* of 2x (the saturating
 * filter path is the one oversampling changes) went unseen. `--oversampled`
 * selects `tests/preset-fingerprint-2x.json`, mirroring the DSP baseline's
 * `tests/dsp-baseline-2x.json`, and `npm run verify:presets:2x` is the gate.
 * Both modes are hard gates; neither is derived from the other.
 *
 * `--report` prints the largest movement per preset with its ratio against the
 * tolerance, whether or not it failed: that is how the tolerances below were
 * chosen, and how a suspicious run is read afterwards.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'src/generated/synth_core.wasm');
const argv = process.argv.slice(2);
const update = argv.includes('--update');
const reasonIndex = argv.indexOf('--reason');
const reason = reasonIndex >= 0 ? argv[reasonIndex + 1] : undefined;
/** The second mode. Same phrase, same bands, the 2x oversampled filter path. */
const oversampled = argv.includes('--oversampled');
const tag = oversampled ? '[presets 2x]' : '[presets]';
const baselinePath = resolve(
  root,
  oversampled ? 'tests/preset-fingerprint-2x.json' : 'tests/preset-fingerprint.json',
);
const updateCommand = oversampled ? 'presets:update:2x' : 'presets:update';
if (update && !reason) {
  console.error(`${tag} --update needs a reason: npm run ${updateCommand} -- --reason "..."`);
  process.exit(2);
}

if (!existsSync(wasmPath)) {
  console.error(`${tag} src/generated/synth_core.wasm missing — run "npm run build:wasm"`);
  process.exit(1);
}

// ---------------------------------------------------------------- presets

const bundlePath = resolve(root, '.tmp/preset-fingerprint-bundle.mjs');

let build;
try {
  ({ build } = await import('esbuild'));
} catch (error) {
  console.error(`${tag} esbuild is required (vite ships it) — run "npm install"`);
  console.error(`${tag} ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

mkdirSync(dirname(bundlePath), { recursive: true });
await build({
  stdin: {
    contents: `
      export { FACTORY_PRESETS, presetParams, presetRoutes } from '@/state/presets';
      export { DEFAULT_PARAMS, Param } from '@/audio/params';
    `,
    resolveDir: root,
    sourcefile: 'preset-fingerprint-entry.ts',
    loader: 'ts',
  },
  alias: { '@': resolve(root, 'src') },
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
  outfile: bundlePath,
});
const { FACTORY_PRESETS, presetParams, presetRoutes, DEFAULT_PARAMS, Param } = await import(
  pathToFileURL(bundlePath).href
);

// ------------------------------------------------------------- fingerprint

const SR = 48_000;
const BLOCK = 128;
const SECONDS = 1.8;
/** A chord for the pad/keys patches and a low held note for the basses. */
const PHRASE = [
  [60, 0.0, 0.7],
  [64, 0.0, 0.7],
  [67, 0.0, 0.7],
  [55, 0.8, 0.9],
];
/**
 * A third-octave ladder. Twelve spot frequencies missed too much of the
 * spectrum: with them a cutoff moved ten percent moved a single band by half a
 * decibel, exactly the tolerance. Twenty-four give the check real teeth without
 * measuring anything a listener would not (the whole run is still about ten
 * seconds).
 */
const BANDS = [
  50, 63, 79, 100, 126, 158, 200, 251, 316, 398, 501, 631, 794, 1000, 1259, 1585, 1995, 2512,
  3162, 3981, 5012, 6310, 7943, 10_000,
];

const wasmBytes = readFileSync(wasmPath);
const module = new WebAssembly.Module(wasmBytes);

const goertzel = (data, freq) => {
  const k = (2 * Math.PI * freq) / SR;
  const coeff = 2 * Math.cos(k);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (const x of data) {
    s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / data.length;
};
const db = (value) => Number((20 * Math.log10(value + 1e-12)).toFixed(3));

function render(preset) {
  const ex = new WebAssembly.Instance(module, {}).exports;
  ex.gs_init(SR, 16);
  for (const [id, value] of Object.entries(presetParams(preset))) {
    ex.gs_set_param(Number(id), value);
  }
  // The second mode (P11.4): force 2x on, whatever the preset file says. It is
  // a global engine switch, so it is set once per instance, not per layer.
  if (oversampled) ex.gs_set_param(Param.OVERSAMPLE, 1);
  presetRoutes(preset).forEach((route, index) => {
    ex.gs_set_mod_route(index, route.src, route.dst, route.amount, route.enabled ? 1 : 0);
  });
  // Mirror `store.applyPreset`: a patch that brings a second layer also brings
  // the way notes reached it; one without leaves the routing alone.
  if (preset.params2 && preset.instanceMode) {
    for (const [id, value] of Object.entries({ ...DEFAULT_PARAMS, ...preset.params2 })) {
      ex.gs_set_param_inst(1, Number(id), Number(value));
    }
    ex.gs_set_instance_route(
      preset.instanceMode === 'layer' ? 1 : preset.instanceMode === 'split' ? 2 : 0,
      preset.splitNote ?? 60,
      0,
      1,
      0,
      1,
    );
  }

  const events = [];
  for (const [note, start, length] of PHRASE) {
    events.push([start * SR, true, note], [(start + length) * SR, false, note]);
  }
  events.sort((a, b) => a[0] - b[0]);

  const frames = Math.round(SECONDS * SR);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const leftPtr = ex.gs_left_ptr() / 4;
  const rightPtr = ex.gs_right_ptr() / 4;
  let cursor = 0;
  let offset = 0;
  for (let block = 0; block * BLOCK < frames; block++) {
    while (cursor < events.length && events[cursor][0] < (block + 1) * BLOCK) {
      const [, on, note] = events[cursor++];
      if (on) ex.gs_note_on(note, 0.9);
      else ex.gs_note_off(note);
    }
    ex.gs_process(BLOCK);
    const heap = new Float32Array(ex.memory.buffer);
    const count = Math.min(BLOCK, frames - offset);
    left.set(heap.subarray(leftPtr, leftPtr + count), offset);
    right.set(heap.subarray(rightPtr, rightPtr + count), offset);
    offset += count;
  }
  ex.gs_note_off(55);

  const energy = (data) => {
    let sum = 0;
    for (const x of data) sum += x * x;
    return Math.sqrt(sum / data.length);
  };
  const peak = (data) => {
    let max = 0;
    for (const x of data) max = Math.max(max, Math.abs(x));
    return max;
  };
  const rmsL = energy(left);
  const rmsR = energy(right);
  return {
    rms: db(rmsL),
    peak: db(peak(left)),
    stereo: Number((20 * Math.log10((rmsR + 1e-12) / (rmsL + 1e-12))).toFixed(3)),
    bands: BANDS.map((freq) => db(goertzel(left, freq))),
  };
}

const measured = {};
for (const preset of FACTORY_PRESETS) {
  if (preset.user) continue;
  measured[preset.id] = render(preset);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const abi = new WebAssembly.Instance(module, {}).exports.gs_abi_version();
const payload = {
  abi,
  oversampled,
  sampleRate: SR,
  seconds: SECONDS,
  phrase: PHRASE,
  bands: BANDS,
  reason: reason ?? baseline?.reason ?? 'initial baseline',
  presets: measured,
};
const serialise = (value) => {
  // One line per preset: a fingerprint change then reads as a one-line diff in
  // review, which is the point of keeping the numbers in the repository.
  const ids = Object.keys(value.presets);
  const lines = [
    '{',
    ` "abi": ${value.abi},`,
    ` "oversampled": ${value.oversampled === true},`,
    ` "sampleRate": ${value.sampleRate},`,
    ` "seconds": ${value.seconds},`,
    ` "phrase": ${JSON.stringify(value.phrase)},`,
    ` "bands": ${JSON.stringify(value.bands)},`,
    ` "reason": ${JSON.stringify(value.reason)},`,
    ' "presets": {',
  ];
  ids.forEach((id, index) => {
    lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(value.presets[id])}${index === ids.length - 1 ? '' : ','}`);
  });
  lines.push(' }', '}', '');
  return lines.join('\n');
};

// ------------------------------------------------------------------ verdict

/** Every fingerprint differential, worst first. */
function diff(before, after) {
  const entries = [];
  for (const [id, now] of Object.entries(after)) {
    const was = before[id];
    if (!was) {
      entries.push({ id, severity: Infinity, moved: ['new preset'], worst: null });
      continue;
    }
    const moved = [];
    let severity = 0;
    let worst = null;
    const consider = (label, wasValue, nowValue, tolerance) => {
      const delta = Math.abs(wasValue - nowValue);
      severity = Math.max(severity, delta / tolerance);
      if (!worst || delta / tolerance > worst.severity) {
        worst = { label, was: wasValue, now: nowValue, delta, severity: delta / tolerance };
      }
      if (delta > tolerance) moved.push(`${label} ${wasValue} -> ${nowValue} dB`);
    };
    // Tolerances: 0.25 dB of level, 0.5 dB in a band. Measured on the `pluck`
    // preset while building this gate — a 5 % cutoff move (0.84 dB at 10 kHz)
    // and a 5 % envelope-decay move (0.89 dB at 3.2 kHz) both fail, while a 1 %
    // nudge (0.05…0.15 dB) passes. Two runs of the same binary differ by
    // 0.000 dB, so the slack is there for a *rebuilt* wasm (a different clang
    // moves the last bits), not for the measurement.
    consider('rms', was.rms, now.rms, 0.25);
    consider('peak', was.peak, now.peak, 0.5);
    consider('stereo', was.stereo, now.stereo, 0.25);
    was.bands.forEach((value, index) => {
      consider(`${BANDS[index]}Hz`, value, now.bands[index], 0.5);
    });
    entries.push({ id, severity, moved, worst });
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) entries.push({ id, severity: Infinity, moved: ['preset removed'], worst: null });
  }
  return entries.sort((a, b) => b.severity - a.severity);
}

const report = argv.includes('--report');

if (update || !baseline) {
  writeFileSync(baselinePath, serialise(payload));
  const verb = update ? '--update' : 'first run';
  console.log(
    `${tag} baseline written (${verb}) · ${Object.keys(measured).length} presets · ABI ${abi}`,
  );
  if (update && baseline) {
    const moved = diff(baseline.presets, measured).filter((entry) => entry.severity > 1);
    for (const entry of moved.slice(0, 10)) console.log(`  ${entry.id}: ${entry.moved.join(', ')}`);
    if (moved.length > 10) console.log(`  … and ${moved.length - 10} more preset(s)`);
  }
  process.exit(0);
}

if (baseline.abi !== abi) {
  console.error(`${tag} the parameter ABI changed (${baseline.abi} -> ${abi})`);
  console.error(`${tag} regenerate: npm run ${updateCommand} -- --reason "why"`);
  process.exit(1);
}

const entries = diff(baseline.presets, measured);
const failures = entries.filter((entry) => entry.severity > 1);

// `--report` says what moved and by how much, tolerance or not: it is how the
// tolerances above were chosen, and how a suspicious run is read afterwards.
if (report) {
  console.log(`${tag} sensitivity report (ratio 1.0 = exactly at tolerance):`);
  for (const entry of entries.slice(0, 30)) {
    if (!entry.worst) continue;
    const { label, was, now, delta, severity } = entry.worst;
    console.log(
      `  ${severity.toFixed(3)}  ${entry.id.padEnd(14)} ${label} ${was} -> ${now} dB (${delta.toFixed(3)})`,
    );
  }
}

if (failures.length === 0) {
  console.log(`${tag} ${Object.keys(measured).length} presets unchanged · ABI ${abi}`);
  process.exit(0);
}

console.error(`${tag} REGRESSION detected:`);
for (const entry of failures) console.error(`  ${entry.id}: ${entry.moved.join(', ')}`);
console.error(`${tag} if the presets are meant to sound different now:`);
console.error(`${tag}   npm run ${updateCommand} -- --reason "why"`);
process.exit(1);
