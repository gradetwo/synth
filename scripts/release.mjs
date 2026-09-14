#!/usr/bin/env node
/**
 * One-command release.
 *
 *   npm run release -- 1.80.0             full run
 *   npm run release -- 1.80.0 --dry-run   everything except deploy and tag
 *   npm run release -- --check            preflight only (also run by `npm run verify`)
 *
 * The order is deliberate: the version and changelog are checked *before* the
 * slow gates so a typo costs seconds, and the git tree is checked before the
 * tag so a release can never point at a commit with uncommitted code.
 *
 * Steps: preflight → verify → Chromium E2E → package → deploy → live asset
 * check → annotated tag. Any failing step stops the run; nothing is rolled
 * back automatically, because a half-deployed release is easier to fix by
 * re-running than by guessing what to undo.
 *
 * Flags:
 *   --check        preflight only (no git cleanliness check, safe mid-batch)
 *   --dry-run      run real gates, print deploy/tag commands instead of running
 *   --skip-verify  skip `npm run verify` (assumes it just passed)
 *   --skip-e2e     skip the Chromium suite
 *   --skip-deploy  do not deploy, but still package and tag
 *   --skip-git-check  do not require a clean tree (for a gate drill, never a ship)
 *   --quiet        only print step headers and the final verdict
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  defaultStore,
  formatStore,
  indexHashOf,
  keepVersionsFromEnv,
  planPrune,
  readManifest,
  readStoreSchema,
  recordVersion,
  retainVersion,
  sortVersions,
  swCacheOf,
} from './lib/retained.mjs';
import { cloudflareToken, resolveSite } from './lib/release-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolveSite();
const args = process.argv.slice(2);

/**
 * First-interactive budget for the release gate (P11.5).
 *
 * Same number and the same override as `e2e/performance.spec.ts`'s
 * `BOOT_BUDGET_MS`: 3 200 ms is "the slowest full parallel suite run seen on
 * this machine (2 450 ms) plus ~30 %", and the spec is the thing that actually
 * measures it. This step exists so the budget is a *named, overridable release
 * gate* rather than a side effect of the E2E suite: it re-checks the number the
 * spec printed, so a run with `--skip-e2e` still cannot ship a boot regression,
 * and a CI box with its own baseline can pin it with `GS1_BOOT_BUDGET_MS`.
 */
const BOOT_BUDGET_MS = Number(process.env.GS1_BOOT_BUDGET_MS ?? 3200);

const flag = (name) => args.includes(`--${name}`);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = {
  check: flag('check'),
  dryRun: flag('dry-run'),
  skipVerify: flag('skip-verify'),
  skipE2E: flag('skip-e2e'),
  skipDeploy: flag('skip-deploy'),
  skipGitCheck: flag('skip-git-check'),
  quiet: flag('quiet'),
};

const log = (...parts) => {
  if (!flags.quiet) console.log(...parts);
};
const step = (name) => console.log(`\n[release] ▸ ${name}`);

let failed = null;
const fail = (message) => {
  failed = message;
  throw new Error(message);
};

// --------------------------------------------------------------- helpers

function run(cmd, cmdArgs, { capture = false, env = {}, mutates = false, echo = false } = {}) {
  if (mutates && flags.dryRun) {
    log(`[release]   $ ${cmd} ${cmdArgs.join(' ')}  (dry run: skipped)`);
    return '';
  }
  log(`[release]   $ ${cmd} ${cmdArgs.join(' ')}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (echo && capture && result.stdout) process.stdout.write(result.stdout);
  if (result.error) fail(`${cmd} could not run — ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} exited ${result.status}`);
  return capture ? (result.stdout ?? '') : '';
}

const git = (cmdArgs, opts) => run('git', cmdArgs, { capture: true, ...opts }).trim();

/**
 * The shell fingerprint, the version compare and the token reader now live in
 * `scripts/lib/` because `rollback.mjs` has to answer the same questions about
 * the same bytes; keeping two copies is how the two answers drift apart.
 */
const indexHash = indexHashOf;

async function liveIndexHash() {
  const url = `${site}/?cb=${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) fail(`live check: ${url} returned ${res.status}`);
  return indexHash(await res.text());
}

