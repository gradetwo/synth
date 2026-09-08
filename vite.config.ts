import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The synthesizer is a fully static, offline-first PWA. Everything it needs at
// runtime (JS/CSS, the Rust WASM core, the AudioWorklet processor, self-hosted
// fonts and icons) is emitted into `dist/` and precached by the service worker.
export default defineConfig({
  plugins: [react()],
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
