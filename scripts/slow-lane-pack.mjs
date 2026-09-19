#!/usr/bin/env node
/**
 * Run the slow lanes on a fast machine and hand back one archive.
 *
 * The WebKit and Firefox suites take tens of minutes to hours here (the WebKit
 * core subset was still running at 96 minutes when it was cut short), and this
 * machine is not always the one they can run on. This script exists so the run
 * can be started on a faster host with one command, and the **results** -- not
 * just a pass/fail line -- can be carried back: a streamed log per run, the
 * machine-readable Playwright report, the `test-results/` failure contexts, the
 * environment that produced them, a `SUMMARY.md`, and a hash manifest, all in a
 * single `.tar.gz`.
 *
 * Usage (from the repository root, after `npm install` and one
 * `npx playwright install webkit firefox`):
 *
 *   node scripts/slow-lane-pack.mjs                       # webkit+firefox, core subset
 *   node scripts/slow-lane-pack.mjs --subset=all          # ... the whole suite (hours)
 *   node scripts/slow-lane-pack.mjs --engine=webkit --subset=nightly
 *   node scripts/slow-lane-pack.mjs --specs=e2e/player.spec.ts,e2e/flow.spec.ts
 *   node scripts/slow-lane-pack.mjs --self-test           # one-file Chromium dry run (~1 min)
 *   node scripts/slow-lane-pack.mjs --dry-run             # print the plan, run nothing
 *
 * `--skip-build` reuses the existing `dist/` (fine when the tree has not changed
 * since the last build; the archive records which bundle was used either way). A
 * run that fails does not stop the packer: its exit code, log and failure
 * contexts land in the summary, and the remaining runs still happen.
 *
 * Layer: Node only. The Playwright work happens in child processes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBSETS, subsetFor } from './lib/e2e-subsets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ----------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const die = (message) => {
  console.error(`[slow-lane] ${message}`);
  process.exit(1);
};

const selfTest = flag('self-test');
const selfTestSteps = flag('self-test-steps');
const dryRun = flag('dry-run');

/** Engine projects to run, in order. */
const engines = (selfTest ? 'chromium' : value('engine') ?? 'webkit,firefox')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** `core`/`nightly`/`all`, or an explicit comma-separated spec list via --specs. */
const subsetArg = selfTest ? 'self-test' : value('subset') ?? 'core';
const specsArg = value('specs');
const explicitSpecs = specsArg ? specsArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
const specs = selfTest ? ['e2e/smoke.spec.ts'] : explicitSpecs ?? subsetFor(subsetArg);
if (!Array.isArray(specs)) die(`unknown --subset=${subsetArg} (expected ${Object.keys(SUBSETS).join(', ')})`);

/**
 * `--steps=<npm script>[,<script>]` runs the repository's own gates instead of
 * Playwright subsets: `--steps=verify` for the fast lane, `--steps=e2e` for the
 * whole Chromium suite, both for a release-shaped check. The collection,
 * summary, manifest and archive are the same ones the lane runs use, because
 * the point is the same: the run happens on whichever machine is fast enough,
 * and what comes back is evidence rather than a pass/fail line.
 */
const STEP_ALIASES = { e2e: 'test:e2e', perf: 'test:perf', visual: 'test:visual', unit: 'test', dsp: 'test:dsp' };
const stepTokens = (value('steps') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => (s.startsWith('pw:') ? s : (STEP_ALIASES[s] ?? s)));
if (selfTestSteps && stepTokens.length === 0) stepTokens.push('test:dsp');
const stepsMode = stepTokens.length > 0;
/** Only the browser suites need a port and a JSON report path. */
const isBrowserStep = (name) => /e2e|playwright|perf|visual/.test(name);

/**
 * A step is either an npm script (`verify`, `e2e`, `test:dsp`) or a Playwright
 * engine run written `pw:<project>:<subset>` (`pw:webkit:all`) -- the second
 * form is how one pack can hold both the gates and the cross-engine sweep.
 */
