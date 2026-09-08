#!/usr/bin/env node
/**
 * Build the Rust DSP core for wasm32 and copy it next to the TS sources.
 *
 * Two variants are produced so the app runs on the widest browser range:
 *   synth_core.wasm         — WebAssembly SIMD (Chrome 91+, Safari 16.4+)
 *   synth_core_scalar.wasm  — scalar fallback (older Safari / no SIMD)
 *
 * The engine feature-detects SIMD at runtime and picks the matching module.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
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

mkdirSync(outDir, { recursive: true });

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
  console.log(`[wasm]   -> ${(statSync(out).size / 1024).toFixed(1)} KB`);
}
