# GS1 VST3 bundle — licenses and attribution

The plugin's own source code is MIT (LICENSE-MIT, same as the synth
repository). The distributed plugin binary additionally links:

- nih-plug (ISC, LICENSE-ISC-nih-plug): the VST3 wrapper framework.
  Copyright (c) 2022-2024 Robbert van der Helm.
- vst3-sys (GPLv3, LICENSE-GPLv3): a pure-Rust reimplementation of the
  VST3 COM interfaces. No Steinberg SDK is used and no Steinberg agreement
  is needed, but because the plugin binary links vst3-sys, **the
  distributed plugin binary is covered by the GPLv3**. The plugin source
  itself stays MIT, and the rest of the repository (including the web app,
  which does not link vst3-sys) is unaffected.
- DaisySP (MIT): vendored in `crates/synth-core/vendor/daisysp/`,
  pin `599511b7`, copyright Electrosmith 2020. Used for oscillators
  (polyBLEP), the Moog ladder filter, SVF, DC blocker and `dsp.h`.
- Soundpipe (MIT): vendored in `crates/synth-core/vendor/soundpipe/`,
  version 1.8.1, copyright Paul Batchelor 2020. Used for `base`, `delay`,
  `allpass`, `comb` and `revsc`.

Full third-party notices for the repository live in
`THIRD_PARTY_NOTICES.md` at the repository root.
