/**
 * `gs1.patch.get` — a whole patch, in the format the share link uses.
 *
 * The returned `shareCode` is produced by `encodePatch` from
 * `src/state/share.ts` and the returned `patch` is what `decodePatch` reads
 * back, so a code this tool hands out is one the app will open and vice versa.
 * `gs1.render` accepts either form.
 */
import { resolvePatch } from '../lib/patch.mjs';
import { patchRef } from './_schemas.mjs';

export default {
  name: 'gs1.patch.get',
  description:
    'Get a complete patch (default patch, or a factory preset by id) as a share code plus the decoded payload, in the app\'s own format.',
  inputSchema: {
    type: 'object',
    properties: { ...patchRef },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const payload = await resolvePatch(ctx.data, args);
    const preset = args?.presetId
      ? ctx.data.FACTORY_PRESETS.find((entry) => entry.id === args.presetId) ?? null
      : null;
    return {
      format: 'gs1-share-code',
      abi: ctx.abi,
      source: payload.source,
      presetId: payload.presetId ?? null,
      name: preset?.name ?? null,
      tag: preset?.tag ?? null,
      cat: preset?.cat ?? null,
      wave: preset?.wave ?? null,
      shareCode: payload.shareCode,
      instanceMode: payload.instanceMode ?? 'single',
      splitNote: payload.splitNote ?? null,
      routeCount: payload.routes.length,
      paramCount: Object.keys(payload.params).length,
      patch: {
        params: payload.params,
        params2: payload.params2,
        instanceMode: payload.instanceMode ?? null,
        splitNote: payload.splitNote ?? null,
        routes: payload.routes,
      },
    };
  },
};
