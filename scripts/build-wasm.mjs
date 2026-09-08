#!/usr/bin/env node
/**
 * Build the Rust DSP core for wasm32 and copy it next to the TS sources so Vite
 * can hash and precache it.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = resolve(root, 'crates/synth-core');
const out = resolve(root, 'src/generated/synth_core.wasm');
const built = resolve(crate, 'target/wasm32-unknown-unknown/release/synth_core.wasm');

const profile = process.env.WASM_PROFILE === 'debug' ? 'debug' : 'release';
const args = ['build', '--target', 'wasm32-unknown-unknown'];
if (profile === 'release') args.push('--release');

console.log(`[wasm] cargo ${args.join(' ')}`);
execFileSync('cargo', args, {
  cwd: crate,
  stdio: 'inherit',
  env: {
    ...process.env,
    // SIMD must be enabled on both sides of the C/Rust boundary.
    RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C target-feature=+simd128`.trim(),
  },
});

mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
const kb = (statSync(out).size / 1024).toFixed(1);
console.log(`[wasm] wrote src/generated/synth_core.wasm (${kb} KB, ${profile})`);