const stepPlan = () =>
  stepTokens.map((token) => {
    if (!token.startsWith('pw:')) {
      const script = STEP_ALIASES[token] ?? token;
      return {
        label: `npm run ${script}`,
        name: script.replace(/[:/]/g, '-'),
        cmd: 'npm',
        args: ['run', script],
        browser: isBrowserStep(script),
      };
    }
    const [, project, subset = 'core'] = token.split(':');
    const picked = subsetFor(subset);
    if (picked === null) die(`unknown subset in --steps=${token} (expected ${Object.keys(SUBSETS).join(', ')})`);
    return {
      label: `${project} ${subset}`,
      name: `${project}-${subset}`,
      cmd: 'npx',
      args: [
        'playwright',
        'test',
        `--project=${project}`,
        '--workers=1',
        '--retries=0',
        '--reporter=list,json',
        ...picked,
      ],
      browser: true,
    };
  });

const basePort = Number(value('port') ?? (selfTest ? 4811 : stepsMode ? 4805 : 4805));
const timeoutMin = Number(value('timeout-min') ?? (stepsMode ? 90 : 300));
const skipBuild = flag('skip-build') || selfTest;
const label = value('label') ?? (stepsMode ? 'gate' : 'slow-lane');
const outRoot = resolve(root, value('out') ?? (stepsMode ? '.tmp/gate' : '.tmp/slow-lane'));

const slice = explicitSpecs ? 'explicit' : subsetArg;
/** `--subset=all` is the empty list, i.e. "let Playwright collect everything" -- say that, not "0 file(s)". */
const describeSpecs = () =>
  specs.length === 0
    ? 'whole suite (no file filter)'
    : `${specs.length} ${explicitSpecs ? 'explicit ' : ''}file(s)`;

// -------------------------------------------------------------------- helpers

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const noAnsi = (s) => String(s ?? '').replace(ANSI, '');

/** Spawn, tee stdout+stderr to the console and an optional log file. */
const run = (command, args, options = {}) =>
  new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so a timeout can kill the whole tree
    });
    const stream = options.sink ? createWriteStream(options.sink, { flags: 'a' }) : null;
    const write = (chunk) => {
      const text = chunk.toString('utf8');
      stream?.write(text);
      process.stdout.write(options.prefix ? text.replace(/^/gm, options.prefix) : text);
    };
    child.stdout.on('data', write);
    child.stderr.on('data', write);

    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    let timedOut = false;
    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            write(`\n[slow-lane] TIMEOUT after ${Math.round(options.timeoutMs / 60000)} min -- killing\n`);
            kill('SIGTERM');
            setTimeout(() => kill('SIGKILL'), 10_000);
          }, options.timeoutMs)
        : null;

    const started = Date.now();
    const finish = (payload) => {
      if (timer) clearTimeout(timer);
      stream?.end();
      resolvePromise({ ...payload, timedOut, ms: Date.now() - started });
    };
    child.on('close', (code, signal) => finish({ code: code ?? 1, signal }));
    child.on('error', (error) => {
      write(`\n[slow-lane] spawn failed: ${error.message}\n`);
      finish({ code: 1, signal: null, error });
    });
  });

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Copy `from` into `to` when it exists; returns the number of files copied.
 *
 *  Playwright rewrites/removes bookkeeping files (`test-results/.last-run.json`)
 *  while the run wraps up, so an entry can vanish between the readdir and the
 *  copy. A vanished file is not a result: skip it and keep going. */
