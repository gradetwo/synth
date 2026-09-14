/**
 * `gs1.patch.random` — the UI's "随机 / RANDOM" button, deterministically.
 *
 * The recipe is `Store.randomize()` in `src/state/store.ts` with a seeded
 * `mulberry32` in place of `Math.random()` (see `mcp/lib/random.mjs` for what
 * is transcribed and what stays the app's). `seed` is **required**: without it
 * the button is a slot machine and an agent cannot reproduce its own patch, so
 * a missing seed is a structured `E_SCHEMA` rather than a silent default.
 *
 * The generated patch becomes the session's current patch (it is a mutation,
 * exactly like the button), and its canonical share code is returned so the
 * caller can reproduce it later without the tool.
 */
import { commitPatch, applyParams } from '../lib/patch.mjs';
import { randomParams, MAX_RANDOM_SEED } from '../lib/random.mjs';
import { ERRORS, fail } from '../lib/errors.mjs';

export default {
  name: 'gs1.patch.random',
  description:
    'Generate a patch with the same recipe as the UI\'s RANDOM button, driven by a required seed. The same seed always produces byte-identical parameters.',
  inputSchema: {
    type: 'object',
    properties: {
      seed: {
        type: 'integer',
        minimum: 0,
        maximum: MAX_RANDOM_SEED,
        description: 'Required. Any unsigned 32-bit integer; same seed ⇒ same patch.',
      },
    },
    required: ['seed'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const seed = args?.seed;
    if (!Number.isInteger(seed) || seed < 0 || seed > MAX_RANDOM_SEED) {
      throw fail(ERRORS.SCHEMA, `seed is required and must be an integer between 0 and ${MAX_RANDOM_SEED}`, {
        field: 'seed',
        value: seed ?? null,
      });
    }

    const { params, ids } = randomParams(ctx.data, seed);
    // The recipe already draws inside the served ranges; the clamp step is the
    // same one `patch.set` uses, so an out-of-range draw would be reported
    // rather than entering the patch silently.
    const applied = applyParams(ctx.data, ctx.data.DEFAULT_PARAMS, params);
    const committed = commitPatch(
      ctx,
      {
        params: applied.params,
        params2: null,
        instanceMode: 'single',
        splitNote: 60,
        routes: ctx.data.DEFAULT_ROUTES,
      },
      { applied: 'random', clamped: applied.clamped },
    );
    return { ...committed, seed, randomised: ids };
  },
};
