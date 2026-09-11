#!/usr/bin/env node
/**
 * Sustained-load benchmark.
 *
 * The audio verifier measures one patch and one load; this runs the engine for
 * several seconds of dense polyphony and writes down what it cost, so a
 * regression that only shows up under sustained load ("it is fine for a second,
 * then it starts dropping blocks") has somewhere to be noticed. It is a gate as
 * well as a report: a run whose average load, peak, or queue of silent blocks
 * looks wrong fails.
 *
 * The numbers land in `docs/notes/performance.md`, appended as a table row so
 * the history is visible in git.
 */
import { existsSync, appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'src/generated/synth_core.wasm');
const notesDir = resolve(root, 'docs/notes');
const notesPath = resolve(notesDir, 'performance.md');
const update = process.argv.includes('--update');

if (!existsSync(wasmPath)) {
  console.error('[bench] src/generated/synth_core.wasm missing — run "npm run build:wasm"');
  process.exit(1);
}

const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {}).exports;
const SR = 48000;
const BLOCK = 128;
const SECONDS = 6;
const BUDGET_US = (BLOCK / SR) * 1e6;

const P = {
  MASTER_VOLUME: 0, OSC1_ON: 1, OSC1_WAVE: 2, OSC1_LEVEL: 5, OSC2_ON: 7, OSC2_WAVE: 8,
  OSC2_LEVEL: 11, FILTER_CUTOFF: 14, FILTER_RES: 15, FILTER_DRIVE: 16, FILTER_ENV_AMT: 17,
  ENV_ATTACK: 19, ENV_DECAY: 20, ENV_SUSTAIN: 21, ENV_RELEASE: 22, LFO_ON: 23, LFO2_ON: 62,
  FX_REVERB_ON: 29, FX_DELAY_ON: 32, FX_CHORUS_ON: 43, FX_PHASER_ON: 51, FX_DRIVE_ON: 55,
  OSC1_UNISON: 70, OSC2_UNISON: 72, WT_USER: 79, SMP_MODE: 97,
};

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// A dense, worst-case patch: two saws with unison, the whole effect chain on,
// a long reverb and a delay — the arrangement a busy song ends up with.
ex.gs_init(SR, 32);
for (const [id, value] of [
  [P.MASTER_VOLUME, 0.8], [P.OSC1_ON, 1], [P.OSC1_WAVE, 2], [P.OSC1_LEVEL, 0.7],
  [P.OSC2_ON, 1], [P.OSC2_WAVE, 2], [P.OSC2_LEVEL, 0.6], [P.FILTER_CUTOFF, 12000],
  [P.FILTER_RES, 0.35], [P.FILTER_DRIVE, 0.3], [P.FILTER_ENV_AMT, 0.3],
  [P.ENV_ATTACK, 0.005], [P.ENV_DECAY, 0.3], [P.ENV_SUSTAIN, 0.7], [P.ENV_RELEASE, 0.4],
  [P.LFO_ON, 1], [P.LFO2_ON, 1], [P.FX_REVERB_ON, 1], [P.FX_DELAY_ON, 1],
  [P.FX_CHORUS_ON, 1], [P.FX_PHASER_ON, 1], [P.FX_DRIVE_ON, 1],
  [P.OSC1_UNISON, 3], [P.OSC2_UNISON, 3],
]) {
  ex.gs_set_param(id, value);
}

// Sixteen held notes: the ceiling the load monitor is allowed to reach.
const notes = [36, 43, 48, 52, 55, 59, 62, 64, 67, 71, 74, 79, 83, 86, 88, 91];
for (const note of notes) ex.gs_note_on(note, 0.9);

const blocks = (SR * SECONDS) / BLOCK;
const times = new Float64Array(blocks);
let peak = 0;
let nonFinite = 0;

// Warm up first: JIT compilation is not what this measures.
for (let i = 0; i < 60; i++) ex.gs_process(BLOCK);

for (let i = 0; i < blocks; i++) {
  const start = process.hrtime.bigint();
  ex.gs_process(BLOCK);
  times[i] = Number(process.hrtime.bigint() - start) / 1000;
  const view = new Float32Array(ex.memory.buffer, ex.gs_left_ptr(), BLOCK);
  for (const value of view) {
    if (!Number.isFinite(value)) nonFinite += 1;
    else peak = Math.max(peak, Math.abs(value));
  }
}

const sorted = [...times].sort((a, b) => a - b);
const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
const p50 = sorted[Math.floor(sorted.length * 0.5)];
const p99 = sorted[Math.floor(sorted.length * 0.99)];
const worst = sorted[sorted.length - 1];
const load = (mean / BUDGET_US) * 100;
const overBudget = times.filter((value) => value > BUDGET_US).length;
const voices = ex.gs_active_voices();
const violations = ex.gs_alloc_violations();

console.log('[bench] sustained load');
check('no non-finite samples', nonFinite === 0, `${nonFinite} bad samples`);
check('output stays in range', peak <= 1.0, `peak ${peak.toFixed(3)}`);
check('no allocation on the audio thread', violations === 0, `${violations} violations`);
check('the voice pool is in use', voices >= 8, `${voices} voices`);
check('average load fits the budget', load < 60, `${load.toFixed(1)}% of the quantum`);
check(
  'most blocks fit the budget',
  overBudget <= blocks * 0.02,
  `${overBudget}/${blocks} blocks over ${BUDGET_US.toFixed(0)} µs (worst ${worst.toFixed(0)} µs)`,
);

const row = `| ${new Date().toISOString().slice(0, 10)} | ${SECONDS}s · ${notes.length} notes | ${mean.toFixed(0)} | ${p50.toFixed(0)} | ${p99.toFixed(0)} | ${worst.toFixed(0)} | ${load.toFixed(1)}% | ${voices} |`;
if (update) {
  mkdirSync(notesDir, { recursive: true });
  if (!existsSync(notesPath)) {
    writeFileSync(
      notesPath,
      `# 性能基准 / Performance baseline\n\n` +
        `由 \`npm run bench -- --update\` 写入：每行是一次 6 秒密集负载（双锯齿 + 各 3 声部齐奏、全套效果、16 个持续音）\n` +
        `在 Node 里跑 wasm 核心的结果。单位是微秒/块（128 帧，预算 ${BUDGET_US.toFixed(0)} µs @48 kHz）。\n\n` +
        `| 日期 | 负载 | 平均 | p50 | p99 | 最差 | 平均占用 | 声部 |\n| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |\n`,
    );
  }
  appendFileSync(notesPath, `${row}\n`);
  console.log(`[bench] wrote ${notesPath}`);
} else {
  console.log(`[bench] ${row}`);
}

if (failures.length) {
  console.error(`[bench] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[bench] PASS');
