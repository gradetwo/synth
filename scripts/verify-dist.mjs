#!/usr/bin/env node
/**
 * Static verification of the built `dist/`.
 *
 * Guards the deployment contract: every referenced asset exists, the service
 * worker precaches the whole app shell, the manifest icons are present, and no
 * absolute `/` path sneaks in (so the bundle also works from a sub-directory).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

if (!existsSync(dist)) {
  console.error('[verify-dist] dist/ missing — run "npm run build" first');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((r) => !/^https?:|^data:|^#/.test(r));

check('index.html references only relative paths', refs.every((r) => !r.startsWith('/')), refs.filter((r) => r.startsWith('/')).join(', '));
for (const ref of refs) {
  check(`index.html asset ${ref}`, existsSync(join(dist, ref.replace(/^\.\//, ''))));
}

const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
// The update banner names the version the waiting worker installs, which means
// the generated worker has to carry it and answer `GET_VERSION` (P12.6). A
// `gen-sw.mjs` that stopped emitting either would leave the banner with no
// version at all — silent, not red — so the deployment gate checks both here.
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
check(`sw.js carries the release version (${pkgVersion})`, sw.includes(`const VERSION = '${pkgVersion}'`));
check('sw.js answers the version handshake', sw.includes("'GET_VERSION'") && sw.includes("type: 'VERSION'"));
const precacheMatch = sw.match(/const PRECACHE = (\[[\s\S]*?\]);/);
check('sw.js declares a precache list', Boolean(precacheMatch));
if (precacheMatch) {
  const precache = JSON.parse(precacheMatch[1]);
  const missing = precache.filter((p) => !existsSync(join(dist, p.replace(/^\.\//, ''))));
  check(`sw precaches ${precache.length} files`, missing.length === 0, missing.slice(0, 3).join(', '));
  check('sw precaches index.html', precache.includes('./index.html'));
  check('sw precaches the WASM core', precache.some((p) => p.endsWith('.wasm')));
  check('sw precaches the AudioWorklet', precache.some((p) => p.includes('worklet-processor')));
  check('sw precaches fonts', precache.some((p) => p.endsWith('.woff2') || p.endsWith('.woff')));
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
check('manifest start_url is relative', manifest.start_url.startsWith('./'));
check('manifest is standalone', manifest.display === 'standalone');
for (const icon of manifest.icons) {
  check(`manifest icon ${icon.src}`, existsSync(join(dist, icon.src.replace(/^\.\//, ''))));
}
check('manifest has a maskable icon', manifest.icons.some((i) => String(i.purpose).includes('maskable')));

const assets = readdirSync(join(dist, 'assets'));
check('worklet processor emitted', assets.some((f) => f.includes('worklet-processor')));
check('wasm core emitted', assets.some((f) => f.endsWith('.wasm')));

const total = (function walk(dir) {
  let sum = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    sum += statSync(full).isDirectory() ? walk(full) : statSync(full).size;
  }
  return sum;
})(dist);
console.log(`\n[verify-dist] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`} · dist total ${(total / 1024).toFixed(1)} KB`);
process.exit(failures === 0 ? 0 : 1);
