/**
 * The `gs1.ui.*` tool files: `mcp/ui/tools/*.mjs`.
 *
 * Same contract as `mcp/tools/*.mjs` (`default export { name, description,
 * inputSchema, handler }`), scanned the same way, kept in a directory of its own
 * so that "the browser layer" is a *set of files* rather than a flag: the
 * offline entry point (`mcp/server.mjs` → `mcp/registry.mjs`) never sees them,
 * so `npm run mcp` stays as light as it was.
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UI_TOOLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'tools');

/** The UI tool files, sorted so `tools/list` is stable (helpers start with `_`). */
export function uiToolFiles() {
  return readdirSync(UI_TOOLS_DIR)
    .filter((file) => file.endsWith('.mjs') && !file.startsWith('_'))
    .sort();
}

/** Load every `gs1.ui.*` tool, refusing a half-registered one loudly. */
export async function loadUiTools() {
  const tools = new Map();
  for (const file of uiToolFiles()) {
    const module = await import(pathToFileURL(resolve(UI_TOOLS_DIR, file)).href);
    const tool = module.default;
    if (!tool || typeof tool.name !== 'string' || typeof tool.handler !== 'function') {
      throw new Error(
        `mcp/ui/tools/${file}: default export must be { name, description, inputSchema, handler }`,
      );
    }
    if (tools.has(tool.name)) throw new Error(`mcp/ui/tools/${file}: duplicate tool name "${tool.name}"`);
    tools.set(tool.name, { ...tool, file });
  }
  return tools;
}
