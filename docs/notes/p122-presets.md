# P12.2 — engine-showcase factory presets

Ten patches whose reason to exist is to make four engine features audible from
the factory bank. They use **only parameter ids that already existed** — this
batch adds no ids, so the four-way sync (`params.rs` / `params.ts` /
`worklet-processor.js` / `i18n`) is untouched and the ABI stays **8**.

| Preset id | Name (en · zh) | Capability | What it is for |
| :--- | :--- | :--- | :--- |
| `semmorph` | SEM Morph Pad · SEM 变形铺底 | SEM dual filter | `FILTER_TYPE 6` with `FILTER_MORPH 0.25` (between low-pass and band-pass) on the first stage, a second SEM in **series** (`FILTER_ROUTING 1`), and a slow LFO dragging the morph position. The point is that the multimode *position* moves, not just the cutoff. |
| `semparabass` | SEM Parallel Bass · SEM 并联低音 | SEM dual filter | `FILTER_ROUTING 2` puts the two SEM stages **side by side** and `FILTER_BLEND 0.42` mixes them: a dark low-pass under a brighter band-pass, which is a bass tone the serial chain cannot make. |
| `semnotch` | SEM Notch Drone · SEM 陷波嗡鸣 | SEM dual filter | `FILTER_MORPH 0.67` parks the SVF on its **notch**; the filter envelope then drags the notch upward over two seconds, so a held drone opens into a vowel-like hole rather than a brighter tone. |
| `crushlead` | Crushed Lead · 位粉碎主音 | Bit-crusher | Chain slot 6 becomes kind 7 (`crush`) and `FX_CRUSH_ON` arms it; 6-bit quantiser at 8× decimation with 25 % anti-aliasing for a bright, obviously digital lead. |
| `crushbass` | Crushed Sub · 位粉碎低音 | Bit-crusher | The extreme end: 4 bits, 12× decimation, 60 % AA. A sine sub turned into a stepped square-ish drone. |
| `tapecrush` | Tape Crush Keys · 磁带粉碎键盘 | Bit-crusher | The gentle end: 10 bits, 2× decimation, 90 % AA, 45 % mix — a lo-fi texture under a clean triangle, not destruction. |
| `osdrive` | Oversampled Drive · 过采样驱动 | Oversampling | `OVERSAMPLE 1` (P6.5) runs the saturating filter path **and** the drive node at 2× and band-limits back. `FILTER_DRIVE 0.85` plus the drive node is exactly the case where the folded-back aliases would otherwise be audible. |
| `osbass` | Oversampled Sub · 过采样低音 | Oversampling | A low, hard-driven saw sub with the same 2× path: the harmonics the saturator generates stay where they belong instead of wrapping into the band. |
| `graphpump` | Graph Pump · 图内泵动 | In-graph modulation | `FX_GRAPH 1` switches the effect section from the chain to the routing graph; edge 1 is `LFO 1 → node 6 out gain` at depth 0.85, so the crusher node's output is pumped by a square LFO at 5.5 Hz. |
| `graphswell` | Graph Swell · 图内涌动 | In-graph modulation | Two live edges: the **envelope** swells node 6's output gain (depth 0.9) while **LFO 2** nudges the EQ node at 0.5 depth. The graph modulates itself, with no voice-level routing involved. |

## Loudness

`PATCH_TRIM` gained ten entries, each measured (not guessed) with
`TRIM_DUMP=1 npx vitest run src/audio/preset-loudness.test.ts` and set so the
new patches land on the bank's median (-40.87 dBFS). Measured spread with the
new entries: **7.8 dB** (gate allows < 9.0).

## The table is now a flat pair list (option B: buy the space back)

The batch had a hard size problem: `presets.ts` and `songs.ts` are both eager
(`store.ts` imports `FACTORY_PRESETS` and `midiLibrary` at start-up), the two
dist lines were effectively full, and the budget note in `scripts/verify-budget.mjs`
says the next batch that needs bytes **buys them back rather than raising the
line again**. So the factory table was re-encoded, with no semantic change:

* a patch's parameters are a flat `id, value, id, value …` list in an array
  instead of an object literal (`{ [P.FILTER_CUTOFF]: 9000 }` -> `P.FILTER_CUTOFF, 9000`);
  the brackets, colons and repeated `P.` keys were several kilobytes of the
  first-screen chunk for no runtime difference;
* a pair whose value already equals `DEFAULT_PARAMS` is gone (283 of them,
  15.8 %): `presetParams` merges over the defaults anyway, so the merge result is
  unchanged;
* each patch's measured loudness trim moved out of the separate `PATCH_TRIM`
  table and into its own list as `PATCH_GAIN`, so it sits next to the parameters
  it was measured against. (That table alone was ~647 B of gzip: 91 preset-id
  strings plus their values.)

**The proof that the refactor is semantic-free is the fingerprint gate itself:**
`npm run verify:presets` and `verify:presets:2x` were run **before** re-recording
and reported the ten new ids as `new preset` and *nothing else* — no movement on
any of the 81 existing entries, against the untouched v2.0.1 baseline. At the
file level the diff is one changed `reason` line and ten added lines; the 81
existing preset lines are byte-identical (sha256 of the 81 normalised lines:
`8ec92ded…` 1x, `709109c8…` 2x, before and after).

Measured (node zlib level 9, the gate's own gzip):

| | before | after B + 10 presets + 5 songs |
| :--- | :--- | :--- |
| `initial JS` gzip | 126 769 B (123.8 KB) | 127 597 B (124.6 KB) |
| `dist total` | 1592.2 KB | 1592.0 KB |

So the ten presets and the five songs cost **+828 B of gzip**, and the whole
thing is **0.2 KB smaller on `dist total` than the tree it started from** (the
audition gate is a test file and is not bundled). `test:dsp` (0.030735) and
`verify:dsp:2x` (0.030852) are unchanged — nothing here touches the default
patch.

Five public-domain songs were also added (20 -> 25): *When the Saints Go
Marching In*, *Sakura Sakura*, *Minuet in G* (BWV Anh. 114), *Frère Jacques* and
*Londonderry Air*, each with a `source: { kind: 'public-domain', credit }` block.

## Proofs

* `src/audio/preset-audition.test.ts` — for every patch: RMS/peak floors,
  all-finite samples, nothing above the limiter ceiling, the capability switch
  is on, and **switching it off changes the rendered samples** (max sample
  difference 3.45e-3 … 1.98e-1, all above the 1e-4 bar). That last one is the
  difference between "the id is set" and "the id is what you hear".
* `e2e/preset-audition.spec.ts` — loads each patch from the drawer in Chromium
  and holds a key until the app's own VU caption leaves its silence floor.
* `npm run verify:presets` / `:2x` — the fingerprints were rebuilt **on
  purpose** (`presets:update` with a `--reason`); the ten new entries are the
  only ones that moved.

