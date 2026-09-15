#!/usr/bin/env node
/**
 * CI configuration gate.
 *
 * The workflow is the only place the project's gates are *not* covered by a
 * test: deleting a step from `ci.yml` silently removes a check, and nothing
 * locally would notice. This walks the workflow (a small indentation-aware
 * reader is enough for the shape GitHub Actions uses) and asserts that the gates
 * we promise — Rust, unit, lint, build, wasm, dist, budget, audio, DSP, Chromium
 * E2E — are still wired up, that the two slow engines still run somewhere, and
 * that they run *only* from the schedule-gated job (see the twenty-minute rule
 * in `docs/notes/release.md`).
 *
 * It checks both halves of that promise. A command named in the workflow is only
 * real if `package.json` still defines it: a script can vanish (a bad merge, a
 * `git checkout -- package.json`, a rename) while the workflow text keeps
 * mentioning it, and then the gate is not merely missing — it fails in CI on a
 * command that does not exist, or worse, is skipped locally by a `verify` chain
 * that no longer names it. That exact hole existed: `verify:presets:2x` was
 * listed here and in `ci.yml`, `scripts/verify-presets.mjs` supported the flag,
 * and the `scripts` entry was gone, so this gate reported PASS. Every required
 * `npm run <name>` is now resolved against `package.json`'s `scripts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, '.github/workflows/ci.yml');
const text = readFileSync(path, 'utf8');
const lines = text.split('\n');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * The npm script a command line invokes, or null for anything that is not an
 * `npm` invocation (`node script.mjs`, a bare `npx`, …). `npm test` and
 * `npm run <name>`, with or without a `-- <args>` tail, are the shapes the
 * workflow uses.
 */
const scriptOf = (command) => {
  const m = /^npm\s+(?:run\s+)?(?<name>[^\s-][^\s]*)(?:\s+--.*)?$/.exec(command);
  if (!m) return null;
  const name = m.groups.name;
  return name === 'run' ? null : name;
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

check('has a verify job', jobs.has('verify'), [...jobs.keys()].join(', '));

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
  ['MCP tool server golden session', 'npm run mcp -- --self-test'],
  ['LLM interface docs vs the live registry', 'npm run verify:llm-docs'],
  ['Chromium E2E', 'npm run test:e2e'],
  ['performance E2E (isolated single worker)', 'npm run test:perf'],
];
/** Commands this file treats as required, so the scripts check cannot drift from it. */
const requiredCommands = new Set(required.map(([, needle]) => needle));
for (const [name, needle] of required) {
  check(`verify job runs ${name}`, verify.includes(needle));
}

// The other half: a step in the workflow is only a gate if the script it names
// still exists. Checked for every `npm run` this file requires, wherever it
// appears in the workflow (the nightly job runs `bench:long`, the E2E job runs
// `build`, …), not just in the verify job.
for (const needle of requiredCommands) {
  const name = scriptOf(needle);
  if (!name) continue;
  check(`package.json defines "${name}"`, Object.prototype.hasOwnProperty.call(scripts, name),
    Object.prototype.hasOwnProperty.call(scripts, name) ? '' : `${needle} is required but scripts["${name}"] is missing`);
}
// Two gates the nightly job owns; they are not in the verify job's list, so they
// are named here rather than folded into it.
for (const name of ['bench:long']) {
  check(`package.json defines "${name}"`, Object.prototype.hasOwnProperty.call(scripts, name));
}
// `verify` is the local entry point for all of it, so every gate it *can* run
// has to stay in the chain: dropping `npm run verify:presets:2x` from it made a
// real gate silently unreachable locally while CI still ran it.
const verifyChain = scripts.verify ?? '';
for (const name of [...requiredCommands] .map(scriptOf).filter((n) => n && n !== 'test:e2e' && n !== 'test:perf')) {
  // `test:e2e` and `test:perf` are the browser suites and deliberately not in
  // `verify` (they need a built dist and a browser; `verify` stays
  // browser-free), so they are the two commands exempt from the chain check.
  check(`the "verify" script runs "${name}"`, verifyChain.includes(`npm run ${name}`));
}
check('the scalar core is gated too', verify.includes('synth_core_scalar.wasm'));
check('dist is uploaded for inspection', verify.includes('upload-artifact'));

// §一.39: `dtolnay/rust-toolchain@stable` pins no version, and a clippy 1.98
// upgrade turned the *first* step of the verify job red with nobody expecting
// it. The version log therefore has to stay, and it has to stay *before* the
// clippy gate: a version printed after the step that died is a version nobody
// ever sees.
check('verify job logs the toolchain versions', verify.includes('Toolchain versions'));
for (const needle of ['rustc --version', 'cargo clippy --version', 'node --version', 'npm --version']) {
  check(`verify job prints "${needle}"`, verify.includes(needle));
}
const versionLogAt = verify.indexOf('rustc --version');
const clippyAt = verify.indexOf('npm run verify:clippy');
check(
  'the toolchain version log precedes the clippy gate',
  versionLogAt >= 0 && clippyAt >= 0 && versionLogAt < clippyAt,
  versionLogAt >= 0 && clippyAt >= 0 && versionLogAt < clippyAt ? '' : 'print the versions before `verify:clippy`, or the log is useless when clippy is the thing that broke',
);

