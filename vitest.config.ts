import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { workletMinPlugin } from './scripts/worklet-min';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  // `engine.ts` imports the minified AudioWorklet asset with `?url`; the tests
  // that reach it through `store.ts` need the file on disk before the module
  // graph is resolved, exactly like a dev server or a build does.
  plugins: [workletMinPlugin(__dirname)],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    // Node 26 shadows jsdom's web storage with an undefined experimental global
    // (see `vitest.setup.ts`); this puts jsdom's back.
    setupFiles: ['./vitest.setup.ts'],
    // The MCP server's tests (P13.2) live outside `src/` because the server does:
    // they run the real wasm and speak JSON-RPC over the same modules the
    // `npm run mcp` entry point uses.
    //
    // `scripts/**` is here for the *pure* readers of the gates' own output
    // (`scripts/lib/fps-windows.mjs`, and the release-sum manifest writer): they
    // are the parsers a release depends on, so a "best high, worst low" fixture
    // has to be able to fail them (§一.20⑥/⑧). Nothing else under `scripts/` is
    // picked up by this pattern — only `*.test.mjs` files.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'mcp/**/*.test.mjs', 'scripts/**/*.test.mjs'],
    globals: false,
    restoreMocks: true,
    // The worklet integration test renders all 67 presets through WASM and is
    // CPU-bound; the default 5 s is too tight when the suite runs in parallel.
    testTimeout: 30_000,
  },
});
