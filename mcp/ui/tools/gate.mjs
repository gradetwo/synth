/**
 * `gs1.ui.gate` — run one of the existing Playwright gates and report it as JSON.
 *
 * **Whitelisted, never a path.** The three specs below are the gates that exist
 * in this repository, each mapped to the exact argv this tool runs; a caller
 * cannot name a spec file, a project other than chromium, or an extra flag. That
 * is the difference between "run the visual gate" and "run arbitrary code with
 * the repository's dev dependencies".
 *
 *   * `visual`       — `e2e/visual.spec.ts`, the baseline comparison (the count
 *                      is read from the snapshot directory, never written down).
 *                      Opt-in upstream (`GS1_VISUAL=1`), which this sets.
 *   * `performance`  — `e2e/performance.spec.ts`, the two frame-cost gates.
 *                      Runs in its own `perf` project, single worker, exactly
 *                      as `npm run test:perf` does, because measuring frame cost
 *                      next to other workers measures the host.
 *   * `param-range`  — `e2e/param-range.spec.ts`, the AudioParam range checks.
 *
 * Port: `GS1_E2E_PORT` is forced to this layer's own port (default 4796), never
 * the config's 4783, so a gate run here cannot collide with the E2E suite.
 * Output: the JSON reporter's file, written under `.tmp/mcp/` through P13.2's
 * path boundary; the human log's tail comes back with the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolveOutputPath, repoPath } from '../../lib/paths.mjs';
import { ROOT } from '../../lib/data.mjs';
import { ERRORS, fail } from '../../lib/errors.mjs';
import { previewPort } from '../lib/preview.mjs';
import { baselineNames } from '../lib/baselines.mjs';

/**
 * How many desktop baselines `visual` will compare. Counted, not written down:
 * the note below used to say "twenty" while the suite had grown to 24, which is
 * exactly the drift `scripts/verify-llm-docs.mjs` catches in the docs.
 */
const VISUAL_BASELINES = baselineNames('desktop').length;

/** The gates this tool will run: a name, the spec, and the env it needs. */
export const SPECS = {
  visual: {
    spec: 'e2e/visual.spec.ts',
    project: 'chromium',
    env: { GS1_VISUAL: '1' },
    note: `${VISUAL_BASELINES} visual baselines, compared with the suite's own tolerance`,
  },
  performance: {
    spec: 'e2e/performance.spec.ts',
    project: 'perf',
    env: {},
    workers: 1,
    note: 'the two frame-cost gates, isolated single-worker like `npm run test:perf`',
  },
  'param-range': {
    spec: 'e2e/param-range.spec.ts',
    project: 'chromium',
    env: {},
    note: 'AudioParam range checks',
  },
};

/** `--reporter=json` writes a JSON file in Playwright 1.6x; ask for a known path. */
const JSON_REPORT = '.tmp/mcp/ui-gate-report.json';
const LOG_NAME = '.tmp/mcp/ui-gate.log';
/** The tail of the human log a result carries (the full log stays on disk). */
const LOG_TAIL = 4000;
/** The argv prefix the run spawns; a test seam, never a caller-controlled value. */
export const PLAYWRIGHT_ARGV = ['npx', 'playwright', 'test'];

/** One Playwright run through the context's spawn (overridable only by tests). */
function runPlaywright(spawnFn, args, env) {
  return new Promise((resolvePromise) => {
    const [command, ...prefix] = PLAYWRIGHT_ARGV;
    const child = spawnFn(command, [...prefix, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => resolvePromise({ code: null, output: `${output}\nspawn failed: ${error.message}` }));
    child.on('close', (code) => resolvePromise({ code, output }));
  });
}

/** Flatten the JSON reporter's suites into one entry per test. */
function collectTests(report) {
  const tests = [];
  const walk = (suite, path) => {
    const title = suite.title ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results[results.length - 1] ?? {};
        tests.push({
          title: [...title, spec.title].filter(Boolean).join(' › '),
          project: test.projectName ?? null,
          status: last.status ?? test.status ?? 'unknown',
          expectedStatus: test.expectedStatus ?? null,
          durationMs: last.duration ?? null,
          error: last.error?.message ? String(last.error.message).split('\n')[0].slice(0, 300) : null,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, title);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return tests;
}

export default {
  name: 'gs1.ui.gate',
  description:
    'Run one whitelisted Playwright gate (visual | performance | param-range) on chromium through its own port and return passed/failed/skipped counts, every test title, and the log tail. Arbitrary spec paths and other projects are refused.',
  inputSchema: {
    type: 'object',
    properties: {
      spec: { type: 'string', enum: Object.keys(SPECS), description: 'Which gate to run.' },
      project: { type: 'string', enum: ['chromium'], description: 'Only chromium is supported (default chromium).' },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 900_000, description: 'Wall-clock cap for the run (default 300000).' },
    },
    required: ['spec'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const entry = SPECS[args.spec];
    if (!entry) {
      throw fail(ERRORS.UI_SPEC, `unknown gate spec "${args.spec}"`, {
        field: 'spec',
        spec: args.spec,
        allowed: Object.keys(SPECS),
      });
    }
    // The schema already pins chromium; the handler keeps the promise even if a
    // caller reaches it some other way (the tests do).
    const project = args.project ?? 'chromium';
    if (project !== 'chromium') {
      throw fail(ERRORS.UI_SPEC, `project "${project}" is not supported: only chromium runs here`, {
        field: 'project',
        project,
        allowed: ['chromium'],
      });
    }

    const reportPath = resolveOutputPath(JSON_REPORT);
    const logPath = resolveOutputPath(LOG_NAME);
    const port = previewPort();
    const url = `http://127.0.0.1:${port}`;
    const argv = [
      entry.spec,
      `--project=${entry.project}`,
      '--reporter=list,json',
      `--workers=${entry.workers ?? 2}`,
    ];
    const env = {
      ...entry.env,
      GS1_E2E_PORT: String(port),
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
    };

    const started = Date.now();
    const { code, output } = await runPlaywright(ctx.spawn ?? spawn, argv, env);
    const elapsedMs = Date.now() - started;
    // The whole log stays on disk (the result carries only its tail): a failed
    // gate is read from here, not re-run to be seen.
    try {
      writeFileSync(logPath, output);
    } catch {
      // A log that cannot be written must not turn a green gate red.
    }

    let report = null;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      report = null;
    }
    const tests = report ? collectTests(report) : [];
    const count = (status) => tests.filter((test) => test.status === status).length;
    const skipped = tests.filter((test) => test.status === 'skipped' || test.expectedStatus === 'skipped').length;

    return {
      ok: code === 0,
      spec: args.spec,
      specFile: entry.spec,
      project: entry.project,
      command: `npx playwright test ${argv.join(' ')}`,
      port,
      url,
      exitCode: code,
      elapsedMs,
      passed: count('passed'),
      failed: count('failed') + count('timedOut'),
      skipped,
      tests: tests.map((test) => ({
        title: test.title,
        project: test.project,
        status: test.status,
        durationMs: test.durationMs,
        error: test.error,
      })),
      logPath: repoPath(logPath),
      reportPath: repoPath(reportPath),
      logTail: output.slice(-LOG_TAIL),
      note: entry.note,
      reportParsed: Boolean(report),
    };
  },
};
