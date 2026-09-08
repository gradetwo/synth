# Vendored third-party DSP sources

The GS-1 audio core links real, unmodified upstream DSP code into the WASM
module. Only the modules the engine uses are vendored, and every vendored file
keeps its original copyright header and license.

## DaisySP

- **Upstream**: <https://github.com/electro-smith/DaisySP>
- **Commit**: `599511b740f8f3a9b8db72a0642aa45b8a23c3a3` (2025-05-28)
- **License**: MIT (see `daisysp/LICENSE`)
- **Vendored files**

  | File | Role |
  | :--- | :--- |
  | `Source/Synthesis/oscillator.{h,cpp}` | band-limited oscillators (polyBLEP) |
  | `Source/Filters/ladder.{h,cpp}` | Huovilainen Moog ladder filter |
  | `Source/Filters/svf.{h,cpp}` | double-sampled state variable filter |
  | `Source/Utility/dcblock.{h,cpp}` | DC blocker |
  | `Source/Utility/dsp.h` | shared helpers/macros |

  Not vendored: everything else in DaisySP. The full `daisysp.h` umbrella header
  is intentionally avoided so the module stays small.

  DaisySP's `Adsr` is deliberately **not** used: the engine needs one envelope
  instance per voice with an independently overridable release for smooth voice
  stealing, which the shared-parameter wrapper cannot express. The envelope is
  implemented natively in `src/dsp/adsr.rs` instead (see `DEPLOY.md`).

## Soundpipe

- **Upstream**: <https://github.com/PaulBatchelor/Soundpipe>
- **Version**: 1.8.1
- **License**: MIT (see `soundpipe/LICENSE`)
- **Vendored files**

  | File | Role |
  | :--- | :--- |
  | `h/base.h` + `modules/base.c` | `sp_data`, `sp_auxdata_alloc`, RNG |
  | `h/delay.h` + `modules/delay.c` | delay line |
  | `h/allpass.h` + `modules/allpass.c` | allpass (used by reverb chains) |
  | `h/comb.h` + `modules/comb.c` | comb filter |
  | `h/revsc.h` + `modules/revsc.c` | Csound-derived stereo reverb |

  `soundpipe.h` is **generated at build time** by `build.rs` by concatenating the
  vendored headers inside a single include guard — exactly what Soundpipe's own
  Makefile does. It is therefore not committed, and the vendored headers stay
  byte-identical to upstream.

## Freestanding shim layer

`c_bridge/shim/` provides the small set of C/C++ standard headers the vendored
code includes. On `wasm32-unknown-unknown` the build is `-nostdinc` +
`-ffreestanding`; the symbols those headers declare are supplied by Rust
(`src/shim.rs`) or by the fixed arena allocator (`src/alloc_arena.rs`). Nothing
is patched inside `vendor/`.
