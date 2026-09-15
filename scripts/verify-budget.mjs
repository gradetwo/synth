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
// permanent, and the ceiling was set to "measured + ~1.5 KB" rather than a
// round number with room to spare. **Settled by the delivered P11.1 measurement
// below**: the gzip line stayed where it was, and it has now been re-based to
// "measured + ~0.6 KB" instead.
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
//
// **P11.1 (`wasm-opt -Oz`) is delivered, and this block settles all three
// commitments above (P9.2, P9.1c, P10.3).** `binaryen` is now a devDependency
// and `scripts/build-wasm.mjs` runs `-Oz --all-features` on both cores right
// after cargo. Measured on this v1.104.0 tree, with node zlib level 9 (the
// same gzip this gate uses):
//   * SIMD core:   306 098 -> 210 475 B raw (-31.2 %), 74 872 -> 74 172 B gzip (-0.9 %);
//   * scalar core: 298 206 -> 193 685 B raw (-35.0 %), 71 851 -> 71 172 B gzip (-1.0 %);
//   * dist total: 1718.6 -> 1523.1 KB (-195.5 KB, -11.4 %).
// The optimisation is *equivalent*, not merely close: the dsp-baseline patch
// renders to the same 96 000 float samples in 1x and 2x on both cores, and
// `test:dsp` (0.030735), `verify:dsp:2x` (0.030852), all 81 preset fingerprints
// and every `verify:audio` assertion (P9.1b/P9.1c/P9.3 included) reproduce
// verbatim. It is a raw-byte win, so it pays the **dist** commitment in full and
// leaves the **wasm gzip** line essentially where it was — exactly what the P9.1b
// correction above predicted. Two consequences:
//   1. the P11.1 acceptance criterion in `docs/NEXT-PLAN-2.md` ("both cores gzip
//      down >=10 %", "abandon if <5 %") was wrong: measured gzip gain is ~1 % per
//      core, and the batch still earns its place because the dist total is raw;
//   2. from here on, wasm gzip growth is near-permanent and has to be declared,
//      which is why the wasm ceiling below is "measured + ~0.6 KB".
// The pass degrades gracefully: a missing/failing `wasm-opt` only warns and
// skips (the build never fails). The tightened dist ceiling below is what turns
// a skipped pass into a red gate — 1718.6 KB unoptimised is far past 1530 KB.
const BUDGETS = {
  // Measured 1535.7 KB after P9.4 shipped the graph's 2x (1530.7 KB with the
  // PDC landed but the graph still at 1x, 1523.1 KB after P11.1). The +5.0 KB
  // over that half-finished state is the graph node's own up/down round trip:
  // the 2x branch in `render_fx_node`, its input/wet scratch and the tests that
  // pin the node against the chain's. 1538 KB keeps the P8.5 "measured + small
  // margin" rule (~0.15 %, matching its ~0.45 % in spirit while staying tight
  // over a +5 KB step): it covers the release changelog entry that lands in the
  // first-screen chunk and nothing else. The next batch that grows the payload
  // comes back here and names its trade, as usual.
  //
  // P10.1 (timeline multi-select: marquee / Ctrl / Shift selection sets, batch
  // move / copy / paste / delete / resize / quantise, the cross-layer refusal
  // and the phone's multi-select bar) is the sixth UI batch and the second to
  // spend this budget. Measured on this tree, clean tree 1536.8 KB -> this batch
  // **1547.8 KB on the first build and 1547.9 KB on the `npm run verify` rebuild,
  // i.e. +11.0/11.1 KB**, and the wasm cores are byte-identical (this batch
  // touches no Rust; the three red lines reproduce verbatim — `test:dsp`
  // 0.030735, 81 preset fingerprints · ABI 8, `verify:dsp:2x` 0.030852). Where
  // it goes:
  //   * `PianoRoll-*.js` 18.4 -> 24.5 KB raw (+6.1 KB): the marquee gesture and
  //     its box, the selection-set plumbing and gesture settling, the batch edit
  //     calls, the selection bar and its buttons;
  //   * `index-*.js` raw (+~3 KB; first-screen JS gzip 133.3 -> 133.9 KB, still
  //     inside the unchanged 134 KB line): the 20 new zh/en string pairs in
  //     `i18n.ts`, most of them carrying a sentence of explanation;
  //   * `index-*.css` raw (+~1 KB; CSS gzip unchanged at 20.1 KB): the marquee
  //     box, the selection bar and the 36 px `pointer: coarse` targets;
  //   * the remainder is the hashed-name and service-worker churn every build
  //     carries, and the lazy `roll-*.js` chunk's copy of the selection module.
  // 1550, not 1548: the 1548 the batch proposed was measured at 1547.9 KB *before*
  // the release entry existed, and a release entry is not optional -- the head
  // moves into the lazy history chunk, so every release adds its own ~1 KB to
  // `dist` before anything else happens. That is a per-release cost the margin
  // has to include, and 1548 left 0.1 KB for it. Measured with the entry in
  // place: 1548.7 KB, so this is "measured + ~1.3 KB" -- and the entry itself was
  // trimmed once on the way here rather than the line simply moved.
  // `wasm` deliberately stays at 75 KB: this batch does not touch the engine.
  //
  // P10.2 (clip arrangement II: editing inside a clip, copying a clip to another
  // layer, and clip templates in the workspace) is the seventh UI batch and the
  // third to spend this budget. Measured on this tree with the v1.108.0 release
  // entry already in place: clean tree 1549.6 KB -> this batch **1555.9 KB**,
  // i.e. **+6.3 KB**, and `npm run verify`'s rebuild lands on the same figure.
  // The wasm cores are byte-identical (this batch touches no Rust; `test:dsp`
  // 0.030735, 81 preset fingerprints - ABI 8 and `verify:dsp:2x` 0.030852 all
  // reproduce verbatim), so this is a payload trade, not a sound one. Where the
  // 6.3 KB goes:
  //   * +2937 B `index-*.js` raw (gzip 91 940 -> 92 194, +254 B): ~0.9 KB of new
  //     zh/en strings (two trim passes down from ~1.9 KB) and ~2 KB of
  //     `midi/clips.ts` + `state/store.ts` + `state/layout.ts` code that the
  //     *boot* path needs, because a stored song has to be able to read its
  //     templates. The new arrangement primitives themselves are not here (see
  //     the `initialJs` note below).
  //   * +2222 B `PlayerPanel-*.js` raw (+469 B gzip): the second strip row
  //     (copy-to-layer picker, template picker/save/delete, and the `store`
  //     subscription that redraws them), and the clip-lane click now naming the
  //     block's layer.
  //   * +653 B `index-*.css` raw (gzip 20 134 -> 20 432 B): the `.clip-tools`
  //     row, its field/select and separator, all reusing the take chips' 36 px
  //     footprint rather than adding a second control language.
  //   * +442 B `roll-*.js` + 24 B `recording-*.js`: `state/roll.ts` grew by the
  //     two new arrangement operations (`copyToLayer`, `applyTemplate`) and the
  //     `setClip` layer argument; both lazy chunks that inline it carry the
  //     delta.
  //   * the remainder is the hashed-name and service-worker churn every build
  //     carries.
  // 1562 is the ceiling the P10.2 batch was authorised to, and it is "measured
  // + ~6.1 KB": the whole point of the authorisation was to cover a feature that
  // adds a UI row, a model module and ten bilingual strings, and the release
  // entry that follows this batch has to fit inside it too. The previous
  // "measured + ~1.3 KB" shape is deliberately *not* kept here -- there was not
  // 6.3 KB of headroom to do it in, and the honest version is to name the number
  // the feature actually cost.
  //
  // **P9.7 (wavetable/sampler interpolation) rebased this 1562 -> 1568 KB, and
  // the trade is declared rather than hidden.** The batch buys a real audio
  // result -- the five factory wavetables above 1 kHz went from -25.8...-46.7 dB
  // of non-harmonic energy to a worst case of -98.0 dB -- and it pays in wasm
  // *raw* bytes: the two cores together grew 3 702 B (SIMD 216 239 -> 217 198,
  // scalar 200 065 -> 202 808), which is the full extent of the overshoot. That
  // is the longer mip levels the fix needs, the sampler's f64 read position and
  // step, and the cubic interpolation. `dist total` sums raw bytes, so this line
  // is the one that moves; measured 1564.6 KB against the old 1562.
  // The line keeps the *same absolute margin* it had (1568 - 1564.6 = ~3.4 KB,
  // against 1562 - 1558.3 = ~3.7 KB) so it still absorbs a release's changelog
  // and ordinary build churn, and anything larger still has to be declared.
  // What the user actually downloads barely moves: the largest wasm **gzip**
  // went 74.3 -> 74.5 KB (inside the unchanged 75 KB line) and first-screen JS
  // and CSS are byte-for-byte unchanged. The next batch that needs size has to
  // buy this back rather than raise the line again.
  // **v2.0.0 (P10.4 project manager) rebased this 1568 -> 1595 KB, declared the
  // same way as the line above.** The feature is the largest single addition on
  // this line: `Projects-*.js` 18 428 B plus `Projects-*.css` 2 226 B are a
  // **lazy chunk** (reached from one `lazy()` row in the settings drawer, not
  // referenced by `index.html`), `i18n-panels` grew ~2.2 KB with the panel's
  // copy, and the rest is the usual hashed-name and service-worker churn.
  // Measured 1591.0 KB against the old 1568.
  //
  // What this line is *not* is the download budget: the part a first visit
  // fetches is `initialJs` below (measured 124.0 KB, gzip), and the project
  // manager does not touch it -- opening the drawer does. `dist total` sums raw
  // bytes of every chunk including the ones only reached by a click, so it is a
  // size-regression tripwire for the repository's output, and it moved by what
  // the feature cost (measured + ~4 KB margin, the same shape as the line
  // above). The next batch that needs size buys this back rather than raising it
  // again.
  // **v2.0.3 (P12.1 teaching) rebased this 1595 -> 1614 KB, declared the same
  // way as the two above.** The panel is a **lazy chunk** on purpose -- the
  // first-screen line above is down to ~0.2 KB and must not pay for a feature
  // nobody has opened -- but `dist total` sums every chunk, lazy ones included,
  // so this line is the one that moves: `Teaching-*.js` 10 855 B,
  // `Teaching-*.css` 2 335 B, `i18n.teach-*.js` 2 949 B, `index-*.js` +433 B,
  // and about 119 B of service-worker precache list for the three new names.
  // Measured 1610.1 KB against the old 1595. The margin is kept at the same
  // absolute shape as before (~3.9 KB), and the first-screen line did **not**
  // move: teaching costs a visitor who opens it 7.5 KB gzip, and costs a
  // visitor who does not open it nothing.
  // The next batch that needs size buys this back rather than raising it again.
  // **v2.0.5 rebased this 1614 -> 1619 KB**, same absolute margin as before
  // (~3.9 KB) at a measured 1615.0. The two fixes above add a little, and the
  // release changelog adds a little more; the line is a tripwire over the
  // repository's raw output rather than the download budget (that is
  // `initialJs`), so it moves with the work and the comment says what moved it.
  //
  // **The wasm line above is deliberately *not* moved.** Neither fix grew it
  // (75.0 KB before and after), so there is no trade to declare; it stays at
  // 75 KB with effectively no headroom and the next batch that needs wasm bytes
  // -- P9.10's clamp hoisting is the one already queued -- has to buy them back
  // or re-base with its own numbers.
  // **p141 capped the in-app changelog at 30 releases, and this line went *down*
  // 1619 -> 1550 KB.** The 1619 line existed because the release history grew by
  // ~1.2 KB per release for ever, and it broke on the v2.1.0 tag itself:
  // `dist total 1619.6 / 1619.0`, with `Changelog-*.js` up 113 366 -> 114 644 B
  // while both wasm cores were byte-identical (the third full sweep found it,
  // §一.39②). A re-base would have bought exactly one release, so the payload was
  // bought back instead: `src/changelog.ts` now ships the newest 30 entries and
  // ``src/changelog-archive.ts`` keeps the other 102 out of the bundle entirely.
  // Measured: `Changelog-*.js` 112.0 -> 33.5 KB, dist total 1619.6 -> 1540.9 KB
  // (-78.7 KB), with the whole 132-release history still in the repository and
  // `verify:release` still asserting uniqueness/order across both files.
  // The v2.1.1 release then measured **1540.2 KB** with its own entry in place --
  // slightly *below* the pre-release build, because the new note is shorter than
  // the 2.1.0 one it replaced and the rotation moved an entry out to the archive.
  // So the per-release cost is not even monotone any more; ~9 KB is plenty.
  //
  // 1550 is "measured + ~9 KB", and the margin is deliberately larger than the
  // 0.15 % the earlier notes used: a release entry is not optional and a rotation
  // adds a new head (~1-1.4 KB) plus the outgoing head moving from
  // `changelog-head.ts` into the shipped list (~1.3 KB) minus the oldest entry
  // dropping out (~0.9 KB) -- up to ~1.9 KB per release, so 1550 leaves several
  // releases of room rather than the 0.1 KB the old line left. The growth is
  // bounded now: the
  // shipped list is a fixed 30 and adding a release only rotates it.
  total: 1550 * 1024,
  // What `index.html` pulls, so the app code plus the React vendor chunk.
  //
  // **P11.2 (i18n split) settled the P10.2 debt and moved this line down
  // 136 -> 129 KB.** The 136 line was a written-down debt with an owner: P10.2
  // measured 134.6 KB (137 834 B exactly, 618 B past the old 134) and this batch
  // was named as the one that buys it back.
  //
  // What was done: `src/i18n.ts`'s flat 565-entry table was split structurally,
  // not wrapped. The first-screen core keeps only the copy the first frame can
  // render (174 keys: the boot gate, the top bar, the module grid with its
  // parameter labels and wave/mode names, the performance keyboard, and the
  // error strings the engine can toast before any panel exists). The other 355
  // keys ship in `src/i18n-panels.ts` and are registered at runtime: the effect
  // routing graph, the player panel with its takes and clip arrangement, the
  // piano roll, the preset library drawer, the imported wavetable/sampler rows,
  // the settings drawer (an off-canvas panel), the audio settings drawer, the
  // guide and changelog dialogs and the signal-flow canvas. That module is
  // reached only by `import()`, so its copy is not in the entry chunk. Each lazy
  // panel's import in `App.tsx` goes through its loader first; the three eager
  // components whose copy is lazy (the settings drawer and the two
  // imported-source pickers) gate on a sentinel key with `useStringsReady()`,
  // so they render nothing for that microtask instead of painting a key name.
  // After the move, **no core key has a lazy-only or gated-only reader**: every
  // one of the 174 is read by code that runs in the first frame.
  //
  // 36 keys were also **deleted as dead copy**, with the evidence: zero
  // references anywhere in `src/`, `e2e/`, `scripts/` or `index.html`. Sixteen
  // are the `module.<id>` names that `state/layout.ts` hard-codes as
  // `MODULE_META[i].title` (so the dictionary entry was never read), plus
  // `app.startHint`, `app.noScript` (the text lives in `index.html`'s
  // `<noscript>`), `top.power`, `panel.bins`, `module.wavePreview`,
  // `module.crushOn`, `module.eqOn`, `module.transientAttack/Sustain`,
  // `drawer.noResult`, `theme.switched`, `app.built`, `err.wasmMissing`,
  // `err.wasmInstantiate`, and 14 unused `fxg.ovr*` / `roll.*` / `player.*` /
  // `layer.*` entries. This follows the P10.2 precedent of dropping
  // `clip.tplDefaultName` outright rather than leaving unread copy behind.
  //
  // The key names themselves are **derived** from each table at registration
  // (`Object.keys`) rather than declared in a parallel `readonly string[]`. The
  // parallel list was the split's first design and it is the right shape for
  // `hasKey()` in the abstract, but it sits in the same chunk as the copy it
  // names, so `dist` (a raw byte sum) paid ~7 KB for strings that gzip had
  // already seen next to them. Registration is atomic, so a caller that gates on
  // "this table has arrived" probes one sentinel key instead of holding a list.
  //
  // Measured on this tree (node zlib level 9, the same gzip this gate uses):
  //   * `index-*.js`        299 983 -> 271 040 B raw, 92 238 -> 81 084 B gzip;
  //   * first-screen JS     137 878 -> 126 724 B gzip (134.65 -> 123.75 KB,
  //     **-10.89 KB**);
  //   * dist total          1556.9 -> 1558.3 KB (+1.4 KB, inside the unchanged
  //     1562 KB line).
  // The first screen is what the batch was for and the i18n chunk pays for
  // itself: the moved copy costs ~30 KB of new chunk and the 29 KB off the entry
  // plus the deleted dead copy covers it. A per-panel split (one i18n chunk per
  // lazy panel) was measured too and was 1.7 KB *worse* on `dist` (six more
  // chunk headers, six weaker compression contexts) for the same first-screen
  // number, which is why the copy is one module.
  //
  // 125 KB is "measured + ~1.2 KB": enough for the release changelog entry that
  // lands in the first-screen chunk (~0.3-0.5 KB per release) and a little
  // slack, and tighter than any previous value on this line.
  // **v2.0.5 rebased this 125 -> 126 KB.** That release is two *fixes* to
  // shipped regressions (`crushbass` was effectively silent, and importing a
  // MIDI file was refused when its name had no `.mid`), and fixing them cost
  // about 0.5 KB of first-screen code -- but the release's own changelog entry
  // lands in the entry chunk too, and together they pushed the measured value
  // from 124.7 to 125.05 KB, i.e. just past the old line. Re-basing keeps the
  // same shape as before (measured + ~0.95 KB) rather than letting a release
  // fail on the text describing it.
  // The lesson for the next batch is unchanged: this is the line a visitor
  // actually pays, so buy it back rather than raising it again.
  // **p926 moved this line down 126 -> 115 KB by not shipping the content at all.**
  // `src/state/presets.ts` (the 91-entry factory table) and `src/midi/library.ts`
  // -> `songs.ts` (the 25 built-in songs) were both reached from `store.ts`, so
  // every first visit downloaded them whatever the visitor did: measured 125.3 KB
  // gzip at v2.1.2, against a line with ~0.7 KB of room, which turned every later
  // content or copy change into a budget negotiation (see §一.26/§一.28).
  //
  // They are fetched on demand now: `ensurePresets()` when the preset drawer
  // opens, when the prev/next buttons are used, or when a stored id has to be
  // resolved; the song library when the player opens. `allPresets()` throws a
  // named `PresetsNotLoadedError` before that fetch instead of returning an empty
  // list, so a caller that forgets to await it fails loudly rather than painting
  // an empty drawer. The first screen keeps only the model and the boot patch's
  // identity, and the current preset's *name* travels in the saved document, so
  // the top bar can name the sound before the table arrives.
  //
  // Measured: initial JS 125.3 -> **113.5 KB** gzip (-11.8 KB, -9.4 %), with the
  // dist total up 6.5 KB raw (1540.2 -> 1546.7) because the two libraries are now
  // chunks of their own. The initial-JS line is what a visitor pays before the
  // first frame, so the trade goes the right way: 126 -> **115 KB**, i.e. measured
  // plus ~1.5 KB, which is also the headroom the next copy batch gets.
  initialJs: 115 * 1024,
  // Measured 19.7 KB gzip, 20.1 KB after P10.1, **20.2 KB** now: the new strip
  // row. Inside the line either way.
  initialCss: 21 * 1024,
  // The larger of the two cores. Measured 73.1 KB gzip after P9.3, 72.4 KB after
  // P11.1, 73.6 KB with the P9.4 PDC landed and 74.2 KB once the graph's 2x was
  // switched on: `wasm-opt -Oz` is a raw-byte win and only moved this gzip line
  // by ~0.9 % (see the P9.1b correction and the P11.1 block above), so this is a
  // deliberate, reviewed loosening rather than a real saving — 75 KB is
  // "measured + ~0.8 KB", keeping the "next gzip growth has to be declared"
  // property. The +0.6 KB over the PDC-only state is the graph node's round
  // trip (the 2x branch, its scratch and its tests). If `wasm-opt` is ever
  // skipped, the raw core is ~290 KB and this line fails, which is the intended
  // alarm.
  wasm: 75 * 1024,
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
