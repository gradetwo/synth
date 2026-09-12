#!/usr/bin/env node
/**
 * Performance budget gate.
 *
 * Fails the build when the shipped bundle grows past the agreed budgets, and
 * checks that the MP3 encoder stays a lazy chunk instead of riding in the
 * initial payload. Run after `npm run build`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

if (!existsSync(dist)) {
  console.error('[budget] dist/ missing — run "npm run build" first');
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const files = walk(dist);
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initialRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1].replace(/^\.\//, ''))
  .filter((ref) => /\.(js|css)$/.test(ref));

const initialJs = initialRefs.filter((ref) => extname(ref) === '.js');
const initialCss = initialRefs.filter((ref) => extname(ref) === '.css');

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const initialJsGz = initialJs.reduce((sum, ref) => sum + gz(join(dist, ref)), 0);
const initialCssGz = initialCss.reduce((sum, ref) => sum + gz(join(dist, ref)), 0);
const wasmGz = files
  .filter((file) => file.endsWith('.wasm'))
  .reduce((max, file) => Math.max(max, gz(file)), 0);
const lame = files.find((file) => /lamejs-.*\.js$/.test(file));

// Every number below is "what this build measured + a small margin", not a
// round target. They were re-based in P8.5 (v1.95.0) after the payload was
// clawed back: the four PWA icons moved from PNG24 to a PNG8 palette (73.7 KB
// -> 24.7 KB, visually identical, measured RMSE <= 0.10 %), which took the
// whole dist from 1711.7 KB to 1662.8 KB. That is why the old 1712 KB ceiling
// (raised from 1700 KB for the P6.4 bit-crusher and shaping EQ — a trade that is
// now repaid in full) could be *lowered* rather than raised again, and why the
// margin is now ~0.5 % instead of the ~12 KB that P6.4 spent: the next batch
// that grows the payload has to come back and name its trade here.
//
// P9.2 (the transient shaper) is the first batch to take that invitation and
// the reason the total moved 1672 -> 1676 KB: +2.5 KB of wasm on the SIMD core,
// +2.3 on the scalar one and +1.4 KB of JS for an effect that is off by default.
// The clean tree had 4.1 KB of headroom, so the feature spent essentially all of
// it. P11.1 (`wasm-opt -Oz`, a projected >=10 % off both cores) is the batch
// that has to buy it back; if it does not, the next feature pays.
//
// P9.1c (hard-sync restart alignment) is the second, and it moved the total
// 1676 -> 1678 KB. The clean tree measured 1675.9 KB, so it had 0.1 KB of
// headroom and any behaviour change at all would have overrun it. The whole
// +0.4 KB is the two wasm cores, +196 bytes each (the gate script is not in
// `dist`, so nothing here is a script-growth trade): `sync_kernel` has to know
// that a query landed in the one 1/64-sample cell that spans the BLEP table's
// step-residual jump, which is one extra comparison and one conditional add per
// tap. What that buys: before it, a master wrap whose sub-sample position
// walked into that cell got a correction of the wrong sign and nearly full
// magnitude, so the restart residual burst from below -110 dB to -33 dB for
// about 11 s out of every ~24 s (86 dB of window-to-window spread). After it,
// every four-second window of every waveform and ratio measures -88 dB or
// better (12 scenes x 36 windows, real wasm). P11.1 still has to buy the whole
// thing back, P9.2 included — that commitment is unchanged.
const BUDGETS = {
  // Measured 1676.3 KB after P9.1c (1675.9 KB on the clean tree, +0.4 KB of
  // wasm). The 1678 KB ceiling keeps the P8.5 "measured + small margin" rule.
  total: 1678 * 1024,
  // What `index.html` pulls, so the app code plus the React vendor chunk.
  // Measured 131.2 KB gzip. +2.8 KB (+2.1 %); the P8.5 plan target was 140 KB,
  // so this is the tight version of an already-reached goal.
  initialJs: 134 * 1024,
  // Measured 19.7 KB gzip. +1.3 KB.
  initialCss: 21 * 1024,
  // The larger of the two cores. Measured 67.9 KB gzip. +2.1 KB: any change to
  // the DSP core should be a deliberate, reviewed bump.
  wasm: 70 * 1024,
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log('[budget] shipped payload:');
check(`dist total ${kb(totalBytes)}`, totalBytes <= BUDGETS.total, `budget ${kb(BUDGETS.total)}`);
check(
  `initial JS gzip ${kb(initialJsGz)} (${initialJs.length} file(s))`,
  initialJsGz <= BUDGETS.initialJs,
  `budget ${kb(BUDGETS.initialJs)}`,
);
check(
  `initial CSS gzip ${kb(initialCssGz)}`,
  initialCssGz <= BUDGETS.initialCss,
  `budget ${kb(BUDGETS.initialCss)}`,
);
check(`largest WASM gzip ${kb(wasmGz)}`, wasmGz <= BUDGETS.wasm, `budget ${kb(BUDGETS.wasm)}`);
check('MP3 encoder stays a lazy chunk', Boolean(lame) && !initialRefs.some((ref) => /lamejs/.test(ref)),
  lame ? 'lamejs-*.js not referenced by index.html' : 'lamejs chunk missing');

if (failures > 0) {
  console.error(`[budget] FAIL · ${failures} budget(s) exceeded`);
  process.exit(1);
}
console.log('[budget] PASS');
