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
| `crushbass` | Crushed Sub · 位粉碎低音 | Bit-crusher | The extreme end: 6 bits, 12× decimation, 60 % AA, 90 % wet. A sine sub turned into a stepped, aliased drone. **Was 4 bits — see "The crushbass fix" below.** |
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

## The `crushbass` fix (found by the slow-track sweep on v2.0.3)

`worklet-processor.test.ts`'s existing all-preset guard found it: it plays one
middle C through the worklet and fails any patch whose peak stays under 0.003.
`crushbass` measured **0.0020** — audible only as leakage, ~30 dB below the other
bass patches.

**Cause.** The crusher quantises with `step = 2 / 2^bits`
(`dsp::fx_shaping::quantise`). At 4 bits that step is **0.125**, and this patch's
pre-effect peak is about **0.044**: every capture rounded to zero, so the wet leg
of the crossfade was *silence* and the only sound was the `1 - mix = 10 %` dry
leak. Measured proof — one middle C over the guard's own 0.652 s window, peak,
with the mix swept to show which leg is producing the sound:

| voicing | `MIX 0` (dry) | `MIX 1.0` (wet) | `MIX 0.9` (the preset) |
| :--- | ---: | ---: | ---: |
| original (4 bit, gain 0.442) | 0.01950 | **0.00000** | 0.00195 (= 0.1 x dry) |
| fixed (6 bit, gain 0.36) | 0.01588 | 0.02344 | 0.02258 |

The original's wet leg is *exactly* zero, and its output is exactly the 10 % dry
leak; the fixed one's wet leg is alive and is now the sound you hear.

**Fix.** `FX_CRUSH_BITS 4 -> 6` puts the step at 0.03125, below the signal, so
the crusher actually quantises; `PATCH_GAIN 0.442 -> 0.36` brings the now-working
crusher back to the bank median. `FX_CRUSH_DOWN` (12x) and `FX_CRUSH_AA` (60 %)
are unchanged, so it is still a hard, aliased, obviously-6-bit crush — not a
clean bass. Measured: single middle C peak **0.00195 -> 0.02258** (7.5x the
guard's bar), phrase level **-43.96 -> -40.98 dBFS** against the bank's -40.87
median, and the crusher now moves the waveform (max sample difference against
`FX_CRUSH_ON 0`: 0.0131, versus 0.0080 before).

Why not just raise `PATCH_GAIN`? Because it is the *same* knob that drives the
crusher: raising it far enough to cross the 4-bit LSB also makes the crushed
square (which is inherently ±0.125, about -18 dBFS) the output, putting the patch
11-20 dB above the bank median and breaking `preset-loudness` (spread 7.8 -> 9.6
dB and worse). The clean version of this patch is **already** too loud for the
spread gate (-38.40 dBFS), so the preset only passed before because the broken
crusher was silencing it. 4 bits cannot satisfy both gates at this voicing; 6 can.

## Proofs

* `src/audio/preset-audition.test.ts` — for every patch: a **single middle C**
  (the register a player hits first, and the case the old chord-only render
  masked) must reach **peak >= 0.003**, the same bar `worklet-processor.test.ts`
  uses and on the same window, so the two gates cannot disagree; the chord's RMS
  floor is raised from 1e-4 (-80 dBFS, which let a -59 dBFS patch through) to
  1e-3 (-60 dBFS, still ~19 dB under the bank median). Plus all-finite samples,
  nothing above the limiter ceiling, the capability switch is on, and
  **switching it off changes the rendered samples** (max sample difference
  3.45e-3 … 1.98e-1, all above the 1e-4 bar).
* `e2e/preset-audition.spec.ts` — loads each patch from the drawer in Chromium
  and holds a key until the app's own VU caption leaves its silence floor.
* `npm run verify:presets` / `:2x` — the fingerprints were rebuilt **on
  purpose** (`presets:update` with a `--reason`); the ten new entries are the
  only ones that moved, and after the `crushbass` fix that one entry is the only
  one that moved again.

