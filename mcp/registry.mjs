/**
 * The tool registry, built by **scanning the directory**.
 *
 * There is deliberately no hand-written list here. P13.3 (`patch.set`,
 * `patch.random`, `sample.import`, …) and P13.4 (`gs1.ui.*`) add their own files
 * in other worktrees; because this module reads `mcp/tools/*.mjs`, two tracks
 * can add tools without touching a shared file — the merge-conflict hotspot
 * `parallel-dev.md` warns about is avoided by construction.
 *
 * The contract for a tool file: default-export
 * `{ name, description, inputSchema, handler(args, ctx) }`. Helper modules start
 * with `_` and are skipped, and the scan is sorted by filename so
 * `tools/list` and the golden session are stable. **To add a tool you create
 * one file under `mcp/tools/` and change nothing else.**
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadData, parameterTable, packageVersion } from './lib/data.mjs';
import { initCore, ex, SR } from '../scripts/lib/render-core.mjs';

export const TOOLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'tools');

/** The files that define tools, in the order they will be listed. */
export function toolFiles() {
  return readdirSync(TOOLS_DIR)
    .filter((file) => file.endsWith('.mjs') && !file.startsWith('_'))
    .sort();
}

/**
 * Load every tool. Throws loudly if a file does not export the contract — a
 * half-registered tool is worse than a server that refuses to start.
 */
export async function loadTools() {
  const tools = new Map();
  for (const file of toolFiles()) {
    const module = await import(pathToFileURL(resolve(TOOLS_DIR, file)).href);
    const tool = module.default;
    if (!tool || typeof tool.name !== 'string' || typeof tool.handler !== 'function') {
      throw new Error(
        `mcp/tools/${file}: default export must be { name, description, inputSchema, handler }`,
      );
    }
    if (tools.has(tool.name)) throw new Error(`mcp/tools/${file}: duplicate tool name "${tool.name}"`);
    tools.set(tool.name, { ...tool, file });
  }
  return tools;
}

/**
 * The context every handler receives: the app's data, the ABI the engine
 * reports, and whether calls go to the audit log.
 */
export async function loadContext({ log = true } = {}) {
  const data = await loadData();
  initCore();
  return {
    data,
    abi: ex.gs_abi_version(),
    sampleRate: SR,
    version: packageVersion(),
    paramCount: parameterTable(data).length,
    logEnabled: log,
  };
}
