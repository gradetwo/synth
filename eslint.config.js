import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'crates/**', 'release/**', 'src/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/audio/worklet-processor.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentFrame: 'readonly',
        currentTime: 'readonly',
      },
    },
  },
  {
    // One underscore convention everywhere: a leading `_` marks a binding that
    // is deliberately unused (a callback argument, a loop run for its side
    // effect). Without it, widening `lint` to e2e/scripts/mcp (§一.20⑨) would
    // start with noise like `_family` and the new coverage would be worthless.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The scripts run in Node, not the browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The MCP server and its tooling are Node processes. A few helpers evaluate
    // callbacks in the page (`mcp/ui/lib/session.mjs`), so `mcp/ui/` gets the
    // browser globals too — but only there, so a `document` reference in the
    // server itself still shows up (P13 era: this is the noise §一.20⑨ named).
    files: ['mcp/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['mcp/ui/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Playwright specs and the shared page-side helpers: the spec file runs in
    // Node and its callbacks run in the page, so both sets are in scope. The
    // `no-undef` noise this removes is exactly what §一.20⑨ registered.
    files: ['e2e/**/*.{ts,mts,mjs,js}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
