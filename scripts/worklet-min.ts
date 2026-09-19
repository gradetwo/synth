/**
 * Generate the minified AudioWorklet asset the bundle actually ships.
 *
 * `src/audio/worklet-processor.js` is the single source of truth and stays
 * readable on purpose: `scripts/verify-worklet-protocol.mjs` parses it, the
 * worklet harness imports it, and a maintainer has to be able to read the
 * message protocol. Shipping it verbatim to visitors sends ~12 KB of comments
 * (35 190 B total) with every first visit, so the build minifies a copy into
 * `src/generated/worklet-processor.min.js` and `engine.ts` / `render.ts` import
 * *that* with `?url`. Vite hashes the bytes it emits, so the asset's content
 * hash always matches its content — the file is never renamed without its
 * bytes moving.
 *
 * The copy is generated, not committed: `src/generated/worklet-processor.min.js`
 * is gitignored, exactly like the wasm cores next to it. A committed copy would
 * need a drift assertion against the source on every build; regenerating a few
 * kilobytes here is cheaper than keeping two copies honest.
 *
 * The same plugin is installed in `vite.config.ts` (so `npm run dev` and
 * `npm run build` both have the file before the module graph is resolved) and
 * in `vitest.config.ts` (so `npx vitest` resolves the same import in the tests
 * that reach `engine.ts` through `store.ts`).
 */
import { transformSync } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** Readable single source of truth. */
export const WORKLET_SOURCE = 'src/audio/worklet-processor.js';
/** Generated, gitignored minified copy that the bundle emits. */
export const WORKLET_MIN = 'src/generated/worklet-processor.min.js';

export interface WorkletMin {
  /** Absolute path of the generated file. */
  path: string;
  /** Size of the bytes written (or already present). */
  bytes: number;
  /** Size of the readable source, for the size-ratio gates. */
  sourceBytes: number;
  /** True when this call rewrote the file. */
  written: boolean;
}

/**
 * Minify `src/audio/worklet-processor.js` into
 * `src/generated/worklet-processor.min.js`.
 *
 * The `transform` API (not `build`) is deliberate: the worklet is a standalone
 * script and must not pull anything in. `format: 'esm'` matches what
 * `audioWorklet.addModule` loads, `target: 'es2020'` matches the class syntax
 * the source already uses, and `legalComments: 'none'` drops the last `/*!`
 * blocks so "the shipped asset carries no comment" stays a usable gate.
 *
 * Writing only on a byte change keeps the file's mtime stable, so the watcher
 * in `vite` dev does not see a spurious edit on every start.
 */
export function buildWorkletMin(root: string): WorkletMin {
  const sourcePath = resolve(root, WORKLET_SOURCE);
  const outPath = resolve(root, WORKLET_MIN);
  const source = readFileSync(sourcePath, 'utf8');
  const { code } = transformSync(source, {
    loader: 'js',
    minify: true,
    format: 'esm',
    target: 'es2020',
    legalComments: 'none',
  });
  const previous = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  const written = previous !== code;
  if (written) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, code);
  }
  return {
    path: outPath,
    bytes: Buffer.byteLength(code),
    sourceBytes: Buffer.byteLength(source),
    written,
  };
}

/**
 * Vite plugin: make sure the minified worklet exists before anything resolves
 * the `?url` import. `buildStart` runs for `vite` (dev), `vite build` and
 * `vitest` — the three entry points that need the file.
 *
 * The return type is left inferred on purpose: `vitest` bundles its own copy of
 * `vite`, so its `Plugin` type is nominally different from the top-level one and
 * a single imported `Plugin` type cannot satisfy both configs. The plain object
 * below is structurally assignable to either. The project root is a parameter
 * (both configs already use `__dirname`) rather than a `configResolved` hook, so
 * the shape stays this small.
 */
export function workletMinPlugin(root: string) {
  return {
    name: 'gs1-worklet-min',
    buildStart() {
      const result = buildWorkletMin(root);
      if (result.written) {
        const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
        console.log(
          `[worklet-min] ${WORKLET_SOURCE} ${kb(result.sourceBytes)} -> ${relative(root, result.path)} ${kb(result.bytes)}`,
        );
      }
    },
  };
}