function copyTree(from, to) {
  if (!existsSync(from)) return 0;
  let count = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    try {
      if (entry.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        count += copyTree(src, dst);
      } else if (entry.isFile()) {
        copyFileSync(src, dst);
        count += 1;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return count;
}

/** Flatten a Playwright JSON report into the facts the summary needs. */
function readReport(file) {
  if (!existsSync(file)) return null;
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const failures = [];
  const walk = (suite, trail) => {
    const title = trail ? `${trail} › ${suite.title}` : suite.title;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (['failed', 'timedOut', 'interrupted'].includes(result.status)) {
            failures.push({
              title: title ? `${title} › ${spec.title}` : spec.title,
              status: result.status,
              ms: result.duration,
              error: noAnsi(result.error?.message ?? result.error?.value ?? '')
                .split('\n')
                .slice(0, 12)
                .join('\n'),
            });
          }
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, title);
  };
  for (const suite of report.suites ?? []) walk(suite, '');
  const s = report.stats ?? {};
  return {
    counts: {
      expected: s.expected ?? 0,
      unexpected: s.unexpected ?? 0,
      flaky: s.flaky ?? 0,
      skipped: s.skipped ?? 0,
      durationMs: s.duration ?? 0,
    },
    failures,
  };
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------- preflight

if (!dryRun) {
  if (!existsSync(join(root, 'package.json'))) die('run this from the repository root');
  if (!stepsMode && !existsSync(join(root, 'node_modules', 'playwright-core'))) {
    die('node_modules/playwright-core is missing -- run `npm install` here first');
  }
  if (!stepsMode && !existsSync(join(root, 'playwright.config.ts'))) die('run this from the repository root');
  if (!stepsMode && skipBuild && !existsSync(join(root, 'dist', 'index.html'))) {
    die('--skip-build was given but dist/index.html does not exist -- run `npm run build` once');
  }
  if (stepsMode && !flag('allow-probes')) {
    // A `_probe-*.spec.ts` left in `e2e/` is collected by `npm run test:e2e` and by
    // the engine runs, which turns a gate result into a mixture of real results
    // and a throwaway probe's. Refuse rather than report a number that reads
    // like a product failure (`--allow-probes` overrides).
    const strays = existsSync(join(root, 'e2e'))
      ? readdirSync(join(root, 'e2e')).filter((f) => /^_probe-.*\.spec\.ts$/.test(f))
      : [];
    if (strays.length) {
      die(
        `e2e/ still holds ${strays.length} throwaway probe spec(s): ${strays.join(', ')}\n` +
          '          Move them out (they are collected by every Playwright step), or pass --allow-probes.',
      );
    }
  }
  if (stepsMode) {
    // `verify` starts with clippy and the Rust tests; without a toolchain those
    // two steps fail and the rest still runs (the packer never stops early), but
    // say so up front rather than letting it look like a product failure.
    if (stepTokens.some((s) => s === 'verify' || s === 'verify:clippy' || s === 'test:rust')) {
      const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
      if (cargo.status !== 0) {
        console.log('[slow-lane] WARNING: cargo is not on PATH -- the Rust steps of `verify` will fail.');
        console.log('[slow-lane]          Either install Rust, or run a subset, e.g. --steps=test:e2e,test,verify:dist.');
      }
    }
  }
}

// ------------------------------------------------------------------- finalise

/** Write `manifest.sha256` for the run directory and tar it up. */
async function finalise(runDir, label, stamp, outRoot) {
  const files = [];
  const collect = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.isFile() && entry.name !== 'manifest.sha256') files.push(full);
    }
  };
  collect(runDir);
  writeFileSync(
    join(runDir, 'manifest.sha256'),
    `${files
      .map((f) => `${sha256(f)}  ${relative(runDir, f)}`)
      .sort()
      .join('\n')}\n`,
  );
  const archive = join(outRoot, `${label}-${stamp}.tar.gz`);
  const tar = await run('tar', ['-czf', archive, '-C', runDir, '.'], { timeoutMs: 10 * 60_000 });
  const sizeMb = existsSync(archive) ? Math.round((statSync(archive).size / 1024 / 1024) * 10) / 10 : 0;
  console.log(`\n[slow-lane] ${tar.code === 0 ? 'archive written' : 'ARCHIVE FAILED'}: ${archive} (${sizeMb} MB)`);
  console.log(`[slow-lane] summary: ${join(runDir, 'SUMMARY.md')}`);
  return { archive, tarCode: tar.code };
}

