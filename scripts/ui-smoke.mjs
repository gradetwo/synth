#!/usr/bin/env node
/**
 * Browser smoke run for the P13.4 layer: `npm run ui:smoke`.
 *
 * This is the *end-to-end* half of the UI tools' tests. The unit tests
 * (`mcp/ui/*.test.mjs`) prove the contract without a browser; this proves the
 * whole path -- MCP over stdio, the preview server, Chromium, the shared
 * frame-free click -- by driving the real server exactly as an MCP client does
 * and asserting on what comes back:
 *
 *   1. `gs1.ui.open` mounts the built app and reports the 1440x900 baseline;
 *   2. `gs1.ui.click` clicks the app's own start gate (which is why it is
 *      clickable at all: the gate is a modal over the shell);
 *   3. the preset library opens and a factory preset loads -- read back from the
 *      DOM with `gs1.ui.text`, so "the patch is live in the browser" is observed
 *      rather than assumed;
 *   4. `gs1.ui.screenshot` writes a PNG whose real size equals the visual
 *      baseline's.
 *
 * It is **not** in `npm run verify` / `verify:ci`: it needs Chromium and a built
 * `dist/`, which is exactly the reason `gs1.ui.*` is a separate entry point.
 * `npm run build` (or any earlier CI step that builds) has to have run first.
 *
 * Usage: node scripts/ui-smoke.mjs [--keep] [--port 4797]
 *   --keep  do not delete the screenshots it writes (they stay in .tmp/mcp/)
 *   --port  the preview port (default: GS1_MCP_UI_PORT or 4796)
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const portIndex = argv.indexOf('--port');
const port = portIndex >= 0 ? argv[portIndex + 1] : process.env.GS1_MCP_UI_PORT ?? '4796';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

if (!existsSync(resolve(ROOT, 'dist/index.html'))) {
  console.error('[ui:smoke] no dist/index.html — run "npm run build" first');
  process.exit(2);
}

/** The calls, in order. Each is the exact JSON-RPC `tools/call` arguments. */
const CALLS = [
  { tool: 'gs1.ui.open', args: { path: '/' } },
  { tool: 'gs1.ui.click', args: { selector: '.start-btn' } },
  { tool: 'gs1.ui.text', args: { selector: '[data-module-id=filter]', maxLength: 400 } },
  { tool: 'gs1.ui.click', args: { selector: '.tbtn.primary' } },
  { tool: 'gs1.ui.text', args: { selector: '.preset-drawer.open .pcard.current' } },
  { tool: 'gs1.ui.text', args: { selector: '.preset-drawer.open .pcard', all: true, maxLength: 60 } },
  { tool: 'gs1.ui.click', args: { selector: '.preset-drawer.open .pcard >> nth=84' } },
  { tool: 'gs1.ui.text', args: { selector: '.preset-drawer.open .pcard.current' } },
  { tool: 'gs1.ui.text', args: { selector: '[data-module-id=filter]', maxLength: 400 } },
  { tool: 'gs1.ui.click', args: { selector: '.preset-drawer.open .d-close' } },
  { tool: 'gs1.ui.screenshot', args: { name: 'ui-smoke.png' } },
];

console.log(`[ui:smoke] mcp/ui/server.mjs over stdio, preview port ${port}`);

const child = spawn('node', ['mcp/ui/server.mjs', '--no-log'], {
  cwd: ROOT,
  env: { ...process.env, GS1_MCP_UI_PORT: port },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const reader = createInterface({ input: child.stdout });
const pending = new Map();
reader.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const resolvePending = pending.get(message.id);
  if (resolvePending) {
    pending.delete(message.id);
    resolvePending(message);
  }
});

let nextId = 0;
const send = (method, params) =>
  new Promise((resolveSend) => {
    nextId += 1;
    pending.set(nextId, resolveSend);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params })}\n`);
  });

async function callTool(call) {
  const response = await send('tools/call', { name: call.tool, arguments: call.args ?? {} });
  if (response.error) throw new Error(`${call.tool}: JSON-RPC error ${JSON.stringify(response.error)}`);
  if (response.result?.isError) {
    const payload = response.result.structuredContent;
    throw new Error(`${call.tool} rejected: ${payload?.error?.code} ${payload?.error?.message}`);
  }
  return response.result.structuredContent;
}

const results = {};
try {
  await send('initialize', { protocolVersion: '2025-06-18' });
  for (const [index, call] of CALLS.entries()) {
    const started = Date.now();
    const result = await callTool(call);
    results[index] = result;
    console.log(`  · ${index + 1}/${CALLS.length} ${call.tool} ${JSON.stringify(call.args ?? {})} — ${Date.now() - started} ms`);
  }
} catch (error) {
  console.error(`[ui:smoke] FAIL — ${error.message}`);
  console.error(stderr.split('\n').slice(-10).join('\n'));
  child.kill('SIGTERM');
  process.exit(1);
}

const [opened, started, filterBefore, , currentBefore, cardList, , drawnAfter, filterAfter, , shot] = Object.values(results);

check('gs1.ui.open mounted the app', opened.mounted === true, `bootMs ${opened.bootMs}`);
check('gs1.ui.open reported console errors', opened.consoleErrors === 0, `${opened.consoleErrors} error(s)`);
check('gs1.ui.open used its own port, never 4783', opened.previewPort !== 4783, `port ${opened.previewPort}`);
check(
  'gs1.ui.open is at the visual baseline size',
  opened.viewport.width === 1440 && opened.viewport.height === 900,
  `${opened.viewport.width}x${opened.viewport.height} = splash-*-desktop-chromium-linux.png`,
);
check('gs1.ui.click clicked the app\'s start gate', started.ok === true && started.hitTested === true);
check('the shared implementation is named in the click result', /interact\.mjs/.test(started.implementation));
check('the preset drawer opened', /Crystal Pluck/.test(currentBefore.text ?? ''), currentBefore.text);
check('every factory preset is in the drawer list', cardList.count >= 91, `${cardList.count} cards`);
check('the factory preset loaded (DOM read-back)', /Crushed Lead/.test(drawnAfter.text ?? ''), drawnAfter.text);
check(
  'the filter readout changed with the patch',
  filterBefore.text !== filterAfter.text,
  `${filterBefore.text} -> ${filterAfter.text}`,
);
check('gs1.ui.screenshot wrote a real PNG', existsSync(resolve(ROOT, shot.screenshotPath)), shot.screenshotPath);
check('the screenshot is 1440x900', shot.width === 1440 && shot.height === 900, `${shot.width}x${shot.height}`);
check('the screenshot is the baseline size', shot.baseline?.matches === true, `${shot.baseline?.count} baselines`);

child.stdin.end();
await new Promise((done) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    done();
  }, 10_000);
  child.on('close', () => {
    clearTimeout(timer);
    done();
  });
});

if (!keep) {
  for (const name of ['ui-smoke.png']) {
    try {
      rmSync(resolve(ROOT, '.tmp/mcp', name), { force: true });
    } catch {
      // The screenshot is a report; failing to delete it is not a failure.
    }
  }
}

console.log('\n[ui:smoke] call sequence (JSON-RPC arguments, in order):');
console.log(JSON.stringify(CALLS.map((call) => call.args), null, 2));
console.log(`[ui:smoke] screenshot sha256 ${shot.sha256} (${shot.bytes} bytes)`);
if (failures.length) {
  console.error(`[ui:smoke] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[ui:smoke] PASS');
