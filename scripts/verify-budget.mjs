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
// it. P11.1 (`wasm-opt -Oz`) is the batch that has to buy it back; if it does
// not, the next feature pays. **Corrected by P9.1b** (measured with binaryen
// 132 on this machine): `wasm-opt -Oz --all-features` takes both cores from
// 297737/291595 to 201662/188535 bytes raw (-32.3 % / -35.3 %) but only
// 72197/69342 to 71272/68244 gzip (-1.3 % / -1.6 %). So P11.1 buys back the
// *dist* total handily and barely moves the wasm gzip line -- the old note's
// "a projected >=10 % off both cores" was about raw bytes only.
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
//
// P9.1b (band-limited ordinary oscillators) is the third and the largest: the
// total moves 1678 -> 1684 KB, and this one is a *sound* change, not an effect
// that can be switched off. Measured: clean tree 1677.6 KB / largest wasm gzip
// 69.4 KB, this batch 1683.0 KB / 71.2 KB. The +5.4 KB is +4.1 KB of wasm on
// the SIMD core and +1.4 KB on the scalar one (the rest is the hashed-name and
// service-worker churn that any build carries). What the code buys: saw,
// square, pulse and triangle stop using DaisySP's two-point polyBLEP and emit
// the naive shape with BLEP/BLAMP corrections at 2x through the existing 95-tap
// Kaiser decimator, which is what drops the keyboard's off-grid floor from
// -37/-39/-49 dB to -100/-111/-73 dB (BH-7 ruler, 4 s windows, real wasm).
// The 64 KB of BLEP/BLAMP tables that path needs are built at start-up into
// BSS, so they cost no wasm bytes at all — only the ~5 KB of code does.
// This is the batch that re-recorded `tests/dsp-baseline{,-2x}.json` and all 81
// preset fingerprints on purpose.
// P9.3 (per-node effect parameters) is the fourth, and it is the first batch
// that spends the budget on *ids and resolution* rather than on a new effect.
// Measured: clean tree 1683.9 KB / largest wasm gzip 71.2 KB, this batch
// 1709.8 KB / 73.1 KB. The +25.9 KB is:
//   * +10.5 KB of wasm raw (both cores: the override pool, the per-node resolve
//     loop and the `fx_base` mapping — the `[_; PARAM_COUNT]` smoother arrays
//     grew with the 41 new ids, which is where most of it goes);
//   * +9.7 KB of `index-*.js` raw (+1.7 KB gzip: 41 ids and their defaults, the
//     worklet's PARAM table, the editor's override block and its bus rows);
//   * +3.8 KB of `index-*.css` raw (+0.3 KB gzip: the override controls,
//     including the 36 px targets a coarse pointer gets);
//   * +2.3 KB in the lazy FxGraphEditor chunk, plus the hashed-name and
//     service-worker churn every build carries.
// The editor stylesheet deliberately reuses the existing `.fxg-gain`,
// `.fxg-src`, `.fxg-mix-label` and `.fxg-gain-val` rules for the override rows
// instead of adding a parallel set, and the modulation bus is rendered as one
// row per node rather than one per core row; both were done before this note
// was written and are already in the measurement above.
//
// **Correction to the P9.1b note below.** P11.1 (`wasm-opt -Oz`) buys back the
// *dist total* handily — it removes 32-35 % of wasm **raw**, which is what the
// dist total sums — but it does **not** buy back the wasm **gzip** line: the
// measured gzip gain is 71 272 (from 72 197) and 68 244 (from 69 342), i.e.
// about 1 KB per core. This batch's +1.9 KB of gzip is therefore close to
// permanent, and the ceiling below is "measured + ~1.5 KB" rather than a
// round number with room to spare.
//
// P10.3 (take second pass: rename / A-B audition / merge strategies / the
// clips x take rule) is the fifth, and it is the first *UI* batch to spend the
// budget. Measured with a same-tree A/B build (stash the batch, rebuild, diff
// per chunk): clean tree 1711.4 KB, this batch 1717.6 KB, **+6.16 KB**. The
// whole increase is JS/CSS and the wasm cores are byte-identical, so this is a
// payload trade, not a sound one:
//   * +3521 B `PlayerPanel-*.js`: the inline rename field, the A/B pair of
//     buttons and their hint, the second merge button and the folded-layer
//     notice;
//   * +1262 B `index-*.js` (first screen): the nine new zh/en string pairs in
//     `i18n.ts`. Measured first-screen JS gzip 133.0 -> 133.5 KB, still inside
//     the unchanged 134 KB line;
//   * +624 B `index-*.css`: the rename field, the A/B row, `.take-btn.on/.ok`
//     and the two note lines. Measured CSS gzip 19.9 -> 20.1 KB, inside 21;
//   * +513 B `recording-*.js` and +392 B `roll-*.js`: `take-edit.ts` is bundled
//     into each lazy chunk that imports it, so the new guards cost their bytes
//     twice. A shared chunk would be the way to claw that back if it is ever
//     worth it; trimming the copy that makes the folded-layer refusal explicit
//     would not be.
// The batch was authorised to 1720 KB on these numbers. The release entry will
// add the usual ~0.5-1 KB of first-screen churn, so the real headroom here is
// ~1.4 KB. P11.1 still has to buy the whole thing back (its ~90 KB of raw wasm
// is the largest single item in this total).
const BUDGETS = {
  // Measured 1717.6 KB after P10.3 (1711.4 KB on the clean tree, +6.16 KB).
  // 1720 KB keeps the P8.5 "measured + small margin" rule; the margin covers
  // the changelog entry that lands in the first-screen chunk at release time.
  total: 1720 * 1024,
  // What `index.html` pulls, so the app code plus the React vendor chunk.
  // Measured 131.2 KB gzip. +2.8 KB (+2.1 %); the P8.5 plan target was 140 KB,
  // so this is the tight version of an already-reached goal.
  initialJs: 134 * 1024,
  // Measured 19.7 KB gzip. +1.3 KB.
  initialCss: 21 * 1024,
  // The larger of the two cores. Measured 73.1 KB gzip after P9.3 (71.2 KB on
  // the clean tree, +1.9 KB). `wasm-opt` will not bring this back — see the
  // correction above — so it is a deliberate, reviewed bump. P10.3 did not
  // touch the engine and this line measured 73.1 KB again.
  wasm: 74 * 1024,
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
