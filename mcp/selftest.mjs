/**
 * The golden session: run the whole tool surface twice and prove the two runs
 * are byte-identical.
 *
 * `docs/LLM-INTERFACE.md` §5 asks for exactly this, and it is the check that
 * catches the failure mode the tools are most prone to: an engine whose
 * `phase_seed` advances between calls, or a result that quietly depends on
 * wall-clock ordering.
 *
 * P13.3 extends the session past the read-only surface: it now includes the
 * **mutating** tools (`patch.set`, `patch.random`, `preset.apply`,
 * `sample.import`, `wavetable.import`, `preset.save`) and, between them, the
 * reads that must observe them (`patch.get` with no arguments, a `render` with
 * no patch). That is what makes the session's state rules a test rather than a
 * comment: the second pass has to reproduce every mutation — including the
 * clamped parameter report and the arena cost of the sample import — byte for
 * byte.
 *
 * **`resetSession()` per pass** is what makes that possible: a pass starts from
 * a fresh engine and an empty session, so the second pass cannot inherit the
 * first pass's sample pool or current patch. `runOnce` below is the only caller.
 *
 * Exported so `npm run mcp -- --self-test`, the vitest suite and CI all run the
 * *same* session rather than three approximations of it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTools, loadContext } from './registry.mjs';
import { dispatch } from './protocol.mjs';
import { resetSession } from './lib/session.mjs';
import { canonicalJson, resetCallSequence } from './lib/calls.mjs';
import { sha256Hex, encodeWavPair } from './lib/wav.mjs';
import { ROOT } from './lib/data.mjs';
import { noteHz } from './lib/render.mjs';
import { P, WAVE, QUIET_PATCH } from '../scripts/lib/render-core.mjs';

const PHRASE = [{ note: 60, velocity: 0.9, start: 0, duration: 1.5 }];

/**
 * The gate's own quiet fixture as a patch object (`QUIET_PATCH` + a saw), so the
 * golden session's `gs1.gate` call exercises the same measurement the gate
 * makes — and clears `-60 dB`, which is the point of the tool.
 */
function quietSawPatch() {
  const params = Object.fromEntries(QUIET_PATCH);
  params[P.OSC1_WAVE] = WAVE.saw;
  return { params };
}

/** A short deterministic WAV, written by the app's own encoder, as base64. */
function toneWavBase64(data) {
  const samples = 480;
  const left = new Float32Array(samples);
  for (let i = 0; i < samples; i++) left[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / 48000);
  return encodeWavPair(data, left, left.slice(), 48000).toString('base64');
}

/** The scripted calls, in order. `f0` is computed so no magic number is baked in. */
export function goldenSession(data) {
  return [
    { tool: 'gs1.describe', args: {} },
    { tool: 'gs1.params.list', args: { filter: 'osc' } },
    { tool: 'gs1.presets.list', args: {} },
    { tool: 'gs1.songs.list', args: {} },
    { tool: 'gs1.patch.get', args: { presetId: 'pluck' } },
    {
      tool: 'gs1.render',
      args: { presetId: 'pluck', notes: PHRASE, seconds: 1.5, seed: 7 },
    },
    {
      tool: 'gs1.analyze',
      args: { render: { presetId: 'pluck', notes: PHRASE, seconds: 1.5, seed: 7 }, f0: noteHz(60) },
    },
    {
      tool: 'gs1.gate',
      args: { patch: quietSawPatch(), notes: [{ note: 57 }, { note: 81 }], ruler: 'both', thresholdDb: -60 },
    },
    // --- P13.3: the mutating tools, and the reads that must observe them ------
    {
      // A parameter edit that has to be clamped (the cutoff's maximum is 20000).
      tool: 'gs1.patch.set',
      args: { params: { filterCutoff: 99999, osc1Level: 0.5 } },
    },
    { tool: 'gs1.patch.get', args: {} },
    { tool: 'gs1.patch.random', args: { seed: 11 } },
    { tool: 'gs1.patch.get', args: {} },
    { tool: 'gs1.patch.set', args: { presetId: 'pluck' } },
    { tool: 'gs1.preset.apply', args: { presetId: 'acid' } },
    { tool: 'gs1.patch.get', args: {} },
    { tool: 'gs1.sample.import', args: { wavBase64: toneWavBase64(data), name: 'golden.wav' } },
    { tool: 'gs1.wavetable.import', args: { cycleBase64: toneWavBase64(data), name: 'golden-cycle' } },
    { tool: 'gs1.render', args: { notes: PHRASE, seconds: 1.5, seed: 7 } },
    { tool: 'gs1.preset.save', args: { name: 'golden' } },
    // A patch round trip inside the session: the patch object `patch.get` hands
    // out is the one `patch.set` takes back, and `patch.get` reports it again.
    { tool: 'gs1.patch.set', args: { patch: { params: quietSawPatch().params } } },
    { tool: 'gs1.patch.get', args: {} },
  ];
}

/** Run the session once, hashing any file it writes. */
async function runOnce(tools, ctx) {
  // A pass is an independent session: fresh engine, empty patch/instrument.
  resetSession(ctx);
  resetCallSequence();
  const records = [];
  for (const [index, call] of goldenSession(ctx.data).entries()) {
    const response = await dispatch(
      tools,
      ctx,
      { jsonrpc: '2.0', id: index, method: 'tools/call', params: { name: call.tool, arguments: call.args } },
      { log: false },
    );
    const result = response?.result;
    const structured = result?.structuredContent ?? null;
    const record = { tool: call.tool, isError: Boolean(result?.isError), structured };
    const written = structured?.wavPath ?? structured?.savePath;
    if (written) record.fileSha256 = sha256Hex(readFileSync(resolve(ROOT, written)));
    records.push(record);
  }
  return records;
}

/**
 * Run the session twice and compare.
 *
 * @returns {{identical: boolean, hashA: string, hashB: string, calls: number,
 *            wavSha256: string[], failures: string[]}}
 */
export async function runGoldenSession() {
  const tools = await loadTools();
  const ctx = await loadContext({ log: false });
  const first = await runOnce(tools, ctx);
  const second = await runOnce(tools, ctx);

  const canonicalA = canonicalJson(first);
  const canonicalB = canonicalJson(second);
  const failures = [];
  for (const pass of [first, second]) {
    for (const record of pass) {
      if (record.isError) {
        failures.push(`${record.tool}: ${JSON.stringify(record.structured?.error ?? record.structured)}`);
      }
    }
  }
  const wavSha256 = first.filter((record) => record.fileSha256).map((record) => record.fileSha256);
  if (!wavSha256.length) failures.push('golden session wrote no file to hash');
  return {
    identical: canonicalA === canonicalB,
    hashA: sha256Hex(Buffer.from(canonicalA)),
    hashB: sha256Hex(Buffer.from(canonicalB)),
    calls: first.length,
    wavSha256,
    failures,
  };
}

/** A human-readable one-liner for the CLI and CI logs. */
export function describeResult(result) {
  return [
    `golden session: ${result.calls} calls, two passes ${result.identical ? 'identical' : 'DIFFERENT'}`,
    `  pass A sha256 ${result.hashA}`,
    `  pass B sha256 ${result.hashB}`,
    `  file sha256  ${result.wavSha256.join(', ') || '(none)'}`,
    ...result.failures.map((failure) => `  FAIL ${failure}`),
  ].join('\n');
}
