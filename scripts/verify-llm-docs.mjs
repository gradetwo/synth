#!/usr/bin/env node
/**
 * The LLM-interface documentation gate (P13.5).
 *
 * `docs/LLM-INTERFACE.md` and `docs/notes/mcp.md` are the *contract* an external
 * agent reads before it can use this repository's tool server, and a contract
 * that drifts from the code is worse than no contract. This gate pins the three
 * things that drift first:
 *
 *   1. **Tool names, both ways.** Every `gs1.*` verb the documents name must be
 *      in the live registry (`mcp/tools/*.mjs` + `mcp/ui/tools/*.mjs`, loaded
 *      the same way the server loads them), and every registered tool must be
 *      named in at least one of the two documents — a tool nobody documented is
 *      a tool no external agent can call.
 *   2. **Limits.** The documents' caps are compared with the constants that
 *      enforce them (`mcp/lib/render.mjs`), never with a second copy: change
 *      `MAX_SECONDS` and this gate goes red until the document says the new
 *      number.
 *   3. **Error codes.** The `E_*` vocabulary in the documents must equal the
 *      codes the server can actually return (`mcp/lib/errors.mjs`, including the
 *      `E_INTERNAL` fallback), both ways.
 *
 * It also pins the two entry-point counts (14 offline + 5 browser = 19), the
 * ports (`gs1.ui.*` needs `dist/` and Chromium and never touches the E2E
 * suite's 4783), and that the published `inputSchema` uses the same constants
 * the handlers enforce.
 *
 * **No wasm, no browser, no `dist/`.** Loading the registry imports the tool
 * modules but never instantiates a core, so this runs before/independently of a
 * build. Usage:
 *
 *   node scripts/verify-llm-docs.mjs                 # the repository's docs
 *   node scripts/verify-llm-docs.mjs --docs-root D   # a copy, for self-proofs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTools } from '../mcp/registry.mjs';
import { loadUiTools } from '../mcp/ui/registry.mjs';
import { renderFields } from '../mcp/tools/_schemas.mjs';
import { ERRORS } from '../mcp/lib/errors.mjs';
import { MAX_SECONDS, MIN_SECONDS, MAX_NOTES, MAX_SEED, SAMPLE_RATES } from '../mcp/lib/render.mjs';
import { DEFAULT_PORT as UI_PORT, E2E_PORT } from '../mcp/ui/lib/preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The documents this gate reads, in the order it reads them. */
export const DOC_FILES = ['LLM-INTERFACE.md', 'notes/mcp.md'];

/**
 * `gs1.ui.gate` -> an exact name; `gs1.ui.*` -> the family `gs1.ui.`; `gs1.*` ->
 * the whole registry. A segment starts with a lowercase letter, which is also
 * what keeps a share code (`gs1.1.eyJ…`) and the preset file name
 * (`.gs1.json`) out of the token stream.
 */
