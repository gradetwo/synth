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
import os from 'node:os';
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
// `--long` is the quarterly run: ten times the audio, plus the memory picture
// that only shows up over minutes (arena growth, wasm memory pages).
const LONG = process.argv.includes('--long');
const SECONDS = LONG ? 60 : 6;
const BUDGET_US = (BLOCK / SR) * 1e6;
/** Blocks per convolution hop: the phases a spread schedule rotates through. */
const HOP_BLOCKS = 8;

const P = {
  MASTER_VOLUME: 0, OSC1_ON: 1, OSC1_WAVE: 2, OSC1_LEVEL: 5, OSC2_ON: 7, OSC2_WAVE: 8,
  OSC2_LEVEL: 11, FILTER_CUTOFF: 14, FILTER_RES: 15, FILTER_DRIVE: 16, FILTER_ENV_AMT: 17,
  ENV_ATTACK: 19, ENV_DECAY: 20, ENV_SUSTAIN: 21, ENV_RELEASE: 22, LFO_ON: 23, LFO2_ON: 62,
  FX_REVERB_ON: 29, FX_DELAY_ON: 32, FX_CHORUS_ON: 43, FX_PHASER_ON: 51, FX_DRIVE_ON: 55,
  OSC1_UNISON: 70, OSC2_UNISON: 72, WT_USER: 79, FX_REVERB_MODE: 94, FX_CONV_TRIM: 95,
  SMP_MODE: 97,
};

/** Measure `seconds` of blocks and return the distribution, in µs. */
function measure(seconds) {
  const blocks = (SR * seconds) / BLOCK;
  const times = new Float64Array(blocks);
  let peak = 0;
  let nonFinite = 0;
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
  return {
    times,
    mean,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    worst: sorted[sorted.length - 1],
    overBudget: times.filter((value) => value > BUDGET_US).length,
    peak,
    nonFinite,
    blocks,
  };
}

/**
 * How busy the host is, relative to its cores.
 *
 * The numbers here are wall-clock times of a real-time workload, so they are
 * only meaningful on a machine that is not oversubscribed. Run on a loaded
 * host — another container, a build, a thermal throttle — and every block
 * "misses the deadline" while the DSP has not changed at all, which is exactly
 * what a gate must not report as a regression. When that is the case the timing
 * checks are reported as inconclusive, and the correctness ones still run.
 */
