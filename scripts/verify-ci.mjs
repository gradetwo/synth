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
 * that a push or a PR cannot be failed by one of the slow jobs (WebKit/Firefox
 * and the visual baselines; see the twenty-minute rule in
 * `docs/notes/release.md`). Those jobs now run on push/PR too, and each carries
 * a `continue-on-error` guard that keeps it a report there.
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
import { existsSync, readFileSync } from 'node:fs';
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

/** Job name -> the text of its steps, and its job-level keys (`if:`, `continue-on-error:`, …). */
const jobs = new Map();
const headers = new Map();
let job = null;
let inSteps = false;
for (const raw of lines) {
  if (raw.trimStart().startsWith('#')) continue;
  const indent = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  if (indent === 2 && trimmed.endsWith(':') && !trimmed.startsWith('-')) {
    job = trimmed.slice(0, -1);
    jobs.set(job, []);
    headers.set(job, []);
    inSteps = false;
    continue;
  }
  if (!job) continue;
  if (indent === 4 && trimmed === 'steps:') {
    inSteps = true;
    continue;
  }
  if (!inSteps) {
    // Job-level keys sit at indent 4, before `steps:`.
    if (indent === 4) headers.get(job).push(trimmed);
    continue;
  }
  if (indent <= 4 && trimmed !== '') inSteps = false;
  if (inSteps) jobs.get(job).push(trimmed);
}

const body = (name) => (jobs.get(name) ?? []).join('\n');
/** The job-level keys of a job, joined (`if:`, `continue-on-error:`, …). */
const jobHeader = (name) => (headers.get(name) ?? []).join('\n');

/** The job's `if:` expression, or '' when it has none, so every trigger reaches it. */
const jobIf = (name) => {
  const m = /^if:\s*(.+)$/m.exec(jobHeader(name));
  return m ? m[1].trim() : '';
};

/** True when both a push and a PR reach the job. */
const runsOnPush = (name) => {
  const cond = jobIf(name);
  if (cond === '') return true;
  return /'push'/.test(cond) && /'pull_request'/.test(cond);
};

/**
 * True when the job cannot fail a push/PR run on a slow engine. Two shapes
 * count: the job-level guard (`continue-on-error` limited to the schedule), or
 * a `continue-on-error: true` on the step that runs the slow engines on push --
 * the nightly job's shape, where the scheduled steps are different steps and
 * stay hard. A job that simply excludes push and PR also passes.
 */
const guardedForPush = (name) => {
  const cond = jobIf(name);
  if (cond !== '' && !/'push'/.test(cond) && !/'pull_request'/.test(cond)) return true;
  const m = /^continue-on-error:\s*(.+)$/m.exec(jobHeader(name));
  if (m && /github\.event_name/.test(m[1]) && /'schedule'/.test(m[1])) return true;
  return (jobs.get(name) ?? []).some((line) => /^continue-on-error:\s*true\s*$/.test(line));
};

/** True for a job that never fails the run at all (`continue-on-error: true`). */
const reportOnly = (name) => /^continue-on-error:\s*true\s*$/m.test(jobHeader(name));
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
// The frame-addressed host-protocol gate (`docs/notes/groove-host-protocol.md` ↔
// `src/audio/worklet-processor.js`) has its own npm script and is pinned here explicitly, because
// neither half of the promise above covers it: it is not a CI step, so `required` cannot carry it,
// and a contract gate that only exists as a file is a gate nobody runs. `package.json` owns the
// script line (the merge that lands the document adds
// `"verify:worklet-protocol": "node scripts/verify-worklet-protocol.mjs"`); this check keeps it
// reachable from `npm run verify`. The trailing guard keeps a near-miss name
// (`verify:worklet-protocol:2x`) from satisfying the check.
const inVerifyChain = (name) => new RegExp(`npm run ${name}(?![\\w:-])`).test(verifyChain);
check('the "verify" script runs "verify:worklet-protocol"',
  inVerifyChain('verify:worklet-protocol'),
  inVerifyChain('verify:worklet-protocol')
    ? ''
    : 'add "verify:worklet-protocol": "node scripts/verify-worklet-protocol.mjs" to package.json scripts and name it in the "verify" chain (scripts/verify-worklet-protocol.mjs is otherwise unreachable locally)');
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