const TOOL_TOKEN = /(?<![\w.])gs1\.([a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*)(\.\*)?/g;
const ALL_FAMILY = /(?<![\w.])gs1\.\*/g;
const CODE_TOKEN = /\bE_[A-Z][A-Z0-9_]*\b/g;

/** Arguments: `--docs-root <dir>` (default `docs/`). */
function parseArgs(argv) {
  const options = { docsRoot: resolve(root, 'docs') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--docs-root') options.docsRoot = resolve(argv[++i] ?? '.');
    else if (arg.startsWith('--docs-root=')) options.docsRoot = resolve(arg.slice('--docs-root='.length));
    else throw new Error(`unknown argument "${arg}"`);
  }
  return options;
}

/** Every `gs1.*` token in `text`, split into exact tool names and family prefixes. */
export function extractToolTokens(text) {
  const names = new Set();
  const families = new Set();
  for (const match of text.matchAll(ALL_FAMILY)) families.add('gs1.');
  for (const match of text.matchAll(TOOL_TOKEN)) {
    const [, name, star] = match;
    if (star) families.add(`gs1.${name}.`);
    else names.add(`gs1.${name}`);
  }
  return { names, families };
}

/** Every `E_*` code in `text`. */
export const extractErrorCodes = (text) => new Set([...text.matchAll(CODE_TOKEN)].map((m) => m[0]));

/** The `E_*` vocabulary the server can actually return, read from its one table. */
export function serverErrorCodes(source) {
  return new Set([...source.matchAll(/'E_[A-Z][A-Z0-9_]*'/g)].map((m) => m[0].slice(1, -1)));
}

/** The default port of the loopback HTTP entry point, read from its `parseArgs`. */
export function defaultHttpPort(source) {
  const match = /port:\s*(\d{2,5})/.exec(source);
  if (!match) throw new Error('mcp/server.mjs: could not find the default HTTP port');
  return Number(match[1]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const tools = await loadTools();
  const uiTools = await loadUiTools();
  const registered = new Set([...tools.keys(), ...uiTools.keys()]);

  const docs = DOC_FILES.map((file) => {
    const path = resolve(options.docsRoot, file);
    return { file, path, text: readFileSync(path, 'utf8') };
  });
  const allText = docs.map((doc) => doc.text).join('\n');
  const allCodes = new Set();
  const docNames = new Set();
  const docFamilies = new Set();
  for (const doc of docs) {
    const { names, families } = extractToolTokens(doc.text);
    for (const name of names) docNames.add(name);
    for (const family of families) docFamilies.add(family);
    for (const code of extractErrorCodes(doc.text)) allCodes.add(code);
  }

  const errorSource = readFileSync(resolve(root, 'mcp/lib/errors.mjs'), 'utf8');
  const serverCodes = serverErrorCodes(errorSource);
  const httpPort = defaultHttpPort(readFileSync(resolve(root, 'mcp/server.mjs'), 'utf8'));

  const failures = [];
  const check = (name, ok, detail = '') => {
    if (!ok) failures.push(name);
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  console.log('[llm-docs] registry');
  check('the registry is 14 offline tools', tools.size === 14, `${tools.size} loaded from mcp/tools/*.mjs`);
  check('the registry is 5 browser tools', uiTools.size === 5, `${uiTools.size} loaded from mcp/ui/tools/*.mjs`);
  check('no name is registered twice', registered.size === tools.size + uiTools.size);
  check('the offline registry has no gs1.ui.* tool', [...tools.keys()].every((name) => !name.startsWith('gs1.ui.')));
  check('the documents state the live counts',
    allText.includes(`${tools.size} 个离线工具`)
    && allText.includes(`${uiTools.size} 个浏览器工具`)
    && allText.includes(`${registered.size} 个工具`),
    `docs must say "${tools.size} 个离线工具", "${uiTools.size} 个浏览器工具", "${registered.size} 个工具"`);

  console.log('[llm-docs] tool names');
  const unknownNamed = [...docNames].filter((name) => !registered.has(name)).sort();
  check('every gs1.* name in the docs is registered', unknownNamed.length === 0,
    unknownNamed.length ? `unregistered: ${unknownNamed.join(', ')}` : `${docNames.size} distinct names`);
  const unmentioned = [...registered].filter((name) => !docNames.has(name)).sort();
  check('every registered tool is named in the docs', unmentioned.length === 0,
    unmentioned.length ? `undocumented: ${unmentioned.join(', ')}` : `${registered.size} tools documented`);
  const badFamilies = [...docFamilies].filter((prefix) => ![...registered].some((name) => name.startsWith(prefix)));
  check('every gs1.* family in the docs matches at least one tool', badFamilies.length === 0,
    badFamilies.length ? `matched nothing: ${badFamilies.join(', ')}` : [...docFamilies].join(', ') || '(none)');

  console.log('[llm-docs] limits (derived from mcp/lib/render.mjs)');
  check(`seconds is documented as ${MIN_SECONDS} ≤ seconds ≤ ${MAX_SECONDS}`,
    allText.includes(`${MIN_SECONDS} ≤ seconds ≤ ${MAX_SECONDS}`));
  check(`notes is documented as notes ≤ ${MAX_NOTES}`, allText.includes(`notes ≤ ${MAX_NOTES}`));
  check(`the render seed is documented as seed ≤ ${MAX_SEED}`, allText.includes(`seed ≤ ${MAX_SEED}`));
  check(`the only sample rate is documented as ${SAMPLE_RATES[0]}`,
    SAMPLE_RATES.length === 1 && allText.includes(String(SAMPLE_RATES[0])));
  check('the published render schema uses the same seconds bounds',
    renderFields.seconds.minimum === MIN_SECONDS && renderFields.seconds.maximum === MAX_SECONDS,
    `schema ${renderFields.seconds.minimum}..${renderFields.seconds.maximum} vs code ${MIN_SECONDS}..${MAX_SECONDS}`);
  check('the published render schema uses the same notes cap',
    renderFields.notes.maxItems === MAX_NOTES, `schema ${renderFields.notes.maxItems} vs code ${MAX_NOTES}`);
  check('the published render schema uses the same seed cap',
    renderFields.seed.maximum === MAX_SEED, `schema ${renderFields.seed.maximum} vs code ${MAX_SEED}`);
  check('the published render schema uses the same sample rates',
    JSON.stringify(renderFields.sampleRate.enum) === JSON.stringify(SAMPLE_RATES),
    `schema ${JSON.stringify(renderFields.sampleRate.enum)} vs code ${JSON.stringify(SAMPLE_RATES)}`);

  console.log('[llm-docs] ports (derived from the modules that bind them)');
  check(`the browser layer's own port is documented as ${UI_PORT}`, allText.includes(String(UI_PORT)));
  check(`the E2E suite's port is documented as ${E2E_PORT} and never taken`, allText.includes(String(E2E_PORT)));
  check(`the loopback HTTP entry point's default port is documented as ${httpPort}`, allText.includes(String(httpPort)));
  check('the browser prerequisites are documented',
    allText.includes('npx playwright install chromium') && allText.includes('dist/'));

  console.log('[llm-docs] error codes (derived from mcp/lib/errors.mjs)');
  const unknownCodes = [...allCodes].filter((code) => !serverCodes.has(code)).sort();
  check('every E_* code in the docs exists in the server', unknownCodes.length === 0,
    unknownCodes.length ? `not a server code: ${unknownCodes.join(', ')}` : `${allCodes.size} codes`);
  const undocumentedCodes = [...serverCodes].filter((code) => !allCodes.has(code)).sort();
  check('every server code is documented', undocumentedCodes.length === 0,
    undocumentedCodes.length ? `missing from the docs: ${undocumentedCodes.join(', ')}` : `${serverCodes.size} codes`);
  check('the documented vocabulary equals ERRORS plus the E_INTERNAL fallback',
    serverCodes.size === new Set([...Object.values(ERRORS), 'E_INTERNAL']).size
    && [...Object.values(ERRORS), 'E_INTERNAL'].every((code) => serverCodes.has(code)),
    `server codes: ${[...serverCodes].sort().join(', ')}`);

  console.log('[llm-docs] entry points');
  for (const script of ['npm run mcp', 'npm run mcp:ui', 'npm run ui:smoke']) {
    check(`the docs name "${script}"`, allText.includes(script));
  }

  if (failures.length) {
    console.error(`[llm-docs] FAIL — ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('[llm-docs] PASS');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(`[llm-docs] fatal: ${error?.stack ?? error}`);
    process.exit(1);
  });
}
