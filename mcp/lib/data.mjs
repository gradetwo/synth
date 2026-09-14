/**
 * The authoritative data, read from the app's own modules.
 *
 * The tools must not carry a second copy of the parameter table, the preset
 * library or the share-code format — `docs/LLM-INTERFACE.md` §3 makes "one
 * implementation" the whole point of P13. So this module bundles the real
 * TypeScript with esbuild (the same trick `scripts/verify-presets.mjs` already
 * uses, and the same dependency: esbuild ships with vite and is a
 * **devDependency**, so the runtime `dependencies` set does not change) and
 * imports the result from `.tmp/mcp/`.
 *
 * Two files cannot be imported in Node at all and are read as text instead:
 *
 *   * `src/audio/worklet-processor.js` is an AudioWorklet: it calls
 *     `registerProcessor` and extends `AudioWorkletProcessor`, neither of which
 *     exists in Node. Its `PARAMS` literals are the ranges the **browser
 *     actually serves**, so they are parsed out of the source. The parser is
 *     strict — it counts entries and refuses to guess — so a table that changes
 *     shape fails loudly here rather than quietly returning half a range.
 *   * (nothing else; everything else bundles.)
 *
 * The bundle's browser-only top-level imports (the wasm `?url` assets, the
 * worklet URL, `@/audio/engine`, the user-content singletons and `@/i18n`) are
 * replaced by empty stubs: the tools only use `encodeWavBuffer`/`parseWav`,
 * `params.ts`, `presets.ts` and `share.ts`, none of which touch them.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TMP_DIR = resolve(ROOT, '.tmp/mcp');

/** Replace a browser-only import with an inert module. */
const stub = (specifier) => ({
  name: `stub:${specifier}`,
  setup(build) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
      path: `stub:${specifier}`,
      namespace: 'mcp-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'mcp-stub' }, () => ({
      loader: 'js',
      contents:
        'export default "";\n' +
        'export const detectSimd = () => true;\n' +
        'export const getUserWave = () => null;\n' +
        'export const getUserIr = () => null;\n' +
        'export const getUserSample = () => null;\n' +
        'export const t = (key) => key;\n',
    }));
  },
});

const STUBS = [
  '@/generated/synth_core.wasm?url',
  '@/generated/synth_core_scalar.wasm?url',
  './worklet-processor.js?url',
  '@/audio/engine',
  '@/audio/userWave',
  '@/audio/ir',
  '@/audio/userSample',
  '@/i18n',
];

let cached = null;

/** Bundle the app modules the tools need and import them. Memoized per process. */
export async function loadData() {
  if (cached) return cached;
  cached = (async () => {
    let build;
    try {
      ({ build } = await import('esbuild'));
    } catch (error) {
      throw new Error(
        `mcp: esbuild is required to read the app's TypeScript (vite ships it) — run "npm install": ${error?.message ?? error}`,
      );
    }
    // One bundle per process: vitest runs test files in parallel workers, and
    // two `loadData()` calls writing the same `.tmp/mcp/app-data.mjs` would race
    // on the one file. The name stays inside `.tmp/mcp/` and is content-stable.
    const outfile = resolve(TMP_DIR, `app-data.${process.pid}.mjs`);
    mkdirSync(TMP_DIR, { recursive: true });
    await build({
      stdin: {
        contents: `
          export { FACTORY_PRESETS, presetParams, presetRoutes, PRESET_CATEGORIES } from '@/state/presets';
          export {
            DEFAULT_PARAMS, DEFAULT_ROUTES, PARAM_SPECS, PARAM_NAMES, DISCRETE_PARAMS,
            WAVES, WAVE_CN, FILTER_TYPES, LFO_WAVES, LFO_TARGETS, DELAY_SYNCS,
            FX_KINDS, FX_KIND_LABELS, MOD_SOURCES, MOD_DESTS, Param, GRAPH_DRY,
            FX_SLOTS, FX_OVR_SLOTS, FX_MOD_SLOTS, FX_MOD_SOURCES, fxKindToInt,
            modSrcToInt, modDstToInt, intToModSrc, intToModDst,
          } from '@/audio/params';
          export { encodePatch, decodePatch, decodePatchAsync, PREFIX_FOR_TEST } from '@/state/share';
          export { encodeWavBuffer } from '@/audio/render';
          export { parseWav, WaveImportError } from '@/audio/wavefile';
          // P13.3: the file-backed importers and the preset-file reader — the
          // same functions the pickers and the store call, not a second parser.
          export { decodeSampleFile, decodeCycle, extractCycle, CYCLE_LENGTH } from '@/audio/wavefile';
          export { parsePatchFile } from '@/state/patchfile';
          export { DEMO_SONGS } from '@/midi/songs';
        `,
        resolveDir: ROOT,
        sourcefile: 'mcp-app-data-entry.ts',
        loader: 'ts',
      },
      alias: { '@': resolve(ROOT, 'src') },
      plugins: STUBS.map(stub),
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'error',
      outfile,
    });
    return import(pathToFileURL(outfile).href);
  })();
  return cached;
}

