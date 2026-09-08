# Third-party notices

This project links or bundles the following third-party components. The full
license text of the vendored DSP libraries ships next to their sources under
`crates/synth-core/vendor/`.

## Runtime DSP (vendored source, compiled into the WASM core)

| Component | Version / commit | License | Location |
| :--- | :--- | :--- | :--- |
| [DaisySP](https://github.com/electro-smith/DaisySP) | `599511b7` | MIT | `crates/synth-core/vendor/daisysp/` |
| [Soundpipe](https://github.com/PaulBatchelor/Soundpipe) | 1.8.1 | MIT | `crates/synth-core/vendor/soundpipe/` |

Vendored modules: DaisySP oscillators (polyBLEP), Moog ladder filter, SVF, DC
blocker, `dsp.h`; Soundpipe `base`, `delay`, `allpass`, `comb`, `revsc`.
See `crates/synth-core/vendor/VENDOR.md` for the exact file list and the
freestanding shim strategy.

## Front-end dependencies

| Package | License | Purpose |
| :--- | :--- | :--- |
| [React](https://react.dev/) / React DOM | MIT | UI |
| [Vite](https://vitejs.dev/) | MIT | build tooling (dev dependency) |
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 | type checking (dev dependency) |
| [Vitest](https://vitest.dev/) | MIT | unit tests (dev dependency) |
| [@fontsource/space-grotesk](https://fontsource.org/fonts/space-grotesk) | OFL-1.1 | self-hosted display font |
| [@fontsource/ibm-plex-mono](https://fontsource.org/fonts/ibm-plex-mono) | OFL-1.1 | self-hosted monospace font |

Space Grotesk and IBM Plex Mono are bundled as WOFF2/WOFF subsets so the PWA
works with no network access. CJK glyphs intentionally fall back to the
operating system font (PingFang SC, Microsoft YaHei, Noto Sans CJK), which keeps
the offline bundle small.

## Reference UI

The visual design and interaction model are ported from the project's own
`synth_demo.html` prototype supplied with the design brief. No third-party UI
kit is used.
