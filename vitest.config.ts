import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    // The MCP server's tests (P13.2) live outside `src/` because the server does:
    // they run the real wasm and speak JSON-RPC over the same modules the
    // `npm run mcp` entry point uses.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'mcp/**/*.test.mjs'],
    globals: false,
    restoreMocks: true,
    // The worklet integration test renders all 67 presets through WASM and is
    // CPU-bound; the default 5 s is too tight when the suite runs in parallel.
    testTimeout: 30_000,
  },
});
