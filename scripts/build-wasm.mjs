#!/usr/bin/env node
/**
 * Build the Rust DSP core for wasm32 and copy it next to the TS sources.
 *
 * Two variants are produced so the app runs on the widest browser range:
 *   synth_core.wasm         — WebAssembly SIMD (Chrome 91+, Safari 16.4+)
 *   synth_core_scalar.wasm  — scalar fallback (older Safari / no SIMD)
 *
 * The engine feature-detects SIMD at runtime and picks the matching module.
 *
 * P11.1: both cores are then run through `wasm-opt -Oz` (binaryen, a
 * devDependency). That pass is a *raw* byte win — on the v1.104.0 tree it takes
 * the two cores from ~306/298 KB to ~207/192 KB (about -32 % / -35 % raw) and
 * barely moves gzip (about -1.3 % / -1.6 %), because gzip already compresses
 * the repeated structure that -Oz removes. `scripts/verify-budget.mjs` sums the
 * dist total in *raw* bytes, so this is the line this pass buys back; it does
 * **not** buy back the wasm gzip budget (see the P9.1b correction in that
 * script).
 *
 * `--all-features` is required: without it wasm-validator rejects the input
 * (SIMD ops, `memory.copy`, `i32.trunc_sat`, ...). It only *permits* those
 * features, it does not add relaxed-simd to either output — the scalar core
 * stays scalar (asserted by `scripts/verify-wasm-scalar-features.mjs` in CI).
 *
 * The pass is idempotent and degrades gracefully: every run re-copies the
 * fresh cargo output first, then optimises that copy, so a second run of
 * `npm run build:wasm` produces the same bytes. If `wasm-opt` is missing,
 * fails, or emits bytes that `WebAssembly.validate` rejects, the build prints
 * why and ships the unoptimised module instead of failing — `verify:budget`
 * is the gate that notices the resulting regression. Set `WASM_OPT=0` to skip
 * the pass on purpose, or `WASM_OPT=/path/to/wasm-opt` to pin a binary (both
 * are how the A/B numbers above were measured).
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = resolve(root, 'crates/synth-core');
const outDir = resolve(root, 'src/generated');
const built = resolve(crate, 'target/wasm32-unknown-unknown/release/synth_core.wasm');
const profile = process.env.WASM_PROFILE === 'debug' ? 'debug' : 'release';

const variants = [
  { file: 'synth_core.wasm', simd: true },
  { file: 'synth_core_scalar.wasm', simd: false },
];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const gzipKb = (bytes) => `${(gzipSync(bytes, { level: 9 }).length / 1024).toFixed(1)} KB`;
const percent = (before, after) =>
  before === 0 ? '0.0 %' : `${(((after - before) / before) * 100).toFixed(1)} %`;

/**
 * Resolve the wasm-opt to use, in order: `WASM_OPT` override, the local
 * devDependency install, then `$PATH`. `WASM_OPT=0` (or `off`) opts out.
 */
const resolveWasmOpt = () => {
  const override = process.env.WASM_OPT?.trim();
  if (override === '0' || override === 'off') return null;
  if (override) {
    if (!existsSync(override)) {
      console.warn(`[wasm] WASM_OPT=${override} does not exist`);
      return null;
    }
    return override;
  }
  const local = resolve(root, 'node_modules/.bin/wasm-opt');
  if (existsSync(local)) return local;
  try {
    execFileSync('wasm-opt', ['--version'], { stdio: 'ignore' });
    return 'wasm-opt';
  } catch {
    return null;
  }
};

/** Optimise `file` in place, keeping the original bytes on any failure. */
const optimize = (file, wasmOpt) => {
  const before = readFileSync(file);
  const tmp = `${file}.opt`;
  try {
    execFileSync(wasmOpt, ['-Oz', '--all-features', file, '-o', tmp], { stdio: 'inherit' });
    const after = readFileSync(tmp);
    // A guard for a broken/partially-installed binaryen: never ship bytes the
    // runtime would refuse to instantiate.
    if (!WebAssembly.validate(after)) {
      console.warn('[wasm]   wasm-opt output failed WebAssembly.validate — keeping the unoptimised module');
      return null;
    }
    renameSync(tmp, file);
    return { before, after };
  } catch (error) {
    const reason = `${error.message}`.trim().split('\n')[0];
    console.warn(`[wasm]   wasm-opt failed (${reason}) — keeping the unoptimised module`);
    return null;
  } finally {
    rmSync(tmp, { force: true });
  }
};

mkdirSync(outDir, { recursive: true });

const wasmOpt = resolveWasmOpt();
const wasmOptEnabled = wasmOpt !== null;
if (!wasmOptEnabled) {
  console.warn(
    '[wasm] wasm-opt not found (binaryen is a devDependency — run "npm ci") — skipping -Oz; the cores stay unoptimised and dist will be larger',
  );
}

for (const variant of variants) {
  const args = ['build', '--target', 'wasm32-unknown-unknown'];
  if (profile === 'release') args.push('--release');
  console.log(`[wasm] ${variant.file} (${variant.simd ? 'simd128' : 'scalar'})`);
  execFileSync('cargo', args, {
    cwd: crate,
    stdio: 'inherit',
    env: {
      ...process.env,
      GS_SIMD: variant.simd ? '1' : '0',
      RUSTFLAGS: `-C target-feature=${variant.simd ? '+' : '-'}simd128`,
    },
  });
  const out = resolve(outDir, variant.file);
  copyFileSync(built, out);

  if (wasmOptEnabled) {
    const result = optimize(out, wasmOpt);
    if (result) {
      const { before, after } = result;
      console.log(
        `[wasm]   wasm-opt -Oz: ${kb(before.length)} -> ${kb(after.length)} raw (${percent(before.length, after.length)}), ` +
          `${gzipKb(before)} -> ${gzipKb(after)} gzip`,
      );
    }
  }
  console.log(`[wasm]   -> ${kb(statSync(out).size)}`);
}
