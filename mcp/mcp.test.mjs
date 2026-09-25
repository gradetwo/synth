// @vitest-environment node
/**
 * P13.2 tests: the tool surface, the hand-written JSON-RPC layer, the golden
 * session and the "no second implementation / no new dependency" proofs.
 *
 * These live in `mcp/` (and `vitest.config.ts` now includes the `mcp` test
 * glob) so the server and its tests move together. The three claims the batch
 * is graded on have a test each:
 *
 *   * determinism  — `runGoldenSession()` runs the whole surface twice and
 *     compares byte-for-byte;
 *   * shared implementation — `gs1.gate`'s number is checked bit-for-bit
 *     against `offGridFloor(renderFloor(...))`, the exact call
 *     `scripts/verify-audio.mjs` makes, plus a source scan that no ruler maths
 *     was copied into `mcp/`;
 *   * no new runtime dependency — `dependencies` is compared to the v2.1.0 set
 *     and every `mcp/` import specifier is checked to be a Node builtin, esbuild
 *     (already a devDependency) or a relative path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTools, loadContext, toolFiles, TOOLS_DIR } from './registry.mjs';
import { dispatch, RPC, PROTOCOL_VERSION } from './protocol.mjs';
import { encodeFrame, createLineDecoder } from './framing.mjs';
import { canonicalJson, logCall } from './lib/calls.mjs';
import { runGoldenSession } from './selftest.mjs';
import { TMP_DIR, ROOT, workletParams, parameterTable } from './lib/data.mjs';
import { P, WAVE, QUIET_PATCH, renderFloor, initCore } from '../scripts/lib/render-core.mjs';
import { offGridFloor } from '../scripts/lib/audio-ruler.mjs';
import { noteHz } from './lib/render.mjs';

const MCP_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
let tools;
let ctx;

beforeAll(async () => {
  tools = await loadTools();
  ctx = await loadContext({ log: false });
});

/** One `tools/call`, returned as the raw JSON-RPC response. */
const call = (name, args) =>
  dispatch(
    tools,
    ctx,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    { log: false },
  );

/** One `tools/call` that must succeed, returned as its structured result. */
async function ok(name, args) {
  const response = await call(name, args);
  expect(response.error).toBeUndefined();
  expect(response.result.isError, JSON.stringify(response.result.structuredContent)).toBe(false);
  return response.result.structuredContent;
}

/** One `tools/call` that must be rejected, returned as its error payload. */
async function rejected(name, args) {
  const response = await call(name, args);
  expect(response.error, 'a rejection is a tool result, not a JSON-RPC error frame').toBeUndefined();
  expect(response.result.isError).toBe(true);
  return response.result.structuredContent;
}

// ---------------------------------------------------------------------------
// A. The registry is built by scanning the directory
// ---------------------------------------------------------------------------
describe('tool registry', () => {
  it('is discovered from mcp/tools/*.mjs, sorted by filename, helpers skipped', () => {
    const files = toolFiles();
    expect(files).toContain('render.mjs');
    expect(files).not.toContain('_schemas.mjs');
    expect([...files]).toEqual([...files].sort());
    for (const file of files) expect(file.startsWith('_')).toBe(false);
  });

  it('exposes the P13.2 read/render surface and the P13.3 operations', () => {
    expect([...tools.keys()].sort()).toEqual([
      'gs1.analyze',
      'gs1.describe',
      'gs1.gate',
      'gs1.params.list',
      'gs1.patch.get',
      'gs1.patch.random',
      'gs1.patch.set',
      'gs1.preset.apply',
      'gs1.preset.save',
      'gs1.presets.list',
      'gs1.render',
      'gs1.sample.import',
      'gs1.songs.list',
      'gs1.wavetable.import',
    ]);
  });

  it('every tool file honours the { name, description, inputSchema, handler } contract', async () => {
    for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))) {
      const module = await import(new URL(`./tools/${file}`, import.meta.url).href);
      expect(typeof module.default?.name, file).toBe('string');
      expect(typeof module.default?.description, file).toBe('string');
      expect(module.default?.inputSchema?.type, file).toBe('object');
      expect(typeof module.default?.handler, file).toBe('function');
    }
  });

  it('tools/list follows the file order and carries each schema', async () => {
    const response = await dispatch(tools, ctx, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { log: false });
    const listed = response.result.tools.map((tool) => tool.name);
    expect(listed).toHaveLength(14);
    for (const tool of response.result.tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(10);
      expect(tool.inputSchema.type, tool.name).toBe('object');
    }
  });
});