// ----------------------------------------------------------------------- main

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(outRoot, `${label}-${stamp}`);
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  mkdirSync(join(runDir, 'reports'), { recursive: true });

  // git HEAD (also sniffed from .git/HEAD as a fallback for packed refs / no git)
  const gitHead =
    spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() ||
    readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();

  console.log(`[slow-lane] ${engines.join(' + ')} · subset=${slice} · ${describeSpecs()}`);
  console.log(`[slow-lane] port base ${basePort} · per-run timeout ${timeoutMin} min · output ${runDir}`);
  if (dryRun) {
    for (const [i, engine] of engines.entries()) {
      console.log(`[slow-lane] would run: ${engine} on port ${basePort + i}`);
    }
    for (const spec of specs) console.log(`[slow-lane]   ${spec}`);
    return;
  }

  if (!skipBuild) {
    console.log('[slow-lane] building (npm run build) …');
    const build = await run('npm', ['run', 'build'], {
      sink: join(runDir, 'logs', 'build.log'),
      prefix: '[build] ',
      timeoutMs: 20 * 60_000,
    });
    if (build.code !== 0) console.log('[slow-lane] build FAILED -- runs will use the existing dist');
  } else {
    console.log('[slow-lane] --skip-build: using the existing dist');
  }

  const runs = [];
  let port = basePort;
  for (const engine of engines) {
    const name = `${engine}-${slice}`;
    const logFile = join(runDir, 'logs', `${name}.log`);
    const jsonFile = join(runDir, 'reports', `${name}.json`);
    console.log(`\n[slow-lane] ================= ${name} (port ${port}) =================`);
    const result = await run(
      'npx',
      ['playwright', 'test', `--project=${engine}`, '--workers=1', '--retries=0', '--reporter=list,json', ...specs],
      {
        sink: logFile,
        env: { GS1_E2E_PORT: String(port), PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile },
        timeoutMs: timeoutMin * 60_000,
      },
    );
    // Playwright wipes test-results/ at the start of every run, so each run's
    // failure contexts are copied out now, under that run's own name.
    const contextFiles = copyTree(join(root, 'test-results'), join(runDir, `test-results-${name}`));
    const report = readReport(jsonFile);
    runs.push({
      name,
      engine,
      exit: result.code,
      timedOut: result.timedOut,
      ms: result.ms,
      counts: report?.counts ?? null,
      failures: report?.failures ?? [],
      contextFiles,
    });
    console.log(
      `[slow-lane] ${name}: exit ${result.code}${result.timedOut ? ' (timeout)' : ''} · ` +
        (report
          ? `${report.counts.expected} passed, ${report.counts.unexpected} failed, ` +
            `${report.counts.flaky} flaky, ${report.counts.skipped} skipped · ${contextFiles} context file(s)`
          : 'no JSON report (the run may not have reached the reporter)'),
    );
  }

  // ---------------------------------------------------------------- environment
  const playwrightPkg = readJson(join(root, 'node_modules', 'playwright-core', 'package.json'));
  const pkg = readJson(join(root, 'package.json')) ?? {};
  const distIndex = existsSync(join(root, 'dist', 'index.html'))
    ? readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    : null;
  const environment = {
    generatedAt: new Date().toISOString(),
    label,
    host: {
      platform: process.platform,
      arch: process.arch,
      osRelease: (await import('node:os')).release(),
      cpus: cpus().length,
      cpusModel: cpus()[0]?.model ?? null,
      totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      tmpDir: tmpdir(),
    },
    node: process.version,
    playwright: playwrightPkg?.version ?? 'unknown',
    packageVersion: pkg.version ?? 'unknown',
    gitHead,
    engines,
    subset: slice,
    specs,
    dist: distIndex
      ? {
          entryJs: distIndex.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null,
          assetCount: existsSync(join(root, 'dist', 'assets')) ? readdirSync(join(root, 'dist', 'assets')).length : null,
          indexHtmlSha256: createHash('sha256').update(distIndex).digest('hex'),
        }
      : null,
    runs: runs.map((r) => ({ name: r.name, exit: r.exit, timedOut: r.timedOut, ms: r.ms, counts: r.counts })),
  };
  writeFileSync(join(runDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);

  // ------------------------------------------------------------------- summary
  const lines = [
    `# slow lane pack · ${label}`,
    '',
    `- host: ${process.platform} ${process.arch} · ${environment.host.cpusModel ?? '?'} × ${environment.host.cpus} · ` +
      `${environment.host.totalMemGb} GB`,
    `- node ${process.version} · playwright ${environment.playwright} · package ${environment.packageVersion}`,
    `- dist entry: ${environment.dist?.entryJs ?? '(no dist)'}`,
    `- slice: ${engines.join(' + ')} · subset=${slice} · ${describeSpecs()}`,
    `- per-run timeout ${timeoutMin} min · port base ${basePort} · generated ${environment.generatedAt}`,
    '',
    '| run | exit | passed | failed | flaky | skipped | wall | log |',
    '| :-- | --: | --: | --: | --: | --: | --: | :-- |',
  ];
  for (const r of runs) {
    const c = r.counts;
    lines.push(
      `| ${r.name} | ${r.exit}${r.timedOut ? ' **timeout**' : ''} | ${c?.expected ?? '?'} | ${c?.unexpected ?? '?'} | ` +
        `${c?.flaky ?? '?'} | ${c?.skipped ?? '?'} | ${Math.round(r.ms / 1000)}s | logs/${r.name}.log |`,
    );
  }
  const allFailures = runs.flatMap((r) => r.failures.map((f) => ({ run: r.name, ...f })));
  if (allFailures.length) {
    lines.push('', `## Failures (${allFailures.length})`, '');
    for (const f of allFailures) {
      lines.push(`### ${f.run} › ${f.title}`, '', `_${f.status}${f.ms != null ? `, ${f.ms} ms` : ''}_`, '', '```', f.error, '```', '');
    }
  } else if (runs.every((r) => r.counts)) {
    lines.push('', 'No failures recorded.', '');
  }
  lines.push(
    '',
    '## What to send back',
    '',
    'The whole `.tar.gz` -- it is this directory. If it is too large, `logs/` alone',
    'answers almost everything; `reports/*.json` is what the table above was built',
    'from, and `test-results-<run>/` holds each run\'s own failure contexts. The',
    '`manifest.sha256` pins every file (`sha256sum -c manifest.sha256`).',
    '',
  );
  writeFileSync(join(runDir, 'SUMMARY.md'), lines.join('\n'));

  const { tarCode } = await finalise(runDir, label, stamp, outRoot);

  const failed = runs.some((r) => r.exit !== 0 || r.timedOut);
  if (selfTest) {
    const required = ['SUMMARY.md', 'environment.json', 'manifest.sha256'];
    const missing = required.filter((f) => !existsSync(join(runDir, f)));
    const hasLog = existsSync(join(runDir, 'logs', `${engines[0]}-${slice}.log`));
    const hasReport = existsSync(join(runDir, 'reports', `${engines[0]}-${slice}.json`));
    const summary = existsSync(join(runDir, 'SUMMARY.md')) ? readFileSync(join(runDir, 'SUMMARY.md'), 'utf8') : '';
    const problems = [
      ...missing.map((f) => `missing ${f}`),
      ...(hasLog ? [] : ['missing log']),
      ...(hasReport ? [] : ['missing JSON report']),
      ...(tarCode === 0 ? [] : ['tar failed']),
      ...(summary.includes('Slow lane') || summary.includes('slow lane') ? [] : ['summary not written from a real run']),
      ...(runs.every((r) => r.counts) ? [] : ['no counts parsed from the report']),
    ];
    if (problems.length || failed) {
      console.error(`[slow-lane] SELF-TEST FAILED: ${problems.join('; ') || 'a run exited non-zero'}`);
      process.exit(1);
    }
    console.log('[slow-lane] SELF-TEST PASS -- log, report, summary, environment, manifest and archive all present');
  }
  process.exit(failed ? 1 : 0);
}

