/**
 * `gs1.preset.apply` — make a preset the session's current patch.
 *
 * Two sources, both ending in `patch.set`'s own path (`commitPatch`):
 *
 *   * `{ presetId }` — a factory preset, resolved by `resolvePatch`;
 *   * `{ file }`     — a `.gs1.json` preset file inside the repository, read by
 *     the app's `parsePatchFile` (`src/state/patchfile.ts`), so a file this
 *     tool accepts is one the store's "load patch file" accepts. A
 *     `.gs1song` arrangement is not a patch and is refused.
 *
 * Nothing is written: applying is a session mutation, and the result is the same
 * summary `gs1.patch.set` returns.
 */
import { readFileSync } from 'node:fs';
import { resolvePatch, commitPatch } from '../lib/patch.mjs';
import { resolveReadPath, repoPath } from '../lib/paths.mjs';
import { ERRORS, fail } from '../lib/errors.mjs';

export default {
  name: 'gs1.preset.apply',
  description:
    'Apply a factory preset by id, or a .gs1.json preset file from the repository, as the session\'s current patch (the same path as gs1.patch.set).',
  inputSchema: {
    type: 'object',
    properties: {
      presetId: { type: 'string', minLength: 1, description: 'Factory preset id (see gs1.presets.list).' },
      file: { type: 'string', minLength: 1, description: 'A .gs1.json preset file inside the repository.' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const given = ['presetId', 'file'].filter((key) => args?.[key] !== undefined);
    if (given.length !== 1) {
      throw fail(ERRORS.SCHEMA, 'provide exactly one of `presetId` or `file`', { given });
    }

    if (args.presetId !== undefined) {
      const resolved = await resolvePatch(ctx.data, { presetId: args.presetId }, null);
      return { ...commitPatch(ctx, resolved, { applied: 'preset.apply' }), presetId: resolved.presetId };
    }

    const absolute = resolveReadPath(args.file, 'file');
    let text;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch (error) {
      throw fail(ERRORS.PATCH, `cannot read patch file: ${error?.message ?? error}`, { file: args.file });
    }
    const parsed = ctx.data.parsePatchFile(text);
    if (!parsed) {
      throw fail(ERRORS.PATCH, 'file is not a .gs1.json preset this repo can read', { file: args.file });
    }
    if (parsed.kind === 'song') {
      throw fail(ERRORS.PATCH, 'that file is a .gs1song arrangement, not a patch', { file: args.file });
    }
    const preset = parsed.preset;
    const resolved = await resolvePatch(
      ctx.data,
      {
        patch: {
          params: preset.params,
          params2: preset.params2 ?? null,
          instanceMode: preset.instanceMode ?? null,
          splitNote: preset.splitNote ?? null,
          routes: preset.routes,
        },
      },
      null,
    );
    return {
      ...commitPatch(ctx, resolved, { applied: 'preset.apply' }),
      name: preset.name,
      file: repoPath(absolute),
    };
  },
};
