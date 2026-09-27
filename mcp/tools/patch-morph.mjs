/**
 * `gs1.patch.morph` — move the session's sound along one named attribute.
 *
 * The raw parameter surface is the right shape for a caller that knows what it
 * wants to change; it is the wrong shape for "make it warmer", which in this
 * instrument means moving several parameters together and in a direction. The
 * table of moves lives in `lib/morph.mjs` and is documented there, because the
 * interesting part of a macro is *what it does*, not the plumbing that applies it.
 *
 * Two deliberate properties:
 *
 *   * **It is a table, not a model call.** The same `(attribute, amount)` always
 *     produces the same parameters, so a caller can learn the vocabulary once and
 *     predict it afterwards. `moved` returns every parameter it touched with the
 *     value before and the value applied, which is what makes that checkable.
 *   * **It edits the session's current patch**, on top of whatever is there —
 *     that is what "make *this* sound warmer" means. `amount: 0` is a no-op that
 *     still returns the resolved patch.
 */
import { resolvePatch, applyParams, commitPatch } from '../lib/patch.mjs';
import { MORPH_NAMES, morphEdits } from '../lib/morph.mjs';

export default {
  name: 'gs1.patch.morph',
  description:
    'Move the session patch along one named attribute (warmth, air, brightness, width, softness) by `amount` (-1..1), through an explicit table of parameter moves. Returns every parameter it moved with its before/after value, every value the engine range had to clamp, and the new canonical share code.',
  inputSchema: {
    type: 'object',
    properties: {
      attribute: {
        type: 'string',
        enum: MORPH_NAMES,
        description: `Which way to move: ${MORPH_NAMES.join(', ')}. Each is a small, documented set of parameter moves (see docs/LLM-INTERFACE.md §4.2).`,
      },
      amount: {
        type: 'number',
        minimum: -1,
        maximum: 1,
        description:
          'How far along that attribute: 1 is the full move, -1 the full opposite, 0 a no-op. Applied on top of the session\'s current patch, so two calls accumulate.',
      },
    },
    required: ['attribute', 'amount'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const base = await resolvePatch(ctx.data, {}, ctx.session);
    const { spec, edits, moved } = morphEdits(ctx.data, base.params, args.attribute, args.amount);
    const { params, clamped } = applyParams(ctx.data, base.params, edits);
    const committed = commitPatch(
      ctx,
      {
        params,
        params2: base.params2,
        instanceMode: base.instanceMode,
        splitNote: base.splitNote,
        routes: base.routes,
        presetId: base.presetId,
      },
      { applied: 'morph', clamped },
    );
    return {
      ...committed,
      attribute: args.attribute,
      attributeLabel: spec.label,
      attributeSummary: spec.summary,
      amount: args.amount,
      /**
       * Every parameter this macro touched, `after` being the value the engine
       * will actually serve (so a clamp shows up here as well as in `clamped`).
       */
      moved: moved.map(({ key, id, before }) => ({
        key,
        id,
        before,
        after: params[id],
      })),
    };
  },
};
