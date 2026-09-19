import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { workletMinPlugin } from './scripts/worklet-min';

/**
 * Serve `/index.html` the way the production host does.
 *
 * Cloudflare's asset server redirects `/index.html` (and `/index.html?x=y`) to
 * `/` with a 307. That is invisible until a *service worker* fetches the shell
 * for a navigation: a navigation request has `redirect: 'manual'`, so returning
 * the followed response is refused by the browser and the site shows its own
 * "this page might be down" error. Reproducing the redirect here means the
 * end-to-end suite fails on that bug instead of production finding it.
 */
function prettyUrlPlugin(): Plugin {
  return {
    name: 'gs1-pretty-urls',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? '';
        if (/^\/index\.html(\?|$)/.test(url)) {
          const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
          response.writeHead(307, { Location: `/${query}` });
          response.end();
          return;
        }
        next();
      });
    },
  };
}

/**
 * Ship one font format, not two.
 *
 * `@fontsource/*` declares every face as woff2 *plus* a woff fallback for
 * browsers older than anything this synth can run in — it needs WebAssembly, an
 * AudioWorklet and ES2022. Those woff files are 108 KB of the payload and the
 * same again in the offline cache, so the fallback is dropped here, before Vite
 * emits anything: the file never reaches `dist/` and the service worker never
 * precaches it.
 */
function woff2Only(): Plugin {
  return {
    name: 'gs1-fonts-woff2',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      const stripped = code.replace(/,\s*url\([^)]+\.woff\)\s*format\('woff'\)/g, '');
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

// The synthesizer is a fully static, offline-first PWA. Everything it needs at
// runtime (JS/CSS, the Rust WASM core, the AudioWorklet processor, self-hosted
// fonts and icons) is emitted into `dist/` and precached by the service worker.
export default defineConfig({
  plugins: [workletMinPlugin(__dirname), woff2Only(), react(), prettyUrlPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  // The deploy package is served from a web root. Relative asset URLs keep the
  // build usable from a sub-directory as well.
  base: './',
  server: {
    port: 3000,
    host: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@fontsource')) {
            return 'vendor-fonts';
          }
          return undefined;
        },
      },
    },
  },
});