// The slow engines now run on push/PR too, but they may not *fail* one. WebKit
// needs 42.7 min for the whole suite on a warm workstation (and 19.1 min for the
// fifty most relevant tests), Firefox is slow by the same measure, and the rule
// in `docs/notes/release.md` is that anything over twenty minutes does not sit
// in the blocking set. So the promise is no longer "schedule-only": a job that
// names WebKit or Firefox has to reach push and PR (the results should arrive
// with the commit) and carry a guard that keeps a flake or a host difference
// from failing the run there. `e2e-engines` used to run both engines on every
// push with no guard; this is the check that keeps that shape from coming back.
for (const [name, steps] of jobs) {
  const slow = steps.some((line) => /--project=(webkit|firefox)\b|--engines=[^\n]*(webkit|firefox)/.test(line));
  if (!slow) continue;
  check(`the "${name}" job reaches push and PR`, runsOnPush(name));
  const guarded = guardedForPush(name) || reportOnly(name);
  check(
    `the "${name}" job cannot fail a push/PR run on a slow engine`,
    guarded,
    guarded ? '' : `"${name}" names WebKit or Firefox and is not guarded for push/PR`,
  );
}
check('no push-triggered cross-engine job', !jobs.has('e2e-engines'),
  jobs.has('e2e-engines') ? 'e2e-engines ran the whole WebKit suite on every push and is meant to stay gone' : '');

// The nightly job is a promise too: a scheduled run that quietly disappears is
// how a WebKit-only regression survives for days. It owns the two slow engines,
// and it has to keep covering both of them over the whole suite — that was
// `e2e-engines`' job before, and dropping Firefox's full pass would be a silent
// coverage loss. Push runs the bounded subset instead, and the schedule keeps
// `--all`; both stay in this one job so there is one place to read.
const nightly = body('nightly');
check('a nightly job exists', text.includes('  nightly:'));
check('it is scheduled', /cron:\s*'[^']+'/.test(text));
check('it runs on push, PR and the schedule', runsOnPush('nightly'));
check('it cannot fail a push/PR run (the schedule stays hard)', guardedForPush('nightly'));
check('its push/PR pass is the bounded core subset', nightly.includes('--core'));
const guardCount = (nightly.match(/^continue-on-error:\s*true$/gm) ?? []).length;
check('only that pass is guarded, not the scheduled steps', guardCount === 1,
  guardCount === 1 ? '' : `the nightly job should tolerate exactly the push/PR \`--core\` step (found ${guardCount})`);
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

