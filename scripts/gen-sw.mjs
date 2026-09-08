#!/usr/bin/env node
/**
 * Generate `dist/sw.js` after `vite build`.
 *
 * Every emitted asset is content-hashed, so the cache version can be derived
 * from the build itself: change anything and the version changes, the new worker
 * precaches into a fresh cache, and the old cache is deleted on activate. The
 * worker deliberately does *not* call `skipWaiting()` on install — the update
 * banner asks the user first (see `src/pwa/register.ts`).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist)
  .map((f) => ({ abs: f, rel: relative(dist, f).split('\\').join('/') }))
  .filter((f) => f.rel !== 'sw.js');

// The scalar WASM core is only needed on browsers without SIMD, so it is fetched
// (and then cached by the fetch handler) on demand instead of being precached.
const DEFERRED = /synth_core_scalar-.*\.wasm$/;
const precacheFiles = files.filter((f) => !DEFERRED.test(f.rel));

const hash = createHash('sha256');
for (const file of files.sort((a, b) => a.rel.localeCompare(b.rel))) {
  hash.update(file.rel);
  hash.update(readFileSync(file.abs));
}
const version = hash.digest('hex').slice(0, 12);

const precache = precacheFiles.map((f) => `./${f.rel}`);
const totalKb = precacheFiles.reduce((sum, f) => sum + statSync(f.abs).size, 0) / 1024;

const sw = `/* GROOVE SYNTH GS-1 service worker — generated, do not edit. */
const CACHE = 'gs1-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
`;

writeFileSync(join(dist, 'sw.js'), sw);
console.log(`[sw] dist/sw.js — cache gs1-${version}, ${precache.length} files, ${totalKb.toFixed(1)} KB`);