// The slow engines may not sit in a push-triggered job. WebKit needs 42.7 min
// for the whole suite on a warm workstation (and 19.1 min for the fifty most
// relevant tests), Firefox is slow-lane only by the same decision, and the rule
// in `docs/notes/release.md` sends anything over twenty minutes to the slow
// lane. `e2e-engines` used to run both of them on every push and PR; this is the
// check that keeps that from being added back, by naming the engines anywhere in
// a job that the schedule guard does not cover.
const scheduledOnly = (name) => new RegExp(`\\n  ${name}:\\n\\s+if:\\s*github\\.event_name\\s*==\\s*'schedule'`).test(text);
for (const [name, steps] of jobs) {
  const slow = steps.some((line) => /--project=(webkit|firefox)\b|--engines=[^\n]*(webkit|firefox)/.test(line));
  if (!slow) continue;
  const gated = scheduledOnly(name);
  check(`the "${name}" job runs the slow engines only on the schedule`, gated,
    gated ? '' : `"${name}" names WebKit or Firefox but is not schedule-gated`);
}
check('no push-triggered cross-engine job', !jobs.has('e2e-engines'),
  jobs.has('e2e-engines') ? 'e2e-engines ran the whole WebKit suite on every push and is meant to stay gone' : '');

// The nightly job is a promise too: a scheduled run that quietly disappears is
// how a WebKit-only regression survives for days. It owns the two slow engines
// now, and it has to keep covering both of them over the whole suite — that was
// `e2e-engines`' job before, and dropping Firefox's full pass would be a silent
// coverage loss.
const nightly = body('nightly');
check('a nightly job exists', text.includes('  nightly:'));
check('it is scheduled', /cron:\s*'[^']+'/.test(text));
// The `if:` sits on the job, not inside its steps, so it is read from the whole
// file rather than from the step list.
check('it only runs on the schedule', scheduledOnly('nightly'));
check('it installs WebKit and Firefox', /playwright install[^\n]*webkit[^\n]*firefox/.test(nightly));
check('it builds the app before the browser run', nightly.includes('npm run build'));
check('it runs WebKit', nightly.includes('--engines=webkit'));
check('it runs Firefox', nightly.includes('--engines=firefox'));
const wholeSuite = (nightly.match(/--all\b/g) ?? []).length;
check('it runs both engines over the whole suite', wholeSuite >= 2,
  wholeSuite >= 2 ? '' : 'each engine needs an `--all` pass now that `e2e-engines` is gone');
check('it runs the long benchmark', nightly.includes('npm run bench:long'));
check('it keeps its logs', nightly.includes('nightly-logs'));
// §一.39 again: the nightly installs `dtolnay/rust-toolchain@stable` too, so a
// version bump can turn it red with no explanation in the log. The versions
// have to be printed before anything that can die, for the same reason the
// verify job prints them before clippy.
check('nightly job logs the toolchain versions', nightly.includes('Toolchain versions'));
for (const needle of ['rustc --version', 'cargo --version', 'node --version', 'npm --version']) {
  check(`nightly job prints "${needle}"`, nightly.includes(needle));
}

// §一.12 / §一.20⑦: the visual baselines are a gate nobody ran, and they drifted
// ten baselines out of date before P11.3 noticed. Both halves of the promise are
// asserted here. The job has to exist and actually run the suite (deleting it is
// exactly how "nobody runs it" started), and it may not run anywhere a push or
// a PR can be blocked by it: the baselines encode the recording host's font
// stack, so a red comparison on an Ubuntu runner means "different freetype" and
// nothing else. `continue-on-error` is deliberately *not* asserted — tightening
// that is the documented next step once the runner has shown what it does.
const visual = body('visual');
check('a visual-baseline job exists', jobs.has('visual'));
check('it only runs on the schedule', scheduledOnly('visual'));
check('it builds the app before comparing', visual.includes('npm run build'));
check('it installs Chromium', /playwright install[^\n]*chromium/.test(visual));
check('it runs the visual suite', visual.includes('npm run test:visual'));
check('it never records a baseline (--update-snapshots=none)', visual.includes('--update-snapshots=none'));
check('it keeps the diff images for the tightening decision', visual.includes('visual-diffs'));
check('package.json defines "test:visual"', Object.prototype.hasOwnProperty.call(scripts, 'test:visual'));
// The general form of "not in the blocking set": *any* job that runs the suite
// has to be schedule-gated, so adding it to a push job later reads as a failure
// here rather than as a red PR that means "different freetype".
for (const [name, steps] of jobs) {
  if (name === 'visual') continue;
  if (!steps.some((line) => line.includes('test:visual'))) continue;
  check(
    `the "${name}" job runs the visual suite only on the schedule`,
    scheduledOnly(name),
    `"${name}" runs the visual suite but is not schedule-gated`,
  );
}

if (failures.length) {
  console.error(`[ci] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[ci] PASS');