/**
 * First-interactive gate (P11.5).
 *
 * The measurement itself lives in `e2e/performance.spec.ts` and the spec already
 * asserts the budget, so the point of this code is *not* to measure again: it
 * is to make the budget a named release step with an overridable threshold, and
 * to re-check the number the spec printed. The spec emits one machine-readable
 * line — `[boot-budget] interactive N ms of [...] · FCP ... · budget M ms` —
 * which is parsed here.
 *
 * Normal path: the browser run is two invocations of the same config -- the app
 * suite (`npm run test:e2e`, the `chromium` project) and then the performance
 * suite on its own (`npm run test:perf`, the `perf` project, `--workers=1`).
 * The frame-rate guards live in the second one because measuring them while the
 * first suite boots workers on every core measures the host, not the app: the
 * same build read 13.8-20.0 fps in the parallel run against 60.0 alone, and
 * that blocked the v1.111.0 release. Both captured outputs are scanned, so a
 * `[boot-budget]` line from either invocation still fails the release if it is
 * over budget. `--skip-e2e` is the exception: then neither suite runs, so this
 * runs the one spec file (perf project, single worker) to keep the gate honest.
 */
const BOOT_LINE = /\[boot-budget\] interactive (\d+) ms .*? budget (\d+) ms/;
/**
 * The three frame-rate guards in `e2e/performance.spec.ts`. They are echoed in
 * the release log together with their window detail, because "best of five"
 * alone hides whether the windows agree -- the whole point of running them
 * isolated is that they do.
 */
const FPS_LINE = /\[fps\] ([\w-]+) best ([\d.]+) of \[([^\]]*)\] fps/g;

/** Scan a captured run for the boot line and check it. */
function checkBootFrom(output, what) {
  const match = output.match(BOOT_LINE);
  if (!match) fail(`boot budget: ${what} printed no [boot-budget] line`);
  const interactive = Number(match[1]);
  if (interactive > BOOT_BUDGET_MS) {
    fail(`boot budget: interactive ${interactive} ms > ${BOOT_BUDGET_MS} ms`);
  }
  log(`[release]   ✓ first interactive ${interactive} ms ≤ ${BOOT_BUDGET_MS} ms (${what})`);
}

/**
 * Echo the `[fps]` lines of the isolated performance run.
 *
 * The threshold itself is asserted by the spec (and the release stops on a
 * non-zero exit before this ever runs), so this does not re-check it; it puts
 * the best *and* the five windows into the release log so the next release
 * report carries the dispersion, not just the lucky window.
 */