// The local half of the same promise. The systemd timer is the run that
// actually writes `docs/notes/nightly.md`, and its subset decides whether a
// night produces a result row or a timeout with nothing in it. The default
// subset (core + visual + audio) and `--all` both outlast a night on this
// machine's WebKit -- 2026-09-15/16: WebKit default >96 min and WebKit `--all`
// >132 min, neither finished; Firefox's default passed in 14.8 min -- so the
// timer runs `--core` and CI keeps the whole suite. Pinned in both directions
// so neither half can drift: the timer may not slide back to the default set
// (§一.18), and it may not absorb `--all` and turn CI's job into a duplicate.
// It has to keep naming both engines, too; dropping Firefox here would be the
// same silent coverage loss the CI-side check above exists to prevent.
const unitPath = resolve(root, 'scripts/systemd/gs1-nightly.service');
check('a systemd nightly timer unit exists', existsSync(unitPath), unitPath);
if (existsSync(unitPath)) {
  const unit = readFileSync(unitPath, 'utf8');
  // Only the `ExecStart=` line decides what the timer runs. The comments around
  // it explain the choice and therefore *name* `--core` and `--all`; matching
  // the whole file would make the comment satisfy the check by itself (and the
  // `--all` line fail it for merely being mentioned).
  const exec = unit.split('\n').find((line) => line.startsWith('ExecStart=')) ?? '';
  check('the nightly timer has an ExecStart line', exec !== '');
  check('the nightly timer runs the core subset', exec.includes('--core'),
    exec.includes('--core') ? '' : `ExecStart does not name --core (${exec.trim()}), so the timer is back on the default subset, which does not finish here (see docs/notes/nightly.md)`);
  check('the nightly timer does not run the whole suite', !/--all\b/.test(exec),
    /--all\b/.test(exec) ? '`--all` is the CI schedule job\'s job; the timer must not duplicate it' : '');
  check('the nightly timer still names both slow engines', exec.includes('--engines=webkit,firefox'));
  // The timeout is the conclusion of the same measurement, so it is pinned the
  // same way: with `--core` fixed, 3h would still be a silently editable number
  // and a timeout discards the run with no result row. Only the directive line
  // counts -- the comment above the value explains it and names the value, so
  // matching the whole file would let the prose satisfy (or fail) the check.
  const timeout = unit
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('TimeoutStartSec=')) ?? '';
  check('the nightly timer has a TimeoutStartSec', timeout !== '');
  check('the nightly timer keeps the 5h timeout', timeout === 'TimeoutStartSec=5h',
    timeout === 'TimeoutStartSec=5h' ? '' : `TimeoutStartSec is "${timeout || 'missing'}", not "TimeoutStartSec=5h" -- the value comes from the 2026-09-15/16 timings (see docs/notes/nightly.md); change the assertion and record the reason before changing it`);
}

// §一.12 / §一.20⑦: the visual baselines are a gate nobody ran, and they drifted
// ten baselines out of date before P11.3 noticed. The job has to exist and
// actually run the suite (deleting it is exactly how "nobody runs it" started),
// and it now runs on push/PR as well as on the schedule. It therefore has to be
// report-only: the baselines encode the recording host's font stack, so a red
// comparison on an Ubuntu runner means "different freetype" and nothing else.
// Asserting `continue-on-error` is the point now -- dropping it would turn that
// known-false red into a blocked PR. Tightening to a hard signal is still the
// documented next step once the runner has shown what it does, and that step has
// to change this check and the docs on purpose.
const visual = body('visual');
check('a visual-baseline job exists', jobs.has('visual'));
check('it runs on push, PR and the schedule', runsOnPush('visual'));
check('it is report-only, so a font-stack difference cannot fail a push', reportOnly('visual'));
check('it builds the app before comparing', visual.includes('npm run build'));
check('it installs Chromium', /playwright install[^\n]*chromium/.test(visual));
check('it runs the visual suite', visual.includes('npm run test:visual'));
check('it never records a baseline (--update-snapshots=none)', visual.includes('--update-snapshots=none'));
check('it keeps the diff images for the tightening decision', visual.includes('visual-diffs'));
check('package.json defines "test:visual"', Object.prototype.hasOwnProperty.call(scripts, 'test:visual'));
// The general form of "not in the blocking set": *any* job that runs the suite
// has to be guarded for push/PR, so adding it to an unguarded push job later
// reads as a failure here rather than as a red PR that means "different
// freetype".
for (const [name, steps] of jobs) {
  if (name === 'visual') continue;
  if (!steps.some((line) => line.includes('test:visual'))) continue;
  const guarded = guardedForPush(name) || reportOnly(name);
  check(
    `the "${name}" job cannot fail a push/PR run on the visual suite`,
    guarded,
    guarded ? '' : `"${name}" runs the visual suite but is not guarded for push/PR`,
  );
}

if (failures.length) {
  console.error(`[ci] FAIL — ${failures.join(', ')}`);
  process.exit(1);
}
console.log('[ci] PASS');
