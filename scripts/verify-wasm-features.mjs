#!/usr/bin/env node
/**
 * Feature-floor guard for the two WASM cores.
 *
 * P11.1 runs both cores through `wasm-opt -Oz --all-features` (see
 * `scripts/build-wasm.mjs`). `--all-features` only *permits* every proposal; it
 * must not change what each core actually uses, because the runtime only
 * feature-detects SIMD (see `src/audio/engine.ts` and `docs/notes/compat.md`):
 *   - the SIMD core has to keep its `v128` code, otherwise the "fast" module
 *     would silently be the slow one;
 *   - the scalar core has to stay scalar: one `v128` instruction in it would
 *     throw a `CompileError` on exactly the browsers it exists for;
 *   - neither may pick up relaxed-simd, which is deliberately not used here.
 *
 * Both modules must also pass `WebAssembly.validate`.
 *
 * Detection disassembles with binaryen's `wasm-dis`. If that binary is missing
 * (binaryen is a devDependency, installed by `npm ci`), the guard warns and
 * skips instead of blocking the build — the same graceful-degradation policy
 * `build-wasm.mjs` uses for `wasm-opt`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CORES = [
  { file: 'src/generated/synth_core.wasm', label: 'synth_core.wasm', simd: true },
  { file: 'src/generated/synth_core_scalar.wasm', label: 'synth_core_scalar.wasm', simd: false },
];

// `v128` is the value type; the rest are the SIMD instruction families.
const SIMD = /\b(?:v128|i8x16|i16x8|i32x4|i64x2|f32x4|f64x2)\b/g;
const RELAXED = /\brelaxed_(?:trunc|madd|nmadd|swizzle|min|max|q15mulr|dot|fma)\b/g;
const count = (text, re) => (text.match(re) ?? []).length;

const resolveWasmDis = () => {
  const local = resolve(root, 'node_modules/.bin/wasm-dis');
  if (existsSync(local)) return local;
  try {
    execFileSync('wasm-dis', ['--version'], { stdio: 'ignore' });
    return 'wasm-dis';
  } catch {
    return null;
  }
};

const wasmDis = resolveWasmDis();
if (!wasmDis) {
  console.warn('[features] wasm-dis not found (binaryen is a devDependency — run "npm ci") — skipping');
  process.exit(0);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log('[features] WASM core feature floor');

for (const core of CORES) {
  const path = resolve(root, core.file);
  if (!existsSync(path)) {
    check(`${core.label} exists`, false, 'run "npm run build:wasm" first');
    continue;
  }
  const bytes = readFileSync(path);
  check(`${core.label} validates`, WebAssembly.validate(bytes));

  // 3-4 MB of WAT per core, so the default 1 MB exec buffer is not enough.
  const wat = execFileSync(wasmDis, [path], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
  const simdUses = count(wat, SIMD);
  const relaxedUses = count(wat, RELAXED);

  if (core.simd) {
    check(`${core.label} still uses SIMD`, simdUses > 0, `v128/SIMD references ${simdUses}`);
  } else {
    check(`${core.label} stays scalar`, simdUses === 0, `v128/SIMD references ${simdUses}`);
  }
  check(`${core.label} has no relaxed-simd`, relaxedUses === 0, `relaxed references ${relaxedUses}`);
}

console.log(failures === 0 ? '\n[features] PASS' : `\n[features] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