// ------------------------------------------------------------------ steps mode

/** Lines of a step log worth putting in the summary (deduped, capped). */
const KEY_LINE =
  /(\bpassed\b|\bfailed\b|\bskipped\b|\bPASS\b|\bFAIL\b|baseline OK|unchanged · ABI|dist total|budget|interactive best|\bfps\b|\brms\b|✗|Error:)/;

function keyLines(file) {
  if (!existsSync(file)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = noAnsi(raw).trimEnd();
    if (!line || line.startsWith('npm notice') || line.startsWith('npm warn')) continue;
    if (!KEY_LINE.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= 40) break;
  }
  return out;
}

/** sha256 of every file under `dist/`, so the pack pins the bundle that was tested. */
function writeDistManifest(runDir) {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return null;
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dist);
  writeFileSync(
    join(runDir, 'dist-manifest.sha256'),
    `${files
      .map((f) => `${sha256(f)}  ${relative(dist, f)}`)
      .sort()
      .join('\n')}\n`,
  );
  return { files: files.length };
}

async function mainSteps() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = join(outRoot, `${label}-${stamp}`);
  mkdirSync(join(runDir, 'logs'), { recursive: true });
  mkdirSync(join(runDir, 'reports'), { recursive: true });

  const gitHead =
    spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || null;
  const porcelain =
    spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? '';
  const diffstat = spawnSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? '';

  const plan = stepPlan();
  // The browser steps serve **`dist/`**, so a gate run has to rebuild unless it is
  // told not to: a step that builds on its own (`verify`) can abort before it gets
  // there -- an `npm run verify` that dies at clippy in 0 s left the previous
  // round testing a bundle from an hour earlier, and the only visible symptom was
  // a Firefox export error that the tree had already fixed.
  if (!skipBuild && plan.some((p) => p.browser)) {
    plan.unshift({ label: 'npm run build', name: 'build', cmd: 'npm', args: ['run', 'build'], browser: false });
  }
  if (plan.some((p) => p.browser)) {
    const srcTime = (() => {
      let newest = 0;
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) newest = Math.max(newest, statSync(full).mtimeMs);
        }
      };
      walk(join(root, 'src'));
      return newest;
    })();
    const distTime = existsSync(join(root, 'dist', 'index.html')) ? statSync(join(root, 'dist', 'index.html')).mtimeMs : 0;
    if (distTime && srcTime > distTime) {
      console.log('[slow-lane] WARNING: dist/ is older than src/ -- what the browser steps will serve may not be the tree under test.');
    }
  }
  console.log(`[slow-lane] steps: ${plan.map((p) => p.label).join(' -> ')} · ${timeoutMin} min/step · output ${runDir}`);
  if (porcelain) console.log('[slow-lane] WARNING: the tree has uncommitted changes; the summary records them.');
  if (dryRun) {
    for (const [i, step] of plan.entries()) {
      console.log(`[slow-lane] would run: ${step.label}${step.browser ? ` (port ${basePort + i})` : ''}`);
    }
    return;
  }

  const runs = [];
  let port = basePort;
  for (const step of plan) {
    const { name, label, browser } = step;
    const logFile = join(runDir, 'logs', `${name}.log`);
    const jsonFile = browser ? join(runDir, 'reports', `${name}.json`) : null;
    console.log(`\n[slow-lane] ================= ${label} =================`);
    const result = await run(step.cmd, step.args, {
      sink: logFile,
      env: browser ? { GS1_E2E_PORT: String(port), PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile } : {},
      timeoutMs: timeoutMin * 60_000,
    });
    if (browser) port += 1;
    const contextFiles = browser ? copyTree(join(root, 'test-results'), join(runDir, `test-results-${name}`)) : 0;
    const report = jsonFile ? readReport(jsonFile) : null;
    runs.push({
      step,
      label,
      name,
      exit: result.code,
      timedOut: result.timedOut,
      ms: result.ms,
      contextFiles,
      counts: report?.counts ?? null,
      failures: report?.failures ?? [],
      keys: keyLines(logFile),
      logFile,
    });
    console.log(
      `[slow-lane] ${label}: exit ${result.code}${result.timedOut ? ' (TIMEOUT)' : ''} in ${Math.round(result.ms / 1000)}s` +
        (report
          ? ` · ${report.counts.expected} passed, ${report.counts.unexpected} failed, ${report.counts.flaky} flaky, ${report.counts.skipped} skipped`
          : ''),
    );
  }

  const playwrightPkg = readJson(join(root, 'node_modules', 'playwright-core', 'package.json'));
  const pkg = readJson(join(root, 'package.json')) ?? {};
  const distIndex = existsSync(join(root, 'dist', 'index.html'))
    ? readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    : null;
  const dist = writeDistManifest(runDir);
  const environment = {
    generatedAt: new Date().toISOString(),
    label,
    mode: 'steps',
    steps: plan.map((p) => p.label),
    host: {
      platform: process.platform,
      arch: process.arch,
      osRelease: (await import('node:os')).release(),
      cpus: cpus().length,
      cpusModel: cpus()[0]?.model ?? null,
      totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    },
    node: process.version,
    playwright: playwrightPkg?.version ?? 'unknown',
    packageVersion: pkg?.version ?? 'unknown',
    gitHead,
    gitDirty: porcelain ? porcelain.split('\n') : [],
    gitDiffStat: diffstat || null,
    dist: distIndex
      ? {
          entryJs: distIndex.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null,
          files: dist?.files ?? null,
          indexHtmlSha256: createHash('sha256').update(distIndex).digest('hex'),
        }
      : null,
    runs: runs.map((r) => ({ step: r.label, exit: r.exit, timedOut: r.timedOut, ms: r.ms, counts: r.counts })),
  };
  writeFileSync(join(runDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);

  const lines = [
    `# gate pack · ${label}`,
    '',
    `- host: ${process.platform} ${process.arch} · ${environment.host.cpusModel ?? '?'} × ${environment.host.cpus} · ${environment.host.totalMemGb} GB`,
    `- node ${process.version} · playwright ${environment.playwright} · package ${environment.packageVersion}`,
    `- tree: ${gitHead ?? '(no git)'}${porcelain ? ` · **dirty** (${porcelain.split('\n').length} path(s))` : ' · clean'}`,
    `- dist: ${environment.dist?.entryJs ?? '(no dist)'} · ${environment.dist?.files ?? 0} file(s)`,
    `- steps: ${plan.map((p) => p.label).join(' → ')} · ${timeoutMin} min/step · generated ${environment.generatedAt}`,
    '',
    '| step | exit | wall | log |',
    '| :-- | --: | --: | :-- |',
    ...runs.map(
      (r) => `| ${r.label} | ${r.exit}${r.timedOut ? ' **timeout**' : ''} | ${Math.round(r.ms / 1000)}s | logs/${r.name}.log |`,
    ),
    '',
    '> 计时类门禁（bench / perf / boot 预算）只在**这台机器**上有意义；',
    '> 确定性门禁（rust / vitest / presets / dsp / dist / budget / 协议与文档门禁）与在哪台机器跑无关。',
  ];
  if (porcelain) lines.push('', '## The tree was dirty', '', '```', diffstat || porcelain, '```');
  for (const r of runs) {
    lines.push('', `## ${r.label} · exit ${r.exit}`, '');
    if (r.counts) {
      lines.push(
        `Playwright: ${r.counts.expected} passed, ${r.counts.unexpected} failed, ${r.counts.flaky} flaky, ${r.counts.skipped} skipped.`,
      );
    }
    if (r.keys.length) lines.push('', '```', ...r.keys, '```');
    for (const f of r.failures) lines.push('', `### ${f.title}`, '', '```', f.error, '```');
  }
  lines.push(
    '',
    '## What to send back',
    '',
    'The whole `.tar.gz` — it is this directory. `logs/` has every step verbatim,',
    '`environment.json` says which tree and which machine produced it, and',
    '`dist-manifest.sha256` pins the bundle that was tested.',
    '',
  );
  writeFileSync(join(runDir, 'SUMMARY.md'), lines.join('\n'));

  const { tarCode } = await finalise(runDir, label, stamp, outRoot);
  const failed = runs.some((r) => r.exit !== 0 || r.timedOut);
  if (selfTestSteps) {
    const required = ['SUMMARY.md', 'environment.json', 'manifest.sha256'];
    const missing = required.filter((f) => !existsSync(join(runDir, f)));
    const problems = [
      ...missing.map((f) => `missing ${f}`),
      ...(tarCode === 0 ? [] : ['tar failed']),
      ...(runs.some((r) => r.keys.length > 0) ? [] : ['no key lines extracted from any step log']),
      ...(existsSync(join(runDir, 'logs', `${plan[0].name}.log`)) ? [] : ['missing step log']),
    ];
    if (problems.length || failed) {
      console.error(`[slow-lane] SELF-TEST(steps) FAILED: ${problems.join('; ') || 'a step exited non-zero'}`);
      process.exit(1);
    }
    console.log('[slow-lane] SELF-TEST(steps) PASS -- step log, key lines, summary, environment, manifest and archive');
  }
  process.exit(failed ? 1 : 0);
}

const entry = stepsMode || selfTestSteps ? mainSteps : main;
entry().catch((error) => {
  console.error(`[slow-lane] ${error?.stack ?? error}`);
  process.exit(1);
});
