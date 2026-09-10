// Drive the reproducer: feed a 440 Hz sine in 128-sample blocks vs one single
// call and report the difference.  Same module, same code, only the chunking
// differs, so any difference is state lost at the block boundary.
//
// The two runs use two different voice slots (0 and 1) so both start from the
// same all-zero state: LadderFilter::Init() does not clear z0_/z1_.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? 'repro.wasm';
const CHUNK = 128, N = 4096, SR = 48000;

const bytes = readFileSync(resolve(here, file));
const { instance } = await WebAssembly.instantiate(bytes, {});
const ex = instance.exports, mem = ex.memory;

const inPtr = 65536 - 32 - N * 8; // scratch inside the first page
const outPtr = inPtr + N * 4;
const inF = new Float32Array(mem.buffer, inPtr, N);
for (let i = 0; i < N; i++) inF[i] = 0.8 * Math.sin(2 * Math.PI * 440 * i / SR);

function run(voice, chunk) {
  ex.r_init(SR);
  ex.r_set(voice, 1200, 0.4, 0.3);
  const out = new Float32Array(N);
  const dst = new Float32Array(mem.buffer, outPtr, N);
  for (let off = 0; off < N; off += chunk) {
    const n = Math.min(chunk, N - off);
    ex.r_block(voice, inPtr + off * 4, outPtr, n);
    out.set(dst.subarray(0, n), off);
  }
  return out;
}

const chunked = run(0, CHUNK);
const single = run(1, N);
let maxD = 0, maxI = -1;
for (let i = 0; i < N; i++) {
  const d = Math.abs(chunked[i] - single[i]);
  if (d > maxD) { maxD = d; maxI = i; }
}
console.log(`${file}:  max |chunked - single| = ${maxD.toExponential(4)} at sample ${maxI}`);
console.log(`  correct sample 128 (single call) : ${single[128].toFixed(6)}`);
console.log(`  actual   sample 128 (128-chunks) : ${chunked[128].toFixed(6)}`);
console.log(`  verdict: ${maxD < 1e-9 ? 'CLEAN (state preserved across blocks)' : 'BROKEN (state wiped at the block boundary)'}`);
