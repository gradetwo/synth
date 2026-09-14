/**
 * The audit log: `.tmp/mcp/calls.jsonl`, one line per `tools/call`.
 *
 * `docs/LLM-INTERFACE.md` §5 asks for the call's name and an argument digest so
 * a human can reconstruct "what did the agent do". It is on by default and can
 * be switched off with `--no-log` or `GS1_MCP_LOG=0`.
 *
 * Deliberately **no timestamp and no clock reading**: the log is part of the
 * deterministic story, so it is sequence-numbered instead. A line is exactly
 * `{ seq, tool, argsDigest, ok, code }`, and `argsDigest` is a sha256 over a
 * key-sorted JSON rendering of the arguments — enough to tell two calls apart
 * without copying a 224-value patch into the log.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { TMP_DIR } from './data.mjs';

let sequence = 0;

/** Stable JSON: object keys sorted, so the digest does not depend on insertion order. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

export function digestOf(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * Append one call to the log. Returns the record (also useful in tests).
 * `enabled` is false when the caller disabled logging.
 */
export function logCall(tool, args, outcome, enabled = true) {
  sequence += 1;
  const record = {
    seq: sequence,
    tool,
    argsDigest: digestOf(args ?? {}),
    ok: Boolean(outcome?.ok),
    code: outcome?.code ?? null,
  };
  if (enabled) {
    mkdirSync(TMP_DIR, { recursive: true });
    appendFileSync(resolve(TMP_DIR, 'calls.jsonl'), `${JSON.stringify(record)}\n`);
  }
  return record;
}

/** Reset the counter for a fresh server (or a test that wants stable seqs). */
export function resetCallSequence() {
  sequence = 0;
}