// ---------------------------------------------------------------------------
// B. Hand-written JSON-RPC frames, over stdio framing and over HTTP bodies
// ---------------------------------------------------------------------------
describe('json-rpc protocol', () => {
  it('answers initialize with a protocol version, capabilities and server info', async () => {
    const response = await dispatch(
      tools,
      ctx,
      { jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { log: false },
    );
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(7);
    expect(response.result.protocolVersion).toBe('2024-11-05');
    expect(response.result.capabilities.tools).toBeDefined();
    expect(response.result.serverInfo.name).toBe('gs1-mcp');
  });

  it('falls back to its own protocol version when the client names none', async () => {
    const response = await dispatch(tools, ctx, { jsonrpc: '2.0', id: 8, method: 'initialize' }, { log: false });
    expect(response.result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('answers tools/call with text content and structuredContent', async () => {
    const response = await call('gs1.presets.list', {});
    expect(response.result.content[0].type).toBe('text');
    expect(JSON.parse(response.result.content[0].text)).toEqual(response.result.structuredContent);
    expect(response.result.structuredContent.count).toBe(91);
  });

  it('does not answer notifications', async () => {
    expect(await dispatch(tools, ctx, { jsonrpc: '2.0', method: 'notifications/initialized' }, { log: false })).toBeNull();
    expect(await dispatch(tools, ctx, { jsonrpc: '2.0', method: 'tools/list' }, { log: false })).toBeNull();
  });

  it('rejects an unknown method with -32601', async () => {
    const response = await dispatch(tools, ctx, { jsonrpc: '2.0', id: 3, method: 'nope/nope' }, { log: false });
    expect(response.error.code).toBe(RPC.METHOD_NOT_FOUND);
  });

  it('rejects an unknown tool with -32602 and lists what exists', async () => {
    const response = await call('gs1.doesNotExist', {});
    expect(response.error.code).toBe(RPC.INVALID_PARAMS);
    expect(response.error.data.code).toBe('E_TOOL');
    expect(response.error.data.available).toContain('gs1.render');
  });

  it('rejects a malformed request object with -32600', async () => {
    const response = await dispatch(tools, ctx, { id: 4, method: 'tools/list' }, { log: false });
    expect(response.error.code).toBe(RPC.INVALID_REQUEST);
  });

  it('frames a message as one line and a parse failure as -32700', async () => {
    const frame = encodeFrame({ jsonrpc: '2.0', id: 1, result: {} });
    expect(frame.endsWith('\n')).toBe(true);
    expect(frame.trimEnd().includes('\n')).toBe(false);

    const seen = [];
    const errors = [];
    const errorsOut = [];
    const decoder = createLineDecoder({
      onMessage: (message) => seen.push(message),
      onParseError: (line) => {
        errors.push(line);
        errorsOut.push({ jsonrpc: '2.0', id: null, error: { code: RPC.PARSE } });
      },
    });
    // A message split across two chunks, a batch, and junk: the three shapes a
    // real stdio client produces.
    decoder.push('{"jsonrpc":"2.0","id":1,"met');
    decoder.push('hod":"ping"}\n[{"jsonrpc":"2.0","id":2,"method":"ping"}]\nnot json\n');
    decoder.flush();
    expect(seen).toHaveLength(2);
    expect(seen[0].method).toBe('ping');
    expect(Array.isArray(seen[1])).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errorsOut[0].error.code).toBe(RPC.PARSE);
  });

  it('flushes a final frame with no trailing newline', () => {
    const seen = [];
    const decoder = createLineDecoder({ onMessage: (message) => seen.push(message) });
    decoder.push('{"jsonrpc":"2.0","id":9,"method":"ping"}');
    expect(seen).toHaveLength(0);
    decoder.flush();
    expect(seen[0].id).toBe(9);
  });

  it('serves the same registry over loopback HTTP', async () => {
    const { serveHttp } = await import('./server.mjs');
    const server = await serveHttp(tools, ctx, 0);
    const port = server.address().port;
    const post = (body) =>
      fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => response.json());
    try {
      const listed = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect(listed.result.tools.map((tool) => tool.name)).toContain('gs1.render');

      const description = await (await fetch(`http://127.0.0.1:${port}/`)).json();
      expect(description.transport).toBe('http');
      expect(description.tools).toContain('gs1.gate');

      // A tool rejection over HTTP is the same structured isError result, not a
      // transport failure — both entries share one registry and one protocol.
      const declined = await post({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'gs1.render', arguments: { notes: [], seconds: 1 } },
      });
      expect(declined.result.isError).toBe(true);
      expect(declined.result.structuredContent.error.code).toBe('E_SCHEMA');

      // Malformed JSON is a parse-error frame, not a crash.
      const raw = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{oops' });
      expect((await raw.json()).error.code).toBe(RPC.PARSE);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// C. Input validation and the structured rejection paths
// ---------------------------------------------------------------------------
describe('validation and rejections', () => {
  const cases = [
    {
      name: 'seconds above the 30 s bound',
      tool: 'gs1.render',
      args: { notes: [{ note: 60 }], seconds: 999 },
      code: 'E_RANGE',
    },
    {
      name: 'seconds below the minimum',
      tool: 'gs1.render',
      args: { notes: [{ note: 60 }], seconds: 0 },
      code: 'E_RANGE',
    },
    {
      name: 'more than 512 notes',
      tool: 'gs1.render',
      args: { notes: Array.from({ length: 513 }, () => ({ note: 60 })), seconds: 1 },
      code: 'E_RANGE',
    },
    {
      name: 'no notes',
      tool: 'gs1.render',
      args: { notes: [], seconds: 1 },
      code: 'E_SCHEMA',
    },
    {
      name: 'a note outside 0..127',
      tool: 'gs1.render',
      args: { notes: [{ note: 300 }], seconds: 1 },
      code: 'E_RANGE',
    },
    {
      name: 'a velocity outside 0..1',
      tool: 'gs1.render',
      args: { notes: [{ note: 60, velocity: 4 }], seconds: 1 },
      code: 'E_RANGE',
    },
    {
      name: 'a note that falls outside the render',
      tool: 'gs1.render',
      args: { notes: [{ note: 60, start: 5, duration: 5 }], seconds: 1 },
      code: 'E_RANGE',
    },
    {
      name: 'a seed outside 0..512',
      tool: 'gs1.render',
      args: { notes: [{ note: 60 }], seconds: 1, seed: 99999 },
      code: 'E_RANGE',
    },
    {
      name: 'a non-48 kHz sample rate',
      tool: 'gs1.render',
      args: { notes: [{ note: 60 }], seconds: 1, sampleRate: 44100 },
      code: 'E_SCHEMA',
    },
    {
      name: 'an unknown preset id',
      tool: 'gs1.render',
      args: { presetId: 'no-such-preset', notes: [{ note: 60 }], seconds: 1 },
      code: 'E_PATCH',
    },
    {
      name: 'a broken share code',
      tool: 'gs1.render',
      args: { patch: 'gs1.1.not-actually-base64-json', notes: [{ note: 60 }], seconds: 1 },
      code: 'E_PATCH',
    },
    {
      name: 'an output path outside .tmp/mcp/',
      tool: 'gs1.render',
      args: { notes: [{ note: 60 }], seconds: 1, outPath: '../escaped.wav' },
      code: 'E_PATH',
    },
    {
      name: 'an unknown field (additionalProperties: false)',
      tool: 'gs1.params.list',
      args: { nonsense: true },
      code: 'E_SCHEMA',
    },
    {
      name: 'a filter of the wrong type',
      tool: 'gs1.params.list',
      args: { filter: 5 },
      code: 'E_SCHEMA',
    },
    {
      name: 'analyze with neither wavPath nor render',
      tool: 'gs1.analyze',
      args: {},
      code: 'E_SCHEMA',
    },
    {
      name: 'analyze with both wavPath and render',
      tool: 'gs1.analyze',
      args: { wavPath: '.tmp/mcp/x.wav', render: { notes: [{ note: 60 }] } },
      code: 'E_SCHEMA',
    },
    {
      name: 'analyze reading outside the repository',
      tool: 'gs1.analyze',
      args: { wavPath: '../../etc/passwd', f0: 440 },
      code: 'E_PATH',
    },
    {
      name: 'analyze of a WAV that does not exist',
      tool: 'gs1.analyze',
      args: { wavPath: '.tmp/mcp/does-not-exist.wav', f0: 440 },
      code: 'E_WAV',
    },
    {
      name: 'gate with no notes',
      tool: 'gs1.gate',
      args: { notes: [] },
      code: 'E_SCHEMA',
    },
    {
      name: 'gate with an unknown ruler',
      tool: 'gs1.gate',
      args: { notes: [{ note: 60 }], ruler: 'vibes' },
      code: 'E_SCHEMA',
    },
  ];

  for (const entry of cases) {
    it(`refuses ${entry.name} with ${entry.code}`, async () => {
      const payload = await rejected(entry.tool, entry.args);
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe(entry.code);
      expect(typeof payload.error.message).toBe('string');
      expect(payload.error.message.length).toBeGreaterThan(3);
    });
  }

  it('answers a rejection with a real, readable summary rather than a stack', async () => {
    const payload = await rejected('gs1.render', { notes: [{ note: 60 }], seconds: 999 });
    expect(payload.error.code).toBe('E_RANGE');
    expect(payload.error.message).toContain('seconds');
    expect(payload.error.message).toContain('30');
  });
});

// ---------------------------------------------------------------------------
// D. Determinism: the golden session, same-seed repeatability, seed effect
// ---------------------------------------------------------------------------
describe('determinism', () => {
  it(
    'runs the whole tool surface twice and compares byte-for-byte',
    async () => {
      const result = await runGoldenSession();
      expect(result.failures).toEqual([]);
      expect(result.identical).toBe(true);
      expect(result.hashA).toBe(result.hashB);
      expect(result.calls).toBe(21);
      expect(result.wavSha256[0]).toMatch(/^[0-9a-f]{64}$/);
    },
    180_000,
  );

  it('renders the same call to the same WAV sha256 twice', async () => {
    const args = { notes: [{ note: 60, velocity: 0.8 }], seconds: 1, seed: 3 };
    const first = await ok('gs1.render', args);
    const second = await ok('gs1.render', args);
    expect(second.sha256).toBe(first.sha256);
    expect(second.time).toEqual(first.time);
    expect(readFileSync(resolve(ROOT, first.wavPath)).length).toBe(first.byteLength);
    expect(readFileSync(resolve(ROOT, second.wavPath)).equals(readFileSync(resolve(ROOT, first.wavPath)))).toBe(true);
  });

  it('changes the bytes when the seed changes, so `seed` is a real input', async () => {
    const base = { notes: [{ note: 60, velocity: 0.8 }], seconds: 1 };
    const zero = await ok('gs1.render', { ...base, seed: 0 });
    const five = await ok('gs1.render', { ...base, seed: 5 });
    expect(five.sha256).not.toBe(zero.sha256);
  });
});

// ---------------------------------------------------------------------------
// E. One implementation: the tools and the gate share scripts/lib/*
// ---------------------------------------------------------------------------
describe('shared implementation with the gate', () => {
  it("gs1.gate's floor is bit-for-bit the gate's own offGridFloor(renderFloor(...))", async () => {
    const params = Object.fromEntries(QUIET_PATCH);
    for (const wave of [WAVE.saw, WAVE.square, WAVE.triangle, WAVE.sine]) {
      params[P.OSC1_WAVE] = wave;
      const result = await ok('gs1.gate', { patch: { params }, notes: [{ note: 81 }], ruler: 'bh7' });
      // The exact call `scripts/verify-audio.mjs`'s P9.1a section makes.
      initCore();
      const gateNumber = offGridFloor(renderFloor([[P.OSC1_WAVE, wave]], 81), noteHz(81));
      expect(result.perNote[0].bh7.floorDb).toBe(gateNumber);
    }
  }, 60_000);

  it('labels every frequency number with the ruler that produced it', async () => {
    const result = await ok('gs1.analyze', {
      render: { notes: [{ note: 60, velocity: 1 }], seconds: 1 },
      f0: noteHz(60),
    });
    expect(result.aliasing.ruler).toBe('bh7');
    expect(result.aliasing.window).toBe('blackman-harris-7');
    expect(result.secondRuler.ruler).toBe('hann-goertzel');
    expect(result.secondRuler.window).toBe('hann');
    expect(result.time.ruler).toBe('time-domain-float');
    expect(result.nonFinite).toBe(0);
    expect(result.allocViolations).toBe(0);
  }, 60_000);

  it('imports the rulers from scripts/lib and defines no FFT/window maths of its own', () => {
    const sources = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) sources.push(full);
      }
    };
    walk(MCP_DIR);
    expect(sources.length).toBeGreaterThan(5);

    const joined = sources.map((file) => readFileSync(file, 'utf8')).join('\n');
    // The ruler constants and the transform itself must exist only in scripts/lib.
    expect(joined).not.toContain('0.27105140069342'); // BH-7 coefficient
    expect(joined).not.toContain('0.35875'); // BH-4 coefficient
    expect(joined).not.toMatch(/function\s+fftInPlace/);
    expect(joined).not.toMatch(/function\s+offGridFloor/);
    expect(joined).not.toMatch(/function\s+binMagHann/);

    // And at least one file really does pull the shared modules in. The regex is
    // anchored to `mcp/tools/` on purpose: P13.4's `mcp/ui/tools/gate.mjs` is a
    // different gate (a Playwright spec runner), not this measurement gate.
    const renderSources = sources.filter((file) => /[/\\]mcp[/\\]tools[/\\](render|analyze|gate)\.mjs$/.test(file));
    expect(renderSources.length).toBe(3);
    const measure = readFileSync(resolve(MCP_DIR, 'lib/measure.mjs'), 'utf8');
    expect(measure).toContain("scripts/lib/audio-ruler.mjs");
    expect(measure).toContain("scripts/lib/render-core.mjs");
  });

  it('derives the parameter table from the app files instead of a second list', () => {
    const rows = workletParams();
    expect(rows).toHaveLength(224);
    const table = parameterTable(ctx.data);
    expect(table).toHaveLength(224);
    // The worklet's table is not id-sorted (PATCH_GAIN is declared early), so
    // compare the sorted id sets rather than the file order.
    expect(table.map((entry) => entry.id)).toEqual(rows.map((row) => row.id).sort((a, b) => a - b));
    // A range change in the worklet must show up in the tool's table.
    const cutoff = table.find((entry) => entry.key === 'filterCutoff');
    expect(cutoff).toMatchObject({ id: 14, min: 20, max: 20000, default: 9000 });
  });
});

// ---------------------------------------------------------------------------
// F. No new runtime dependency
// ---------------------------------------------------------------------------
describe('dependencies', () => {
  /** `dependencies` exactly as v2.1.0 shipped it. */
  const BASELINE = [
    '@breezystack/lamejs',
    '@fontsource/ibm-plex-mono',
    '@fontsource/space-grotesk',
    'playwright',
    'react',
    'react-dom',
  ];

  it('leaves package.json dependencies exactly as the v2.1.0 baseline', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([...BASELINE].sort());
  });

  it('adds no MCP/SDK package anywhere', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(all).filter((name) => /mcp|modelcontextprotocol/i.test(name))).toEqual([]);
  });

  it('has mcp/ import only node builtins, esbuild, playwright and relative paths', () => {
    const sources = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.mjs')) sources.push(full);
      }
    };
    walk(MCP_DIR);
    const specifiers = new Set();
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)|import\s+'([^']+)'/g)) {
        specifiers.add(match[1] ?? match[2] ?? match[3]);
      }
    }
    const allowed = (specifier) =>
      specifier.startsWith('.') ||
      specifier.startsWith('node:') ||
      // The app's own TypeScript, named by esbuild's alias inside the bundle
      // entry string in data.mjs — repository source, not an npm package.
      specifier.startsWith('@/') ||
      specifier === 'esbuild' ||
      specifier === 'vitest' ||
      // P13.4: `mcp/ui/lib/session.mjs` imports the browser driver. This is not
      // a new dependency — `playwright` is in `dependencies` at the v2.1.0
      // baseline and the E2E suite already uses it — and it is imported by the
      // browser layer *only*, dynamically, so the offline entry point never
      // loads it.
      specifier === 'playwright';
    const offenders = [...specifiers].filter((specifier) => !allowed(specifier));
    expect(offenders).toEqual([]);
  });

  it('keeps the browser import out of the offline tools', () => {
    const offline = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.mjs')) offline.push(full);
      }
    };
    walk(resolve(MCP_DIR, 'tools'));
    walk(resolve(MCP_DIR, 'lib'));
    for (const file of [resolve(MCP_DIR, 'registry.mjs'), resolve(MCP_DIR, 'protocol.mjs'), resolve(MCP_DIR, 'server.mjs')]) {
      offline.push(file);
    }
    const importers = offline.filter((file) => /from\s+'playwright'|import\(\s*'playwright'\s*\)/.test(readFileSync(file, 'utf8')));
    expect(importers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G. The audit log
// ---------------------------------------------------------------------------
describe('audit log', () => {
  it('appends one deterministic, clock-free line per call', () => {
    const before = existsSync(resolve(TMP_DIR, 'calls.jsonl'))
      ? readFileSync(resolve(TMP_DIR, 'calls.jsonl'), 'utf8').trim().split('\n').length
      : 0;
    const record = logCall('gs1.self.test', { a: 1, b: [2, 3] }, { ok: true }, true);
    const lines = readFileSync(resolve(TMP_DIR, 'calls.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBe(before + 1);
    const parsed = JSON.parse(lines.at(-1));
    expect(parsed).toEqual(record);
    expect(parsed.tool).toBe('gs1.self.test');
    expect(parsed.argsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed).not.toHaveProperty('time');
    expect(parsed).not.toHaveProperty('timestamp');
    // The digest is stable regardless of key order.
    expect(JSON.parse(lines.at(-1)).argsDigest).toBe(logCall('gs1.self.test', { b: [2, 3], a: 1 }, { ok: true }, false).argsDigest);
  });

  it('writes nothing when logging is disabled', () => {
    const before = existsSync(resolve(TMP_DIR, 'calls.jsonl'))
      ? readFileSync(resolve(TMP_DIR, 'calls.jsonl'), 'utf8')
      : '';
    logCall('gs1.self.test', { x: 1 }, { ok: false, code: 'E_RANGE' }, false);
    const after = readFileSync(resolve(TMP_DIR, 'calls.jsonl'), 'utf8');
    expect(after).toBe(before);
  });

  it('canonicalJson sorts keys so digests do not depend on insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});

// ---------------------------------------------------------------------------
// H. The surfaces a client actually calls
// ---------------------------------------------------------------------------
describe('tool outputs', () => {
  it('describes the engine from the wasm and the Rust constants', async () => {
    const result = await ok('gs1.describe', {});
    expect(result.abi).toBe(9);
    expect(result.paramCount).toBe(224);
    expect(result.sampleRate).toBe(48000);
    expect(result.arena.capacityBytes).toBe(12 * 1024 * 1024);
    expect(result.arena.freeBytes).toBeGreaterThan(0);
    expect(result.sampler.maxBaseSamples).toBe(192000);
    expect(result.enums.waves).toContain('saw');
    expect(result.presets.count).toBe(91);
  });

  it('lists presets with stable tags', async () => {
    const result = await ok('gs1.presets.list', {});
    expect(result.count).toBe(91);
    expect(result.presets[0]).toMatchObject({ id: 'pluck', cat: 'PLUCK' });
    expect(result.presets[0].tags).toContain('FUTURE BASS');
  });

  it('round-trips a preset through the app share-code format', async () => {
    const got = await ok('gs1.patch.get', { presetId: 'pluck' });
    expect(got.shareCode.startsWith('gs1.')).toBe(true);
    const decoded = await ctx.data.decodePatchAsync(got.shareCode);
    expect(decoded.params).toEqual(got.patch.params);
    // And the code is a render input the app's own decoder accepts.
    const viaCode = await ok('gs1.render', { patch: got.shareCode, notes: [{ note: 60 }], seconds: 1, seed: 1 });
    const viaPayload = await ok('gs1.render', {
      patch: { params: got.patch.params, routes: got.patch.routes },
      notes: [{ note: 60 }],
      seconds: 1,
      seed: 1,
    });
    expect(viaCode.sha256).toBe(viaPayload.sha256);
  }, 60_000);

  it('writes the WAV where it says, with the hash it reports', async () => {
    const result = await ok('gs1.render', { notes: [{ note: 64 }], seconds: 0.5, outPath: '.tmp/mcp/test-explicit.wav' });
    expect(result.wavPath).toBe('.tmp/mcp/test-explicit.wav');
    const bytes = readFileSync(resolve(ROOT, result.wavPath));
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.sha256);
  }, 60_000);

  it('analyzes a WAV it just wrote', async () => {
    const rendered = await ok('gs1.render', { notes: [{ note: 60 }], seconds: 1 });
    const analyzed = await ok('gs1.analyze', { wavPath: rendered.wavPath, f0: noteHz(60) });
    expect(analyzed.source).toBe(`wav:${rendered.wavPath}`);
    expect(analyzed.sampleRate).toBe(48000);
    expect(Number.isFinite(analyzed.aliasing.worstDb)).toBe(true);
    expect(analyzed.allocViolations).toBeNull();
  }, 60_000);

  it('reports a passing gate verdict for the gate\'s own quiet fixture', async () => {
    const params = Object.fromEntries(QUIET_PATCH);
    params[P.OSC1_WAVE] = WAVE.square;
    const result = await ok('gs1.gate', { patch: { params }, notes: [{ note: 81 }], ruler: 'both', thresholdDb: -60 });
    expect(result.passed).toBe(true);
    expect(result.perNote[0].bh7.passed).toBe(true);
    expect(result.perNote[0].hann.passed).toBe(true);
  }, 60_000);
});
