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

// The release version, baked into the worker so the update banner can name the
// build it is about to install. The content hash below says *that* two builds
// differ; it cannot say which release either one is, and the page has no other
// way to ask the waiting worker (`registration.waiting.scriptURL` is always the
// same `sw.js`).
const appVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

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
const VERSION = '${appVersion}';
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
  const data = event.data;
  if (!data) return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  // The update banner asks the *waiting* worker what it carries, over a port
  // the page transfers with the message. The running page cannot answer this
  // itself: after a rollback its own version is the one being replaced, so a
  // banner built from it would name the wrong release. A page that never gets
  // an answer shows no version rather than that one.
  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: 'VERSION', version: VERSION });
  }
});

/**
 * Rebuild a response that came from a redirect.
 *
 * A navigation request has redirect mode "manual", so the browser refuses to
 * consume a response whose redirected flag is set and shows its own error
 * page instead. Both the network shell and the *precached* one can carry that
 * flag on a host that redirects /index.html to / — the second one is what made
 * the app fail to open offline while everything about the cache looked right.
 */
const legal = async (response) => {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: 200, statusText: 'OK', headers: response.headers });
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Fetch the shell from a URL that is unique to this build, and never from a
    // cache. A CDN can hold an old index.html for a while (that is normal), but
    // the old shell points at asset hashes the new deployment no longer serves,
    // which leaves the app booting into 404s — "no sound" with no obvious
    // cause. A versioned, no-store shell cannot be stale, and the cached copy
    // is still there for the offline case.
    //
    // Two details matter and both have bitten us in production:
    //   * Ask for './' rather than './index.html'. Static hosts (Cloudflare's
    //     asset server, GitHub Pages, most "pretty URL" setups) redirect
    //     /index.html to /, and a navigation request has redirect mode
    //     "manual", so handing the browser the *followed* response aborts the
    //     load with "a redirected response was used for a request whose
    //     redirect mode is not follow" — the browser's own error page, with no
    //     way back into the app. The version query still defeats any CDN copy.
    //   * Even so, rebuild the response if it arrives redirected: a host is
    //     free to redirect for its own reasons, and a rebuilt response is
    //     always legal to return.
    //
    // The same rule has to hold for the *cached* shell, and that is a bug this
    // file shipped for a while: cache.addAll follows redirects, so on a host
    // that redirects /index.html to / the precached entry carries
    // redirected: true, and handing that to a navigation aborts the load —
    // "opened online, net::ERR_FAILED offline", with a full cache and a
    // controlling worker. legal() below is applied to every branch, network
    // and cache alike, which is why e2e/pwa.spec.ts now opens the app with
    // the network switched off.
    event.respondWith(
      fetch('./?v=' + CACHE, { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error('shell');
          return legal(response);
        })
        .catch(() =>
          caches
            .match('./index.html')
            .then((cached) => cached || caches.match('./'))
            .then((cached) => cached || fetch(request, { cache: 'no-store' })),
        )
        .then(legal)
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
console.log(`[sw] dist/sw.js — v${appVersion}, cache gs1-${version}, ${precache.length} files, ${totalKb.toFixed(1)} KB`);
