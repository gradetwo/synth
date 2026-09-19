/**
 * The UI's "随机 / RANDOM" button, made deterministic.
 *
 * `docs/LLM-INTERFACE.md` §4.2 asks for "the same random button, with a seed
 * that must be present". The button lives in `src/state/store.ts`
 * (`Store.randomize()`, line 604) and draws from `Math.random()`; it cannot be
 * imported and replayed because its sequence is the global unseeded generator.
 * `mcp/` therefore owns only what the store cannot give it:
 *
 *   * the **recipe** — which parameter ids the button writes and the range each
 *     one is drawn from, transcribed from `store.randomize()` with the same
 *     distributions (`10 ** r(2.1, 4.2)` for the cutoff, the same `pick([…])`
 *     choices, the same probabilities);
 *   * a **seeded PRNG** in place of `Math.random()`.
 *
 * Everything else is still the app's: the defaults being overlaid come from
 * `DEFAULT_PARAMS`, the wave list from `WAVES`, and the result goes through the
 * same clamp/round step as `patch.set` (`mcp/lib/patch.mjs`).
 *
 * Two guards keep the transcription honest rather than trusting a comment:
 * `mcp.test.mjs` reads the `randomize()` body out of `store.ts` and asserts
 * this recipe writes the same set of parameter ids, and the ranges are checked
 * against the worklet's served range by the clamp step (a value the engine
 * would not accept shows up in `clamped`, never silently in the patch).
 *
 * **The PRNG is part of the interface**: `mulberry32`, one 32-bit state word.
 * Changing it changes every seeded patch, which is why it is named and pinned
 * by a test.
 */

/** Largest seed the tool accepts: a full unsigned 32-bit integer. */
export const MAX_RANDOM_SEED = 0xffffffff;

/** The deterministic generator. Same seed ⇒ same sequence, in every engine. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The button's recipe over a seeded stream.
 *
 * @returns `{ params, ids }` — a full parameter record and the ids the recipe
 *   actually wrote (so a caller can report what was randomised, and a test can
 *   compare against `store.randomize()`).
 */
export function randomParams(data, seed) {
  const next = mulberry32(seed);
  const r = (a, b) => a + next() * (b - a);
  const pick = (arr) => arr[(next() * arr.length) | 0];
  const wave = () => data.WAVES.indexOf(pick(data.WAVES));

  const params = { ...data.DEFAULT_PARAMS };
  params[1] = 1;
  params[2] = wave();
  params[3] = pick([0, 0, 0, -12, 12]);
  params[4] = r(-20, 20);
  params[5] = r(0.4, 0.8);
  params[7] = next() > 0.25 ? 1 : 0;
  params[8] = wave();
  params[9] = pick([0, 0, 0, -12, 7]);
  params[10] = r(-30, 30);
  params[11] = r(0.2, 0.6);
  params[13] = pick([0, 0, 0, 1, 2]);
  params[14] = 10 ** r(2.1, 4.2);
  params[15] = r(0, 0.9);
  params[16] = r(0, 0.6);
  params[17] = r(0, 0.8);
  params[18] = next() > 0.5 ? 1 : 0;
  params[19] = 10 ** r(-3, -0.5);
  params[20] = 10 ** r(-2, 0.2);
  params[21] = r(0, 0.9);
  params[22] = 10 ** r(-2, 0.5);
  params[23] = next() > 0.4 ? 1 : 0;
  params[24] = pick([0, 1, 2, 3]);
  params[25] = r(0.2, 12);
  params[26] = r(0.1, 0.8);
  params[27] = pick([0, 0, 1, 2]);
  params[29] = next() > 0.4 ? 1 : 0;
  params[30] = r(0.2, 0.9);
  params[31] = r(0.1, 0.5);
  params[32] = next() > 0.5 ? 1 : 0;
  params[33] = pick([0, 1, 2, 3]);
  params[34] = r(0.2, 0.6);
  params[35] = r(0.1, 0.35);

  return {
    params,
    ids: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 30, 31, 32, 33, 34, 35],
  };
}
