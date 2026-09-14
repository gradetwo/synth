/**
 * `gs1.patch.set` — make a patch the session's current sound.
 *
 * Three ways in, one way through (`docs/LLM-INTERFACE.md` §4.2):
 *
 *   * `{ patch }`      — a whole patch: a share code or a payload object;
 *   * `{ presetId }`   — a factory preset by id;
 *   * `{ params, partial? }` — parameter edits. `partial: true` applies them on
 *     top of the session's current patch (that is what "partial" means here);
 *     without it the edit starts from the default patch.
 *
 * **Clamping is reported, never silent.** Values are clamped to the range
 * `src/audio/worklet-processor.js` actually serves and stepped parameters are
 * rounded; every number this function changed comes back in `clamped` as
 * `{ key, asked, got, reason }`. An unknown key is a rejection (`E_PARAM`), not
 * a dropped edit, and the share code in the result is the one the app itself
 * would produce for these parameters.
 */
import { resolvePatch, applyParams, commitPatch } from '../lib/patch.mjs';
import { ERRORS, fail } from '../lib/errors.mjs';
import { patchRef } from './_schemas.mjs';

export default {
  name: 'gs1.patch.set',
  description:
    'Set the session\'s current patch from a share code/payload, a factory preset id, or a {key:value} parameter edit. Returns the effective patch, its canonical share code and every value that had to be clamped.',
  inputSchema: {
    type: 'object',
    properties: {
      ...patchRef,
      params: {
        type: 'object',
        description:
          'Parameter edits as { key|id: value }. Keys come from gs1.params.list; values are clamped to the served range.',
      },
      partial: {
        type: 'boolean',
        description: 'With `params`: edit the session\'s current patch instead of starting from the default patch.',
      },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const given = ['patch', 'presetId', 'params'].filter((key) => args?.[key] !== undefined);
    if (given.length !== 1) {
      throw fail(ERRORS.SCHEMA, 'provide exactly one of `patch`, `presetId` or `params`', { given });
    }

    if (args.params !== undefined) {
      if (args.params === null || typeof args.params !== 'object' || Array.isArray(args.params)) {
        throw fail(ERRORS.SCHEMA, '`params` must be an object of { key: value }', { field: 'params' });
      }
      // `partial` reads the session; otherwise the edit starts from the default.
      const base = args.partial
        ? await resolvePatch(ctx.data, {}, ctx.session)
        : await resolvePatch(ctx.data, {});
      const { params, clamped } = applyParams(ctx.data, base.params, args.params);
      return commitPatch(
        ctx,
        {
          params,
          params2: args.partial ? base.params2 : null,
          instanceMode: args.partial ? base.instanceMode : 'single',
          splitNote: args.partial ? base.splitNote : 60,
          routes: args.partial ? base.routes : ctx.data.DEFAULT_ROUTES,
          presetId: args.partial ? base.presetId : null,
        },
        { applied: 'params', partial: Boolean(args.partial), clamped },
      );
    }

    const resolved = await resolvePatch(ctx.data, args, null);
    return commitPatch(ctx, resolved, {
      applied: args.presetId !== undefined ? 'presetId' : 'patch',
    });
  },
};
