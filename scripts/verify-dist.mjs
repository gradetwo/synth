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
const workletAsset = assets.find((f) => f.includes('worklet-processor'));
check('worklet processor emitted', Boolean(workletAsset));

// What ships is the build's *minified* copy of the readable processor
// (`scripts/worklet-min.ts`), not the source itself: the source stays the single
// truth for the protocol gates and the harness, but it carries ~12 KB of
// comments a visitor must not download. Three properties are pinned here — the
// dist bytes are exactly the generated copy's bytes (so the content hash Vite
// derived names the content that actually shipped, rather than a rename), the
// asset is clearly smaller than the source, and it is one line instead of the
// source's readable formatting.
const workletSourcePath = join(root, 'src/audio/worklet-processor.js');
const workletMinPath = join(root, 'src/generated/worklet-processor.min.js');
check('minified worklet generated', existsSync(workletMinPath));
if (workletAsset && existsSync(workletMinPath)) {
  const built = readFileSync(join(dist, 'assets', workletAsset), 'utf8');
  const generated = readFileSync(workletMinPath, 'utf8');
  const source = existsSync(workletSourcePath) ? readFileSync(workletSourcePath, 'utf8') : '';
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  check(`worklet asset ${workletAsset} is the generated copy`, built === generated);
  check(
    `worklet asset is minified (${kb(built.length)} vs source ${kb(source.length)})`,
    source.length > 0 && built.length < source.length * 0.6,
  );
  check('worklet asset is minified (single line)', built.split('\n').length <= 3);
}
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
