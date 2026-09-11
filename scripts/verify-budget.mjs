#!/usr/bin/env node
/**
 * Performance budget gate.
 *
 * Fails the build when the shipped bundle grows past the agreed budgets, and
 * checks that the MP3 encoder stays a lazy chunk instead of riding in the
 * initial payload. Run after `npm run build`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

if (!existsSync(dist)) {
  console.error('[budget] dist/ missing — run "npm run build" first');
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const files = walk(dist);
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initialRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1].replace(/^\.\//, ''))
  .filter((ref) => /\.(js|css)$/.test(ref));

const initialJs = initialRefs.filter((ref) => extname(ref) === '.js');
const initialCss = initialRefs.filter((ref) => extname(ref) === '.css');

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const initialJsGz = initialJs.reduce((sum, ref) => sum + gz(join(dist, ref)), 0);
const initialCssGz = initialCss.reduce((sum, ref) => sum + gz(join(dist, ref)), 0);
const wasmGz = files
  .filter((file) => file.endsWith('.wasm'))
  .reduce((max, file) => Math.max(max, gz(file)), 0);
const lame = files.find((file) => /lamejs-.*\.js$/.test(file));

const BUDGETS = {
  total: 1700 * 1024,
  // What `index.html` pulls, so the app code plus the React vendor chunk.
  // Raised from 150 KB when the routing graph and song sharing landed
  // (measured 151.7 KB): the editor, piano roll, drawers and the flow canvas
  // were moved into their own chunks first, and this covers what is genuinely
  // needed to paint the first screen.
  initialJs: 165 * 1024,
  initialCss: 22 * 1024,
  wasm: 230 * 1024,
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log('[budget] shipped payload:');
check(`dist total ${kb(totalBytes)}`, totalBytes <= BUDGETS.total, `budget ${kb(BUDGETS.total)}`);
check(
  `initial JS gzip ${kb(initialJsGz)} (${initialJs.length} file(s))`,
  initialJsGz <= BUDGETS.initialJs,
  `budget ${kb(BUDGETS.initialJs)}`,
);
check(
  `initial CSS gzip ${kb(initialCssGz)}`,
  initialCssGz <= BUDGETS.initialCss,
  `budget ${kb(BUDGETS.initialCss)}`,
);
check(`largest WASM gzip ${kb(wasmGz)}`, wasmGz <= BUDGETS.wasm, `budget ${kb(BUDGETS.wasm)}`);
check('MP3 encoder stays a lazy chunk', Boolean(lame) && !initialRefs.some((ref) => /lamejs/.test(ref)),
  lame ? 'lamejs-*.js not referenced by index.html' : 'lamejs chunk missing');

if (failures > 0) {
  console.error(`[budget] FAIL · ${failures} budget(s) exceeded`);
  process.exit(1);
}
console.log('[budget] PASS');
