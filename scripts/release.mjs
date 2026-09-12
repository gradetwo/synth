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
 *   --quiet        only print step headers and the final verdict
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = process.env.GS1_SITE ?? 'https://synth.wangda.today';
const args = process.argv.slice(2);

const flag = (name) => args.includes(`--${name}`);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = {
  check: flag('check'),
  dryRun: flag('dry-run'),
  skipVerify: flag('skip-verify'),
  skipE2E: flag('skip-e2e'),
  skipDeploy: flag('skip-deploy'),
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

function run(cmd, cmdArgs, { capture = false, env = {}, mutates = false } = {}) {
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
  if (result.error) fail(`${cmd} could not run — ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} exited ${result.status}`);
  return capture ? (result.stdout ?? '') : '';
}

const git = (cmdArgs, opts) => run('git', cmdArgs, { capture: true, ...opts }).trim();

/** Cloudflare token: the environment first, then the shell profile, like the docs do. */
function cloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const profile of ['.zshrc', '.bashrc', '.profile']) {
    let text;
    try {
      text = readFileSync(resolve(homedir(), profile), 'utf8');
    } catch {
      continue;
    }
    const match = text.match(/^\s*export\s+CLOUDFLARE_API_TOKEN=(.*)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

/** Numeric compare for x.y.z, so pre-release strings never sort as newer. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const indexHash = (html) => html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? '';

async function liveIndexHash() {
  const url = `${site}/?cb=${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) fail(`live check: ${url} returned ${res.status}`);
  return indexHash(await res.text());
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

  if (!flags.check) {
    const dirty = git(['status', '--porcelain'])
      .split('\n')
      .filter((line) => line.trim() && !/^\?\? (release|dist|\.tmp|test-results|playwright-report)\//.test(line));
    check('no uncommitted changes', dirty.length === 0, dirty.slice(0, 3).join(' | '));
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    check('on a branch (not detached)', branch !== 'HEAD', branch);
  }

  const bad = checks.filter((c) => !c.ok);
  if (bad.length) fail(`preflight: ${bad.map((c) => c.name).join(', ')}`);
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
    step('Chromium end-to-end suite');
    run('npm', ['run', 'test:e2e', '--', '--project=chromium']);
  }

  step('package release artefacts');
  run('npm', ['run', 'package']);

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