/**
 * Parse `PARAMS` out of the AudioWorklet. Returns `[{ id, key, min, max, def }]`
 * in table order, or throws if the table is not the shape this parser knows.
 */
export function workletParams() {
  const source = readFileSync(resolve(ROOT, 'src/audio/worklet-processor.js'), 'utf8');
  const table = source.slice(source.indexOf('const PARAMS = ['));
  const end = table.indexOf('\n];');
  if (end < 0) throw new Error('worklet-processor.js: could not find the end of PARAMS');
  const body = table.slice(0, end);
  const rows = [];
  const line = /^\s*\['([^']+)',\s*(\d+),\s*(-?[\d.eE+-]+),\s*(-?[\d.eE+-]+),\s*(-?[\d.eE+-]+)\],?\s*$/;
  for (const raw of body.split('\n')) {
    const match = line.exec(raw);
    if (!match) continue;
    rows.push({
      key: match[1],
      id: Number(match[2]),
      def: Number(match[3]),
      min: Number(match[4]),
      max: Number(match[5]),
    });
  }
  if (rows.length !== 224) {
    throw new Error(`worklet-processor.js: parsed ${rows.length} PARAMS rows, expected 224`);
  }
  return rows;
}

/**
 * The parameter table the tools publish: the worklet's served range merged with
 * the identity (`PARAM_NAMES`), the UI label (`PARAM_SPECS`) and the stepped
 * flag (`DISCRETE_PARAMS`). Sorted by id.
 */
export function parameterTable(data = null) {
  const rows = workletParams();
  const specs = new Map();
  if (data) for (const spec of data.PARAM_SPECS) specs.set(spec.id, spec);
  return rows
    .map((row) => {
      const spec = specs.get(row.id);
      return {
        id: row.id,
        key: data?.PARAM_NAMES?.[row.id] ?? row.key,
        /** The UI's display label; `null` for parameters with no knob. */
        nameEn: spec?.label ?? null,
        /**
         * This repository does not localise individual parameter labels, so
         * there is no authoritative Chinese name to return. The field exists so
         * a client can render a two-column table without special-casing it.
         */
        nameZh: null,
        min: row.min,
        max: row.max,
        default: row.def,
        unit: spec ? unitOf(spec) : '',
        discrete: data ? data.DISCRETE_PARAMS.has(row.id) : false,
      };
    })
    .sort((a, b) => a.id - b.id);
}

/**
 * The unit a knob's own formatter appends, read off a formatted sample rather
 * than kept as a second table. `fmt.pct(0.5)` is "50 %", so the unit is "%".
 */
function unitOf(spec) {
  let text = '';
  try {
    text = String(spec.format(spec.def));
  } catch {
    return '';
  }
  const match = /(kHz|Hz|ms|s|%|st|ct|dB|BPM)$/.exec(text.trim());
  if (!match) return '';
  return match[1] === 's' ? 's' : match[1];
}

/** The version from `package.json` (same source the app's `__APP_VERSION__` uses). */
export function packageVersion() {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
}

/**
 * A `pub const NAME: usize = <integer expression>;` from a Rust source file,
 * evaluated as a product of integers. The tools report the arena and sampler
 * limits the engine actually compiles with, and the only honest source for
 * those is the Rust that defines them — so it is read, not retyped.
 */
export function rustConst(file, name) {
  const source = readFileSync(resolve(ROOT, file), 'utf8');
  const match = new RegExp(`pub const ${name}: (?:usize|u32|u64) = ([0-9_\\s*]+);`).exec(source);
  if (!match) throw new Error(`${file}: could not find "pub const ${name}"`);
  return match[1]
    .split('*')
    .map((part) => Number(part.replace(/_/g, '').trim()))
    .reduce((product, value) => product * value, 1);
}