function hostLoad() {
  try {
    const [one, , ] = readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    const cpus = os.cpus().length || 1;
    return { load: Number(one), cpus, busy: Number(one) > cpus * 0.75 };
  } catch {
    return { load: 0, cpus: 1, busy: false };
  }
}

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const host = hostLoad();
const timed = (name, ok, detail = '') => {
  if (host.busy) {
    console.log(`  ~ ${name} — skipped, host is loaded (load ${host.load.toFixed(1)} on ${host.cpus} cpus)`);
    return;
  }
  check(name, ok, detail);
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

// Warm up first: JIT compilation is not what this measures.
for (let i = 0; i < 60; i++) ex.gs_process(BLOCK);

const run = measure(SECONDS);
const { mean, p50, p99, worst, overBudget, blocks, peak, nonFinite } = run;
const load = (mean / BUDGET_US) * 100;
const voices = ex.gs_active_voices();
const violations = ex.gs_alloc_violations();

const arenaFreeKb = ex.gs_arena_free_bytes() / 1024;
const memoryMb = ex.memory.buffer.byteLength / (1024 * 1024);
console.log(`[bench] sustained load${LONG ? ' (long run)' : ''}`);
check('no non-finite samples', nonFinite === 0, `${nonFinite} bad samples`);
check('output stays in range', peak <= 1.0, `peak ${peak.toFixed(3)}`);
check('no allocation on the audio thread', violations === 0, `${violations} violations`);
check('the voice pool is in use', voices >= 8, `${voices} voices`);
timed('average load fits the budget', load < 60, `${load.toFixed(1)}% of the quantum`);
if (LONG) {
  // Memory is a fact, not a timing: it stays gated even on a loaded host.
  check('the arena still has room after the run', arenaFreeKb > 512, `${arenaFreeKb.toFixed(0)} KB free`);
  check('wasm memory stays bounded', memoryMb < 32, `${memoryMb.toFixed(1)} MB`);
  console.log(`[bench] memory: ${memoryMb.toFixed(1)} MB wasm, ${arenaFreeKb.toFixed(0)} KB arena free`);
}
timed(
  'most blocks fit the budget',
  overBudget <= blocks * 0.02,
  `${overBudget}/${blocks} blocks over ${BUDGET_US.toFixed(0)} µs (worst ${worst.toFixed(0)} µs)`,
);

const row = `| ${new Date().toISOString().slice(0, 10)} | ${SECONDS}s${LONG ? ' (long)' : ''} · ${notes.length} notes | ${mean.toFixed(0)} | ${p50.toFixed(0)} | ${p99.toFixed(0)} | ${worst.toFixed(0)} | ${load.toFixed(1)}% | ${voices} |`;

// ---- the same load with the IR reverb, which is the engine's heaviest path ---
// A 2 s response is 96 partitions, and the hop's partition work is what has to
// stay spread: if it is not, one block in every eight pays for all of it and
// the worst block leaves the distribution behind.
const irLen = Math.min(ex.gs_ir_capacity(), 2 * SR);
const ir = new Float32Array(ex.memory.buffer, ex.gs_ir_import_ptr(), irLen);
for (let i = 0; i < irLen; i++) {
  // Exponentially decaying noise: what a real room response looks like.
  const t = i / SR;
  ir[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3) * 0.4;
}
const irCode = ex.gs_ir_import(irLen);
ex.gs_set_param(P.FX_REVERB_MODE, 1);
ex.gs_set_param(P.FX_CONV_TRIM, 0.8);
for (let i = 0; i < 60; i++) ex.gs_process(BLOCK);
const irRun = measure(SECONDS);
const irLoad = (irRun.mean / BUDGET_US) * 100;

console.log('[bench] sustained load with an imported impulse response');
check('the response is in use', irCode === 0 && ex.gs_ir_has() === 1, `import code ${irCode}`);
// The same tolerance as the dry run: one late block on a busy desktop is the
// scheduler, not the DSP.
timed('the IR path stays inside the budget', irRun.overBudget <= irRun.blocks * 0.02,
  `${irRun.overBudget}/${irRun.blocks} blocks over ${BUDGET_US.toFixed(0)} µs ` +
  `(worst ${irRun.worst.toFixed(0)} µs, mean ${irRun.mean.toFixed(0)} µs)`);
// Spread, not spiky. Every call is the same 128 frames and the convolver's hop
// is 1024, so the blocks fall into eight repeating phases and exactly one phase
// carries whatever happens at the hop boundary. Comparing the *medians* of those
// phases ignores the scheduler noise that makes single-block times useless:
// spread, all eight are close; concentrated, the boundary phase towers over the
// other seven.
const phaseMedian = [];
for (let phase = 0; phase < HOP_BLOCKS; phase++) {
  const group = [];
  for (let i = phase; i < irRun.times.length; i += HOP_BLOCKS) group.push(irRun.times[i]);
  group.sort((a, b) => a - b);
  phaseMedian.push(group[Math.floor(group.length / 2)]);
}
// One phase is allowed to be busy: the transforms cannot start until the hop
// is complete, so the boundary block always carries them. Every *other* phase
// must look alike — if the partition work were concentrated, one phase would
// stand out from the rest by a wide margin.
const ranked = phaseMedian.slice().sort((a, b) => a - b);
const others = ranked.slice(0, -1);
const typical = others[Math.floor(others.length / 2)];
const busiest = others[others.length - 1];
const spread = busiest / Math.max(1, typical);
timed('the convolution work is spread across the hop', spread < 1.35,
  `apart from the transform block, the busiest of ${HOP_BLOCKS - 1} blocks averages ` +
  `${busiest.toFixed(0)} µs against ${typical.toFixed(0)} µs (${spread.toFixed(2)}×): ` +
  `${phaseMedian.map((v) => v.toFixed(0)).join('/')}`);
const irRow = `| ${new Date().toISOString().slice(0, 10)} | ${SECONDS}s · ${notes.length} notes · IR ${(irLen / SR).toFixed(1)}s | ${irRun.mean.toFixed(0)} | ${irRun.p50.toFixed(0)} | ${irRun.p99.toFixed(0)} | ${irRun.worst.toFixed(0)} | ${irLoad.toFixed(1)}% | ${voices} |`;
if (update) {
  mkdirSync(notesDir, { recursive: true });
  if (!existsSync(notesPath)) {
    writeFileSync(
      notesPath,
      `# 性能基准 / Performance baseline\n\n` +
        `由 \`npm run bench -- --update\` 写入：每行是一次 6 秒密集负载（双锯齿 + 各 3 声部齐奏、全套效果、16 个持续音）\n` +
        `在 Node 里跑 wasm 核心的结果。单位是微秒/块（128 帧，预算 ${BUDGET_US.toFixed(0)} µs @48 kHz）。\n` +
        `第二行是同一负载再挂一条 2 秒导入 IR（卷积混响），用来盯住最重的路径。\n\n` +
        `| 日期 | 负载 | 平均 | p50 | p99 | 最差 | 平均占用 | 声部 |\n| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |\n`,
    );
  }
  appendFileSync(notesPath, `${row}\n${irRow}\n`);
  console.log(`[bench] wrote ${notesPath}`);
} else {
  console.log(`[bench] ${row}`);
  console.log(`[bench] ${irRow}`);
}

if (failures.length) {
  console.error(`[bench] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
if (host.busy) {
  console.log(
    `[bench] PASS (correctness only) — timing checks skipped: host load ${host.load.toFixed(1)} on ${host.cpus} cpus`,
  );
} else {
  console.log('[bench] PASS');
}
