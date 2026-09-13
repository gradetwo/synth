#!/usr/bin/env node
/**
 * CI configuration gate.
 *
 * The workflow is the only place the project's gates are *not* covered by a
 * test: deleting a step from `ci.yml` silently removes a check, and nothing
 * locally would notice. This walks the workflow (a small indentation-aware
 * reader is enough for the shape GitHub Actions uses) and asserts that the gates
 * we promise — Rust, unit, lint, build, wasm, dist, budget, audio, DSP, E2E on
 * all three engines — are still wired up.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, '.github/workflows/ci.yml');
const text = readFileSync(path, 'utf8');
const lines = text.split('\n');

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Job name -> the text of its steps, plus the whole job body. */
const jobs = new Map();
let job = null;
let inSteps = false;
for (const raw of lines) {
  if (raw.trimStart().startsWith('#')) continue;
  const indent = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (indent === 2 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
    job = trimmed.slice(0, -1);
    jobs.set(job, []);
    inSteps = false;
    continue;
  }
  if (!job) continue;
  if (indent === 4 && trimmed === 'steps:') {
    inSteps = true;
    continue;
  }
  if (!inSteps) continue;
  if (indent <= 4 && trimmed !== '') inSteps = false;
  if (inSteps) jobs.get(job).push(trimmed);
}

const body = (name) => (jobs.get(name) ?? []).join('\n');
console.log('[ci] workflow gates');

check('has a verify job and a cross-engine E2E job', jobs.has('verify') && jobs.has('e2e-engines'), [...jobs.keys()].join(', '));

const verify = body('verify');
const required = [
  ['clippy (correctness / suspicious / perf)', 'npm run verify:clippy'],
  ['Rust DSP tests', 'npm run test:rust'],
  ['unit + worklet tests', 'npm test'],
  ['lint', 'npm run lint'],
  ['production build', 'npm run build'],
  ['WASM gates (both cores)', 'verify-wasm.mjs'],
  ['release preflight', 'npm run verify:release'],
  ['dist integrity', 'npm run verify:dist'],
  ['payload budget', 'npm run verify:budget'],
  ['audio quality gates', 'npm run verify:audio'],
  ['preset fingerprints', 'npm run verify:presets'],
  ['2x oversampling preset fingerprints', 'npm run verify:presets:2x'],
  ['sustained-load benchmark', 'npm run verify:bench'],
  ['DSP regression baseline', 'npm run test:dsp'],
  ['2x oversampling DSP baseline', 'npm run verify:dsp:2x'],
  ['Chromium E2E', 'npm run test:e2e'],
];
for (const [name, needle] of required) {
  check(`verify job runs ${name}`, verify.includes(needle));
}
check('the scalar core is gated too', verify.includes('synth_core_scalar.wasm'));
check('dist is uploaded for inspection', verify.includes('upload-artifact'));

const engines = body('e2e-engines');
check('installs WebKit and Firefox', /playwright install[^\n]*webkit[^\n]*firefox/.test(engines));
check('runs the WebKit project', engines.includes('--project=webkit'));
check('runs the Firefox project', engines.includes('--project=firefox'));
check('builds the app before the browser run', engines.includes('npm run build'));
check('keeps failure artefacts', engines.includes('test-results'));

// The nightly job is a promise too: a scheduled run that quietly disappears is
// how a WebKit-only regression survives for days.
const nightly = body('nightly');
check('a nightly job exists', text.includes('  nightly:'));
check('it is scheduled', /cron:\s*'[^']+'/.test(text));
// The `if:` sits on the job, not inside its steps, so it is read from the whole
// file rather than from the step list.
check(
  'it only runs on the schedule',
  /nightly:\n\s+if:\s*github\.event_name\s*==\s*'schedule'/.test(text),
);
check('it runs WebKit', nightly.includes('--engines=webkit'));
check('it runs Firefox', nightly.includes('--engines=firefox'));
check('it runs the long benchmark', nightly.includes('npm run bench:long'));
check('it keeps its logs', nightly.includes('nightly-logs'));

if (failures.length) {
  console.error(`[ci] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[ci] PASS');
