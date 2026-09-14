/**
 * `gs1.params.list` — the parameter table, derived from the app's own files.
 *
 * Identity (`key`, `discrete`) and the label come from `src/audio/params.ts`;
 * the **range the browser actually serves** is parsed out of
 * `src/audio/worklet-processor.js` by `mcp/lib/data.mjs`. There is no third
 * copy: change a range in the worklet and this tool reports the new one, because
 * it reads the file.
 *
 * `nameZh` is `null` on purpose. This repository does not localise individual
 * knob labels (the UI shows the English abbreviations from `PARAM_SPECS`), so
 * there is no authoritative Chinese name to invent here.
 */
import { parameterTable } from '../lib/data.mjs';

export default {
  name: 'gs1.params.list',
  description:
    'List every engine parameter: id, key, label, min, max, default, unit, discrete. Optionally filter by substring.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', minLength: 1, description: 'Case-insensitive substring of id, key or label.' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const all = parameterTable(ctx.data);
    const needle = args?.filter?.toLowerCase();
    const params = needle
      ? all.filter(
          (entry) =>
            String(entry.id) === needle ||
            entry.key.toLowerCase().includes(needle) ||
            (entry.nameEn ?? '').toLowerCase().includes(needle),
        )
      : all;
    return { count: params.length, total: all.length, params };
  },
};
