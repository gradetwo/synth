/**
 * `gs1.presets.list` — the factory library, read from `src/state/presets.ts`.
 */
export default {
  name: 'gs1.presets.list',
  description: 'List the factory presets: id, name, tag/category, wave and whether the patch uses a second layer.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (_args, ctx) => {
    const presets = ctx.data.FACTORY_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      tag: preset.tag,
      cat: preset.cat,
      wave: preset.wave,
      tags: [preset.cat, preset.tag],
      user: Boolean(preset.user),
      hasLayer: Boolean(preset.params2),
      instanceMode: preset.instanceMode ?? 'single',
    }));
    return { count: presets.length, categories: ctx.data.PRESET_CATEGORIES, presets };
  },
};
