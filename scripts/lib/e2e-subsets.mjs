/**
 * The bounded E2E slices the slow lanes run, in one place.
 *
 * `scripts/nightly-e2e.mjs` has always owned these lists (and the docs point at
 * it instead of copying them); the slow-lane packer needs the same slices, and
 * importing the nightly script is not an option — it is a top-level program that
 * starts a run as soon as it is loaded. So the lists live here and both import
 * them: **one source of truth**, and `scripts/verify-ci.mjs` asserts the timer's
 * `--core` choice against the same names it always did.
 *
 * Layer: Node only. No Playwright, no browser.
 */

/** The phone/tablet-first slice: viewports, touch, text fit, boot, graph, share, drawer, theme. */
export const CORE_SUBSET = [
  'e2e/responsive.spec.ts', // iPhone/iPad, both orientations
  'e2e/touch.spec.ts',
  'e2e/text-fit.spec.ts',
  'e2e/boot.spec.ts',
  'e2e/fxgraph.spec.ts',
  'e2e/share.spec.ts',
  'e2e/drawer.spec.ts',
  'e2e/theme.spec.ts',
];

/** Render-everything, compare-nothing on WebKit/Firefox. */
export const VISUAL_SUBSET = ['e2e/visual.spec.ts'];

/** The browser side of the sound path. */
export const AUDIO_SUBSET = [
  'e2e/smoke.spec.ts', // boots, starts the engine, plays a note
  'e2e/audio.spec.ts', // engine numbers, preload, polyphony
  'e2e/filter.spec.ts',
  'e2e/delay.spec.ts',
  'e2e/fm.spec.ts',
  'e2e/oversample.spec.ts',
  'e2e/wavetable.spec.ts',
  'e2e/sample.spec.ts',
  'e2e/meter.spec.ts', // idle monitor readout
];

/** One file, for checking a harness change in seconds rather than minutes. */
export const SMOKE_SUBSET = ['e2e/smoke.spec.ts'];

/** Named slices; `all` is the empty list, i.e. "let Playwright collect everything". */
export const SUBSETS = {
  smoke: SMOKE_SUBSET,
  core: CORE_SUBSET,
  nightly: [...CORE_SUBSET, ...VISUAL_SUBSET, ...AUDIO_SUBSET],
  all: [],
};

/** The slice for a name, de-duplicated, or `null` for an unknown name. */
export function subsetFor(name) {
  return name in SUBSETS ? [...new Set(SUBSETS[name])] : null;
}
