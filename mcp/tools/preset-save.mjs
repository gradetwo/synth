/**
 * `gs1.preset.save` — write the current patch as a `.gs1.json` preset file.
 *
 * The bytes are the store's `exportCurrentPreset()` format (`format:
 * 'gs1-preset'`, `version: 1`, params, routes, and the layer only when the patch
 * uses one), so the file this tool writes is one the app's own "load patch file"
 * accepts — and `gs1.preset.apply { file }` reads it back through the same
 * parser. The default location is `.tmp/mcp/`; `src/` and `localStorage` are
 * never touched, and neither is the network.
 */
import { writeFileSync } from 'node:fs';
import { resolvePatch, patchFileFromPayload, safeFileName } from '../lib/patch.mjs';
import { resolveOutputPath, repoPath } from '../lib/paths.mjs';
import { sha256Hex } from '../lib/wav.mjs';

export default {
  name: 'gs1.preset.save',
  description:
    'Write the session\'s current patch (or the default patch) to a .gs1.json preset file under .tmp/mcp/, in the app\'s own user-preset format. Returns the path and the file sha256.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, description: 'Preset name stored in the file (default "GS1 Patch").' },
      outPath: {
        type: 'string',
        description: 'Where to write it; must stay inside .tmp/mcp/ (default: <name>.gs1.json there).',
      },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const fromSession = Boolean(ctx.session.patch);
    const payload = ctx.session.patch ?? (await resolvePatch(ctx.data, {}, null));
    const name = args.name?.trim() || 'GS1 Patch';

    const file = patchFileFromPayload(ctx.data, payload, name);
    const text = JSON.stringify(file, null, 2);
    const target = resolveOutputPath(args.outPath, `${safeFileName(name)}.gs1.json`);
    writeFileSync(target, text);

    const layered = 'params2' in file || (file.instanceMode !== undefined && file.instanceMode !== 'single');
    return {
      ok: true,
      format: 'gs1-preset',
      savePath: repoPath(target),
      name,
      byteLength: Buffer.byteLength(text),
      sha256: sha256Hex(Buffer.from(text)),
      paramCount: Object.keys(file.params).length,
      routeCount: file.routes.length,
      layered,
      source: fromSession ? 'session' : 'default',
      note: 'written in the app\'s .gs1.json preset format; src/ and localStorage are untouched',
    };
  },
};