function reportFpsFrom(output, what) {
  const lines = [...output.matchAll(FPS_LINE)];
  if (!lines.length) fail(`fps guards: ${what} printed no [fps] line`);
  for (const line of lines) {
    log(`[release]   · ${line[1]} best ${line[2]} fps of [${line[3]}] (${what})`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- preflight

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = (positional[0] ?? pkg.version).replace(/^v/, '');
// The newest entry lives in its own module (the update banner is on the first
// screen and must not pull the whole history into the initial bundle), so the
// checks read both files as one text.
const changelogText = ['src/changelog-head.ts', 'src/changelog.ts']
  .map((file) => readFileSync(resolve(root, file), 'utf8'))
  .join('\n');
/** Local calendar date — the changelog dates are local, not UTC. */
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = localDate();

function preflight() {
  step(`preflight (v${version})`);
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    log(`[release]   ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  check('version looks like x.y.z', /^\d+\.\d+\.\d+$/.test(version), version);
  check('package.json carries that version', pkg.version === version, `package.json ${pkg.version}`);

  const head = changelogText.match(/\{\s*version: '([^']+)',\s*date: '([^']+)',\s*kind: '([^']+)',\s*items: \[([\s\S]*?)\n  \},/);
  check('the newest changelog entry is for this version', head?.[1] === version, head?.[1] ?? 'not found');
  const date = head?.[2] ?? '';
  if (flags.check) {
    // `--check` also runs in CI, where "today" is whenever the runner picked the
    // commit up; a real date that is not in the future is the honest gate there.
    check(
      'its date is a real date and not in the future',
      /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today,
      `entry ${date || '?'}, today ${today}`,
    );
  } else {
    check('its date is today', date === today, `entry ${date || '?'}, today ${today}`);
  }
  check('it is kind sound/feature/fix', ['sound', 'feature', 'fix'].includes(head?.[3] ?? ''), head?.[3] ?? '?');
  if (head) {
    const items = head[4].match(/\[\s*'[\s\S]*?',\s*'[\s\S]*?',\s*\]/g) ?? [];
    check('it has at least one item', items.length > 0, `${items.length} item(s)`);
    check(
      'every item carries Chinese and English',
      items.every((item) => {
        const [zh, en] = item.split(/',\s*\n?\s*'/);
        return /[\u4e00-\u9fff]/.test(zh ?? '') && /[A-Za-z]{3}/.test(en ?? '');
      }),
    );
  }

  const versions = [...changelogText.matchAll(/^    version: '([^']+)'/gm)].map((m) => m[1]);
  const sorted = [...versions].sort(compareVersions).reverse();
  check('changelog versions are unique and newest-first', versions.join() === sorted.join(), `${versions.length} releases`);

  if (!flags.check && !flags.skipGitCheck) {
    const dirty = git(['status', '--porcelain'])
      .split('\n')
      .filter((line) => line.trim() && !/^\?\? (release|dist|\.tmp|test-results|playwright-report)\//.test(line));
    check('no uncommitted changes', dirty.length === 0, dirty.slice(0, 3).join(' | '));
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    check('on a branch (not detached)', branch !== 'HEAD', branch);
  } else if (flags.skipGitCheck) {
    log('[release]   (git cleanliness check skipped by --skip-git-check)');
  }

  const bad = checks.filter((c) => !c.ok);
  if (bad.length) fail(`preflight: ${bad.map((c) => c.name).join(', ')}`);
}

// ------------------------------------------------------- retained versions

/**
 * Copy this release into `release/retained/` and prune the window (P12.4).
 *
 * Called only after the live check proved that production is serving these
 * bytes. `recordVersion` is the one place that deletes anything, and it never
 * deletes the version it is recording or the current one.
 */
function retainRelease(distHash) {
  const store = defaultStore(root);
  const keep = keepVersionsFromEnv();
  const tarPath = resolve(root, 'release', `gs1-synth-${version}.tar.gz`);
  const before = readManifest(store, { keep });
  const entry = retainVersion({
    store,
    version,
    distDir: resolve(root, 'dist'),
    tarPath,
    storeSchema: readStoreSchema(root),
  });
  if (entry.indexHash !== distHash) fail(`retain: pinned ${entry.indexHash} but deployed ${distHash}`);
  const { manifest, pruned } = recordVersion({
    store,
    entry,
    action: 'release',
    from: before.current?.version ?? null,
    keep,
    log: (m) => log(`[release]   ${m}`),
  });
  log(
    `[release]   v${entry.version} retained (shell ${entry.indexHash}, sw ${entry.swCache}, ${(
      entry.siteBytes / 1024
    ).toFixed(0)} KB, snapshot ${entry.tar})`,
  );
  log(
    `[release]   store keeps ${manifest.versions.length}/${keep}: ${sortVersions(manifest.versions)
      .map((e) => `v${e.version}`)
      .join(', ')}`,
  );
  if (pruned.length) log(`[release]   dropped ${pruned.map((e) => `v${e.version}`).join(', ')} — no longer rollback-able`);
}

/** The same decision, printed instead of taken (`--dry-run`). */
function planRetention(distHash) {
  const store = defaultStore(root);
  const keep = keepVersionsFromEnv();
  const manifest = readManifest(store, { keep });
  log(formatStore(manifest).replace(/^/gm, '[release] '));
  const swCache = swCacheOf(readFileSync(resolve(root, 'dist/sw.js'), 'utf8'));
  const candidate = { version, indexHash: distHash, swCache, storeSchema: readStoreSchema(root), retainedAt: new Date().toISOString() };
  const { kept, pruned } = planPrune(
    [...manifest.versions.filter((e) => e.version !== version), candidate],
    keep,
    { current: candidate },
  );
  log(`[release]   would retain v${version} (shell ${distHash}, sw ${swCache})`);
  log(
    `[release]   would keep ${kept.length}/${keep}: ${sortVersions(kept)
      .map((e) => `v${e.version}`)
      .join(', ')}`,
  );
  log(pruned.length ? `[release]   would drop ${pruned.map((e) => `v${e.version}`).join(', ')}` : '[release]   would drop nothing');
}

// ------------------------------------------------------------------ main

async function main() {
  preflight();
  if (flags.check) {
    console.log('\n[release] PASS (preflight only)');
    return;
  }

  if (!flags.skipVerify) {
    step('verify (clippy, rust, unit, lint, build, wasm, dist, budget, audio, bench, dsp)');
    run('npm', ['run', 'verify']);
  }

  if (!flags.skipE2E) {
    // Stage 1: the app suite. `npm run test:e2e` is exactly what CI runs
    // (`playwright test --project=chromium`); the performance spec is not in it
    // any more (the chromium project ignores that file).
    step('Chromium end-to-end suite (app)');
    const appOutput = run('npm', ['run', 'test:e2e'], {
      capture: true,
      echo: true,
      env: { GS1_BOOT_BUDGET_MS: String(BOOT_BUDGET_MS) },
    });

    // Stage 2: the performance suite, alone on the machine, one worker. This is
    // where `[boot-budget]` and the three `[fps]` lines come from.
    step(`performance suite (isolated, --workers=1; first-interactive budget ${BOOT_BUDGET_MS} ms)`);
    const perfOutput = run('npm', ['run', 'test:perf'], {
      capture: true,
      echo: true,
      env: { GS1_BOOT_BUDGET_MS: String(BOOT_BUDGET_MS) },
    });

    // Both captured outputs are scanned for the boot line: the performance run
    // is the one that prints it today, but reading the app suite too means a
    // config drift shows up as a report rather than as a silently skipped gate.
    const bootFrom = [perfOutput, appOutput].find((output) => BOOT_LINE.test(output));
    if (!bootFrom) {
      fail('boot budget: neither the app suite nor the performance suite printed a [boot-budget] line');
    }
    checkBootFrom(
      bootFrom,
      bootFrom === perfOutput ? 'from the isolated performance suite' : 'from the app suite run',
    );
    reportFpsFrom(perfOutput, 'from the isolated performance suite');
  } else {
    // `--skip-e2e` skips both browser suites, so the boot gate has to stand on
    // its own or it would silently disappear from exactly the release that opted
    // out of the suite. One spec file, not the suite, and run the way
    // `test:perf` runs it (perf project, single worker) so the number it prints
    // is comparable to the one the normal path parses.
    step(`first-interactive budget only (${BOOT_BUDGET_MS} ms; --skip-e2e)`);
    const output = run(
      'npx',
      ['playwright', 'test', 'e2e/performance.spec.ts', '--project=perf', '--workers=1', '--reporter=list'],
      { capture: true, echo: true, env: { GS1_BOOT_BUDGET_MS: String(BOOT_BUDGET_MS) } },
    );
    checkBootFrom(output, 'from e2e/performance.spec.ts');
  }

  step('package release artefacts');
  run('npm', ['run', 'package']);

  // The gates the *payload we just built* can break, and the reason a fast
  // release is still a checked release.
  //
  // v2.1.0 shipped 0.6 KB over the dist budget exactly by skipping these:
  // `release:fast` is preflight → package → deploy, so `--skip-verify` took the
  // cheap, deterministic, browser-free size and wiring gates down with the slow
  // chain it was meant to skip. The tag was red — `verify:budget` is required by
  // `npm run verify`, by `ci.yml` and by `verify-ci.mjs` — and nothing in the
  // release path could notice (§一.39).
  //
  // They are run unconditionally rather than only under `--skip-verify`: they
  // measure the artefact, not the source tree, so they belong after `package`
  // either way, and a second few seconds is cheaper than a release that has to
  // be rolled back over a number the build itself printed.
  step('payload gates (they measure what was just built)');
  for (const gate of ['verify:ci', 'verify:dist', 'verify:budget']) run('npm', ['run', gate]);

  const distHash = indexHash(readFileSync(resolve(root, 'dist/index.html'), 'utf8'));
  if (!distHash) fail('package: no assets/index-*.js hash in dist/index.html');
  log(`[release]   built index hash ${distHash}`);

  if (flags.dryRun) {
    step('deploy to Cloudflare');
    log('[release]   (dry run: skipping deploy, live check and tag)');
  } else if (!flags.skipDeploy) {
    step('deploy to Cloudflare');
    const token = cloudflareToken();
    if (!token) fail('deploy: CLOUDFLARE_API_TOKEN is neither exported nor in a shell profile');
    run('npx', ['wrangler', 'deploy'], { env: { CLOUDFLARE_API_TOKEN: token }, mutates: true });

    step('check the live assets');
    let match = false;
    for (let attempt = 1; attempt <= 6 && !match; attempt += 1) {
      await sleep(attempt === 1 ? 3000 : 5000);
      const live = await liveIndexHash();
      match = live === distHash;
      log(`[release]   attempt ${attempt}: live ${live || '(none)'} ${match ? '== ' : '!='} built ${distHash}`);
      if (!match && attempt === 3) {
        log('[release]   edge still serving the old manifest — deploying once more');
        run('npx', ['wrangler', 'deploy'], { env: { CLOUDFLARE_API_TOKEN: token }, mutates: true });
      }
    }
    if (!match) fail(`live check: ${site} never served assets/index-${distHash}.js`);
  }

  // Retention is its own decision, after the deploy branch above: a version is
  // worth keeping only once production serves it, and a dry run may only print
  // what it would keep.
  if (flags.dryRun) {
    step('retain the release artefacts (dry run)');
    planRetention(distHash);
  } else if (!flags.skipDeploy) {
    // Only now — deployed, live and hash-verified — is the release worth
    // keeping, and only now may the oldest release be dropped. A failed release
    // must not prune the window it never joined.
    step('retain the release artefacts');
    retainRelease(distHash);
  } else {
    log('[release]   (--skip-deploy: nothing was deployed, so nothing is retained)');
  }

  if (!flags.dryRun) {
    step(`tag v${version}`);
    const tag = `v${version}`;
    const existing = git(['tag', '-l', tag]);
    if (existing) {
      log(`[release]   ${tag} already exists — leaving it alone`);
    } else {
      run('git', ['tag', '-a', tag, '-m', `GROOVE SYNTH GS-1 ${tag}`], { mutates: true });
    }
  }

  console.log(`\n[release] PASS — v${version}${flags.dryRun ? ' (dry run: not deployed, not tagged)' : ''}`);
}

try {
  await main();
} catch (error) {
  if (!failed) failed = error.message;
  console.error(`\n[release] FAIL — ${failed}`);
  process.exit(1);
}
