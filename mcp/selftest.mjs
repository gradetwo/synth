/**
 * The golden session: run the whole P13.2 tool surface twice and prove the two
 * runs are byte-identical.
 *
 * `docs/LLM-INTERFACE.md` §5 asks for exactly this, and it is the check that
 * catches the failure mode the tools are most prone to: an engine whose
 * `phase_seed` advances between calls, or a result that quietly depends on
 * wall-clock ordering. The session below touches every tool, renders a preset
 * and measures it with both rulers.
 *
 * It is exported so `npm run mcp -- --self-test`, the vitest suite and CI all
 * run the *same* session rather than three approximations of it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTools, loadContext } from './registry.mjs';
import { dispatch } from './protocol.mjs';
import { canonicalJson, resetCallSequence } from './lib/calls.mjs';
import { sha256Hex } from './lib/wav.mjs';
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

/** The scripted calls, in order. `f0` is computed so no magic number is baked in. */
export function goldenSession() {
  return [
    { tool: 'gs1.describe', args: {} },
    { tool: 'gs1.params.list', args: { filter: 'osc' } },
    { tool: 'gs1.presets.list', args: {} },
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
  ];
}

/** Run the session once, hashing any WAV it writes. */
async function runOnce(tools, ctx) {
  resetCallSequence();
  const records = [];
  for (const [index, call] of goldenSession().entries()) {
    const response = await dispatch(
      tools,
      ctx,
      { jsonrpc: '2.0', id: index, method: 'tools/call', params: { name: call.tool, arguments: call.args } },
      { log: false },
    );
    const result = response?.result;
    const structured = result?.structuredContent ?? null;
    const record = { tool: call.tool, isError: Boolean(result?.isError), structured };
    if (structured?.wavPath) {
      record.wavSha256 = sha256Hex(readFileSync(resolve(ROOT, structured.wavPath)));
    }
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
  const wavSha256 = first.filter((record) => record.wavSha256).map((record) => record.wavSha256);
  if (!wavSha256.length) failures.push('golden session wrote no WAV to hash');
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
    `  wav sha256   ${result.wavSha256.join(', ') || '(none)'}`,
    ...result.failures.map((failure) => `  FAIL ${failure}`),
  ].join('\n');
}
