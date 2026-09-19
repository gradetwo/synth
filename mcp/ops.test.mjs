// @vitest-environment node
/**
 * P13.3 tests: the operation tools (`patch.set`, `patch.random`,
 * `sample.import`, `wavetable.import`, `songs.list`, `preset.apply`,
 * `preset.save`), the session state rules, and the refusal paths the batch is
 * graded on.
 *
 * The five claims with a test each:
 *
 *   * **clamping is reported** — a cutoff of 99999 comes back in `clamped` with
 *     the number the caller asked for and the one that was applied;
 *   * **`noRoom` is structured** — the suite's one injectable seam is the core
 *     call that decides the P9.8 code, because the shipped 12 MiB arena cannot
 *     reach code 4 (see `runSampleImport`'s docstring); the injection is proven
 *     to be the only difference by running the real call beside it;
 *   * **a patch round-trips byte for byte** — `patch.get` → `patch.set` →
 *     `patch.get` produces the same share code and the same 224 parameters;
 *   * **the mutating tools drive the reads** — a `render` with no patch plays
 *     the session's patch, and an imported sample is replayed into its fresh
 *     engine (the two are what the golden session then pins twice);
 *   * **randomness eats a seed** — the same seed twice is byte-identical, a
 *     missing seed is refused, and the recipe still covers exactly the ids
 *     `src/state/store.ts`'s RANDOM button writes.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTools, loadContext } from './registry.mjs';
import { dispatch } from './protocol.mjs';
import { resetSession } from './lib/session.mjs';
import { canonicalJson } from './lib/calls.mjs';
import { TMP_DIR, ROOT } from './lib/data.mjs';
import { encodeWavPair } from './lib/wav.mjs';
import { runSampleImport, importRefusal } from './lib/import.mjs';
import { errorPayload } from './lib/errors.mjs';
import { runGoldenSession } from './selftest.mjs';
import { importImpulseResponse, WAVE, SR } from '../scripts/lib/render-core.mjs';

let tools;
let ctx;

beforeAll(async () => {
  tools = await loadTools();
  ctx = await loadContext({ log: false });
});

// Every test starts from a fresh session and a fresh engine, so one test's
// mutation cannot leak into the next (and the arena cost is reproducible).
beforeEach(() => {
  resetSession(ctx);
});

const call = (name, args) =>
  dispatch(
    tools,
    ctx,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    { log: false },
  );

async function ok(name, args) {
  const response = await call(name, args);
  expect(response.error).toBeUndefined();
  expect(response.result.isError, JSON.stringify(response.result.structuredContent)).toBe(false);
  return response.result.structuredContent;
}

async function rejected(name, args) {
  const response = await call(name, args);
  expect(response.error, 'a rejection is a tool result, not a JSON-RPC error frame').toBeUndefined();
  expect(response.result.isError).toBe(true);
  return response.result.structuredContent;
}

/** A deterministic tone, as the WAV bytes the app's own encoder produces. */
function wavBytes(samples, hz = 220, sampleRate = 48000) {
  const channel = new Float32Array(samples);
  for (let i = 0; i < samples; i++) channel[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return encodeWavPair(ctx.data, channel, channel.slice(), sampleRate);
}

const wavBase64 = (samples, hz) => wavBytes(samples, hz).toString('base64');

/** Write bytes under `.tmp/mcp/` and return the repository-relative path. */
function writeTemp(name, bytes) {
  const target = resolve(TMP_DIR, name);
  writeFileSync(target, bytes);
  return `.tmp/mcp/${name}`;
}

// ---------------------------------------------------------------------------
// A. `gs1.patch.set`
// ---------------------------------------------------------------------------
describe('gs1.patch.set', () => {
  it('applies a factory preset and reports the effective patch', async () => {
    const result = await ok('gs1.patch.set', { presetId: 'pluck' });
    expect(result.ok).toBe(true);
    expect(result.applied).toBe('presetId');
    expect(result.source).toBe('session');
    expect(result.presetId).toBe('pluck');
    expect(result.shareCode.startsWith('gs1.')).toBe(true);
    expect(result.patch.params).toHaveProperty('14');
    expect(result.summary.paramCount).toBe(224);
    expect(result.clamped).toEqual([]);
  });

  it('reports a clamped parameter instead of applying it silently', async () => {
    const result = await ok('gs1.patch.set', { params: { filterCutoff: 99999, osc1Level: 0.5 } });
    expect(result.clamped).toContainEqual({ key: 'filterCutoff', asked: 99999, got: 20000, reason: 'max' });
    expect(result.clampedCount).toBe(1);
    // The applied patch really holds the clamped value.
    expect(result.patch.params['14']).toBe(20000);
    expect(result.patch.params['5']).toBe(0.5);
  });

  it('clamps a below-minimum value and rounds a stepped one, reporting both', async () => {
    const low = await ok('gs1.patch.set', { params: { filterCutoff: 1 } });
    expect(low.clamped).toContainEqual({ key: 'filterCutoff', asked: 1, got: 20, reason: 'min' });
    const stepped = await ok('gs1.patch.set', { params: { osc1Wave: 1.4 } });
    expect(stepped.clamped).toContainEqual({ key: 'osc1Wave', asked: 1.4, got: 1, reason: 'discrete' });
    expect(Number.isInteger(stepped.patch.params['2'])).toBe(true);
  });

  it('treats `partial: true` as an edit of the session patch', async () => {
    await ok('gs1.patch.set', { params: { filterCutoff: 5000, filterRes: 0.7 } });
    const partial = await ok('gs1.patch.set', { params: { filterRes: 0.2 }, partial: true });
    expect(partial.partial).toBe(true);
    expect(partial.patch.params['15']).toBe(0.2);
    // The earlier edit survives; the omitted value is not reset to the default.
    expect(partial.patch.params['14']).toBe(5000);
    const fresh = await ok('gs1.patch.set', { params: { filterRes: 0.2 } });
    expect(fresh.patch.params['14']).not.toBe(5000);
  });

  it('answers every malformed call with a structured rejection', async () => {
    const cases = [
      { args: {}, code: 'E_SCHEMA', why: 'no source' },
      { args: { presetId: 'pluck', params: { filterCutoff: 100 } }, code: 'E_SCHEMA', why: 'two sources' },
      { args: { presetId: 'no-such-preset' }, code: 'E_PATCH', why: 'unknown preset' },
      { args: { patch: 42 }, code: 'E_SCHEMA', why: 'patch is a number' },
      { args: { patch: { nope: 1 } }, code: 'E_PATCH', why: 'patch has no params' },
      { args: { patch: 'gs1.1.not-base64-json' }, code: 'E_PATCH', why: 'bad share code' },
      { args: { params: ['filterCutoff'] }, code: 'E_SCHEMA', why: 'params is an array' },
      { args: { params: { nonsenseKey: 1 } }, code: 'E_PARAM', why: 'unknown key' },
      { args: { params: { filterCutoff: 'loud' } }, code: 'E_PARAM', why: 'value is not a number' },
      { args: { params: { filterCutoff: Number.NaN } }, code: 'E_PARAM', why: 'value is NaN' },
    ];
    for (const entry of cases) {
      const payload = await rejected('gs1.patch.set', entry.args);
      expect(payload.error.code, entry.why).toBe(entry.code);
      expect(payload.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// B. `gs1.patch.random`
// ---------------------------------------------------------------------------
describe('gs1.patch.random', () => {
  it('is byte-identical for the same seed', async () => {
    const first = await ok('gs1.patch.random', { seed: 5 });
    const second = await ok('gs1.patch.random', { seed: 5 });
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(second.shareCode).toBe(first.shareCode);
  });

  it('produces a different patch for a different seed, and accepts 0', async () => {
    const zero = await ok('gs1.patch.random', { seed: 0 });
    const one = await ok('gs1.patch.random', { seed: 1 });
    expect(one.shareCode).not.toBe(zero.shareCode);
    expect(zero.ok).toBe(true);
  });

  it('refuses a missing seed rather than drawing one', async () => {
    const missing = await rejected('gs1.patch.random', {});
    expect(missing.error.code).toBe('E_SCHEMA');
    expect(missing.error.message).toContain('seed');
    expect((await rejected('gs1.patch.random', { seed: 1.5 })).error.code).toBe('E_SCHEMA');
    expect((await rejected('gs1.patch.random', { seed: -1 })).error.code).toBe('E_RANGE');
  });

  it('writes exactly the parameter ids the store\'s RANDOM button writes', async () => {
    const before = await ok('gs1.patch.get', {});
    const result = await ok('gs1.patch.random', { seed: 7 });
    // Read the recipe out of the app's own source rather than trusting a copy:
    // the ids on the left of `id: value` inside `randomize()`.
    const store = readFileSync(resolve(ROOT, 'src/state/store.ts'), 'utf8');
    const start = store.indexOf('randomize() {');
    const body = store.slice(start, store.indexOf('const preset: Preset = {', start));
    // `id:` keys, wherever they sit on the line (the recipe puts several on one).
    const ids = [...body.matchAll(/(\d+):\s/g)].map((match) => Number(match[1]));
    expect(ids.length).toBeGreaterThan(20);
    expect([...result.randomised].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
    // And the recipe really moved off the default patch.
    expect(result.shareCode).not.toBe(before.shareCode);
  });
});

// ---------------------------------------------------------------------------
// C. `gs1.sample.import`
// ---------------------------------------------------------------------------
describe('gs1.sample.import', () => {
  it('imports a WAV from base64 and makes it the session instrument', async () => {
    const result = await ok('gs1.sample.import', { wavBase64: wavBase64(480), name: 'tone.wav' });
    expect(result).toMatchObject({ ok: true, code: 0, note: 'ok', samples: 480, sampleRate: 48000, capacity: 192000 });
    expect(result.poolBytes).toBeGreaterThan(0);
    expect(ctx.session.sample.name).toBe('tone.wav');
    expect(ctx.session.sample.samples).toHaveLength(480);
  });

  it('imports a WAV from a repository path', async () => {
    const path = writeTemp('p133-tone.wav', wavBytes(480));
    const result = await ok('gs1.sample.import', { path });
    expect(result.source).toBe('path');
    expect(result.name).toBe('p133-tone.wav');
  });

  it('reports no arena cost for a second import that reuses the pool', async () => {
    const first = await ok('gs1.sample.import', { wavBase64: wavBase64(480) });
    const second = await ok('gs1.sample.import', { wavBase64: wavBase64(480) });
    expect(first.poolBytes).toBeGreaterThan(0);
    // Documented semantics: the pool is reused, so this import added no bytes.
    expect(second.poolBytes).toBe(0);
  });

  it('refuses rather than truncating a file over MAX_BASE_SAMPLES', async () => {
    const path = writeTemp('p133-too-long.wav', wavBytes(200000));
    const payload = await rejected('gs1.sample.import', { path });
    expect(payload.error.code).toBe('E_RANGE');
    expect(payload.error).toMatchObject({ field: 'samples', value: 200000, max: 192000 });
    // The session still holds no sample: nothing was half-loaded.
    expect(ctx.session.sample).toBeNull();
  });

  it('passes the core content verdicts through (silent, short)', async () => {
    const silent = await rejected('gs1.sample.import', {
      wavBase64: encodeWavPair(ctx.data, new Float32Array(480), new Float32Array(480), 48000).toString('base64'),
    });
    expect(silent.error).toMatchObject({ code: 'E_IMPORT', note: 'silent', importCode: 2, source: 'core' });
    const short = await rejected('gs1.sample.import', { wavBase64: wavBase64(20) });
    expect(short.error).toMatchObject({ code: 'E_IMPORT', note: 'short', importCode: 1, source: 'core' });
  });

  it('refuses a bad WAV header, a bad path and a bad argument shape', async () => {
    const junk = await rejected('gs1.sample.import', { wavBase64: Buffer.from('definitely not RIFF').toString('base64') });
    expect(junk.error.code).toBe('E_WAV');
    expect(junk.error.note).toBe('decode');

    const missing = await rejected('gs1.sample.import', { path: '.tmp/mcp/does-not-exist.wav' });
    expect(missing.error.code).toBe('E_WAV');

    const escape = await rejected('gs1.sample.import', { path: '../../etc/passwd' });
    expect(escape.error.code).toBe('E_PATH');

    expect((await rejected('gs1.sample.import', {})).error.code).toBe('E_SCHEMA');
    expect((await rejected('gs1.sample.import', { path: 'a.wav', wavBase64: 'AA==' })).error.code).toBe('E_SCHEMA');
  });

  it('maps the P9.8 noRoom verdict (code 4) to a structured rejection', () => {
    // The one seam: the shipped arena cannot reach code 4 (see below), so the
    // call that decides the verdict is replaced. Everything else is real.
    const injected = runSampleImport(new Float32Array(480).fill(0.5), SR, () => 4);
    expect(injected.code).toBe(4);
    const payload = errorPayload(importRefusal('sample', injected, { samples: 480 }));
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatchObject({ code: 'E_IMPORT', note: 'noRoom', importCode: 4, source: 'core' });
    expect(payload.error.message).toContain('noRoom');
  });

  it('shows why that seam is needed: the real arena cannot refuse a 4 s sample', () => {
    // The repository's own `the_longest_mipmap_fits_the_arena` test asserts the
    // longest import needs less than half the arena; this is the end-to-end
    // version: even with a maximum-length IR already loaded, code is 0.
    const ir = new Float32Array(98304);
    for (let i = 0; i < ir.length; i++) ir[i] = Math.sin((2 * Math.PI * 200 * i) / SR) * (1 - i / ir.length);
    const irCode = importImpulseResponse(ir);
    expect(irCode).toBe(0);
    const longest = new Float32Array(192000);
    for (let i = 0; i < longest.length; i++) longest[i] = Math.sin((2 * Math.PI * 220 * i) / SR);
    const real = runSampleImport(longest, SR);
    expect(real.code).toBe(0);
    expect(real.poolBytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D. `gs1.wavetable.import`
// ---------------------------------------------------------------------------
describe('gs1.wavetable.import', () => {
  it('imports one cycle (resampled by the app to CYCLE_LENGTH)', async () => {
    const result = await ok('gs1.wavetable.import', { cycleBase64: wavBase64(480), name: 'cycle-a' });
    expect(result).toMatchObject({ ok: true, code: 0, note: 'ok', samples: 2048, capacity: 2048 });
    expect(ctx.session.wavetable.name).toBe('cycle-a');
    expect(ctx.session.wavetable.cycle).toHaveLength(2048);
  });

  it('refuses a silent file at the decoder and junk at the header', async () => {
    const silent = await rejected('gs1.wavetable.import', {
      cycleBase64: encodeWavPair(ctx.data, new Float32Array(480), new Float32Array(480), 48000).toString('base64'),
    });
    expect(silent.error).toMatchObject({ code: 'E_IMPORT', note: 'silent', source: 'decoder' });

    const junk = await rejected('gs1.wavetable.import', { cycleBase64: Buffer.from('nope').toString('base64') });
    expect(junk.error.code).toBe('E_WAV');

    expect((await rejected('gs1.wavetable.import', {})).error.code).toBe('E_SCHEMA');
    expect((await rejected('gs1.wavetable.import', { path: 'a.wav', cycleBase64: 'AA==' })).error.code).toBe('E_SCHEMA');
  });
});

// ---------------------------------------------------------------------------
// E. `gs1.songs.list`
// ---------------------------------------------------------------------------
describe('gs1.songs.list', () => {
  it('derives the built-in playlist from src/midi/songs.ts', async () => {
    const result = await ok('gs1.songs.list', {});
    expect(result.count).toBe(ctx.data.DEMO_SONGS.length);
    expect(result.count).toBe(25);
    const elise = result.songs.find((song) => song.id === 'elise');
    expect(elise).toMatchObject({
      title: 'Für Elise',
      titleZh: '致爱丽丝',
      composer: 'L. v. Beethoven',
      source: { kind: 'public-domain', credit: 'WoO 59' },
    });
    expect(result.sourceKinds['public-domain']).toBeGreaterThan(0);
    expect(result.sourceKinds.original).toBe(6);
  });

  it('rejects an unknown field', async () => {
    expect((await rejected('gs1.songs.list', { filter: 'x' })).error.code).toBe('E_SCHEMA');
  });
});

// ---------------------------------------------------------------------------
// F. `gs1.preset.apply` / `gs1.preset.save`
// ---------------------------------------------------------------------------
describe('preset apply and save', () => {
  it('applies a factory preset through patch.set\'s own path', async () => {
    const applied = await ok('gs1.preset.apply', { presetId: 'fbsaw' });
    const viaSet = await ok('gs1.patch.set', { presetId: 'fbsaw' });
    expect(applied.shareCode).toBe(viaSet.shareCode);
    expect(applied.patch).toEqual(viaSet.patch);
  });

  it('round-trips the current patch through a saved .gs1.json file', async () => {
    await ok('gs1.patch.set', { presetId: 'pad' });
    const saved = await ok('gs1.preset.save', { name: 'p133 round trip' });
    expect(saved).toMatchObject({ ok: true, format: 'gs1-preset', name: 'p133 round trip' });
    expect(saved.savePath).toBe('.tmp/mcp/p133_round_trip.gs1.json');
    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/);

    // The file is the app's format: its own parser reads it back.
    const parsed = ctx.data.parsePatchFile(readFileSync(resolve(ROOT, saved.savePath), 'utf8'));
    expect(parsed?.kind).toBe('preset');

    await ok('gs1.patch.random', { seed: 3 });
    const restored = await ok('gs1.preset.apply', { file: saved.savePath });
    const current = await ok('gs1.patch.get', {});
    expect(restored.shareCode).toBe(current.shareCode);
    const before = await ok('gs1.patch.set', { presetId: 'pad' });
    expect(current.shareCode).toBe(before.shareCode);
  });

  it('saves the default patch when the session holds none, and honours outPath', async () => {
    const saved = await ok('gs1.preset.save', { outPath: '.tmp/mcp/p133-explicit.gs1.json' });
    expect(saved.savePath).toBe('.tmp/mcp/p133-explicit.gs1.json');
    expect(saved.source).toBe('default');
    expect(existsSync(resolve(ROOT, saved.savePath))).toBe(true);
  });

  it('refuses a save outside .tmp/mcp/ and a bad apply source', async () => {
    expect((await rejected('gs1.preset.save', { outPath: '../escaped.gs1.json' })).error.code).toBe('E_PATH');
    expect((await rejected('gs1.preset.save', { outPath: 'src/patch.gs1.json' })).error.code).toBe('E_PATH');

    expect((await rejected('gs1.preset.apply', {})).error.code).toBe('E_SCHEMA');
    expect((await rejected('gs1.preset.apply', { presetId: 'pluck', file: 'x.gs1.json' })).error.code).toBe('E_SCHEMA');
    expect((await rejected('gs1.preset.apply', { presetId: 'nope' })).error.code).toBe('E_PATCH');
    expect((await rejected('gs1.preset.apply', { file: '../../etc/passwd' })).error.code).toBe('E_PATH');
    expect((await rejected('gs1.preset.apply', { file: '.tmp/mcp/does-not-exist.gs1.json' })).error.code).toBe('E_PATCH');
  });

  it('refuses a song file and junk, naming the file', async () => {
    const songPath = writeTemp('p133-song.gs1.json', JSON.stringify({ format: 'gs1-song', code: 'gs1.1.abc' }));
    const song = await rejected('gs1.preset.apply', { file: songPath });
    expect(song.error.code).toBe('E_PATCH');
    expect(song.error.message).toContain('gs1song');

    const junkPath = writeTemp('p133-junk.gs1.json', '{ not json');
    expect((await rejected('gs1.preset.apply', { file: junkPath })).error.code).toBe('E_PATCH');
  });
});

// ---------------------------------------------------------------------------
// G. The state rules the golden session then pins
// ---------------------------------------------------------------------------
describe('session state', () => {
  it('makes a render with no patch play the session patch', async () => {
    await ok('gs1.patch.set', { presetId: 'bell' });
    const fromSession = await ok('gs1.render', { notes: [{ note: 60 }], seconds: 1, seed: 2 });
    const explicit = await ok('gs1.render', { presetId: 'bell', notes: [{ note: 60 }], seconds: 1, seed: 2 });
    expect(fromSession.sha256).toBe(explicit.sha256);
    expect(fromSession.patch.source).toBe('session');
  });

  it('replays an imported sample into the next render\'s fresh engine', async () => {
    await ok('gs1.patch.set', { params: { osc1Wave: WAVE.sample, osc1Level: 0.9, filterCutoff: 20000 } });
    const dry = await ok('gs1.render', { notes: [{ note: 60 }], seconds: 0.5, seed: 1 });
    await ok('gs1.sample.import', { wavBase64: wavBase64(4800) });
    const wet = await ok('gs1.render', { notes: [{ note: 60 }], seconds: 0.5, seed: 1 });
    expect(wet.sha256).not.toBe(dry.sha256);
  });

  it('replays an imported cycle into the next render\'s fresh engine', async () => {
    // `wtUser` (id 79) is the switch that makes the oscillator read the imported
    // cycle instead of the factory bank, exactly as the panel's import does.
    await ok('gs1.patch.set', { params: { osc1Wave: WAVE.wavetable, wtUser: 1, osc1Level: 0.9, filterCutoff: 20000 } });
    const dry = await ok('gs1.render', { notes: [{ note: 60 }], seconds: 0.5, seed: 1 });
    await ok('gs1.wavetable.import', { cycleBase64: wavBase64(480, 110) });
    const wet = await ok('gs1.render', { notes: [{ note: 60 }], seconds: 0.5, seed: 1 });
    expect(wet.sha256).not.toBe(dry.sha256);
  });

  it('clears the patch and the instrument on resetSession', async () => {
    await ok('gs1.patch.set', { presetId: 'pluck' });
    await ok('gs1.sample.import', { wavBase64: wavBase64(480) });
    resetSession(ctx);
    expect(ctx.session.patch).toBeNull();
    expect(ctx.session.sample).toBeNull();
    const got = await ok('gs1.patch.get', {});
    expect(got.source).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// H. The patch round trip, byte for byte
// ---------------------------------------------------------------------------
describe('patch round trip', () => {
  it('returns the same share code and the same parameters after patch.set', async () => {
    for (const presetId of ['pluck', 'pad', 'acid']) {
      resetSession(ctx);
      const first = await ok('gs1.patch.get', { presetId });
      const set = await ok('gs1.patch.set', { patch: first.shareCode });
      expect(set.shareCode, presetId).toBe(first.shareCode);
      const second = await ok('gs1.patch.get', {});
      expect(second.shareCode, presetId).toBe(first.shareCode);
      expect(canonicalJson(second.patch), presetId).toBe(canonicalJson(first.patch));
    }
  });

  it('round-trips the decoded payload object as well as the code', async () => {
    const first = await ok('gs1.patch.get', { presetId: 'pad' });
    await ok('gs1.patch.set', { patch: first.patch });
    const second = await ok('gs1.patch.get', {});
    expect(second.shareCode).toBe(first.shareCode);
    expect(canonicalJson(second.patch)).toBe(canonicalJson(first.patch));
  });

  it('round-trips a layered patch (params2 + routing)', async () => {
    // No factory preset ships a second layer, so the layer is built by hand. The
    // layer has to differ from instance A or `buildPayload` would not carry it.
    const base = await ok('gs1.patch.get', { presetId: 'pad' });
    const params2 = { ...base.patch.params, '14': 5000, '15': 0.9 };
    const layered = { ...base.patch, params2, instanceMode: 'layer', splitNote: 60 };
    const set = await ok('gs1.patch.set', { patch: layered });
    expect(set.patch.params2['14']).toBe(5000);
    expect(set.patch.instanceMode).toBe('layer');
    const first = await ok('gs1.patch.get', {});
    await ok('gs1.patch.set', { patch: first.shareCode });
    const second = await ok('gs1.patch.get', {});
    expect(second.shareCode).toBe(first.shareCode);
    expect(second.patch.instanceMode).toBe('layer');
    expect(canonicalJson(second.patch)).toBe(canonicalJson(first.patch));
  });
});

// ---------------------------------------------------------------------------
// I. The golden session, twice (the P13.2 test's twin, with mutations)
// ---------------------------------------------------------------------------
describe('golden session with the mutating tools', () => {
  it(
    'runs the whole surface twice, mutations included, byte for byte',
    async () => {
      const result = await runGoldenSession();
      expect(result.failures).toEqual([]);
      expect(result.identical).toBe(true);
      expect(result.hashA).toBe(result.hashB);
      expect(result.calls).toBe(21);
      expect(result.wavSha256.length).toBeGreaterThanOrEqual(3);
    },
    180_000,
  );
});
