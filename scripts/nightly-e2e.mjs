#!/usr/bin/env node
/**
 * Nightly browser run (C1).
 *
 * The engines that are not on every commit — WebKit and Firefox — get a run of
 * their own here, either from a timer on a machine that stays on or from the
 * scheduled CI job. Waiting for a push means a WebKit-only regression can sit
 * unnoticed for days; that is exactly what happened to the start button.
 *
 *   npm run nightly                        # the nightly subset (see below), WebKit
 *   npm run nightly -- --engines=webkit,firefox
 *   npm run nightly -- --core              # only the core subset (quick local look)
 *   npm run nightly -- --all               # the whole suite (slow on a workstation)
 *   npm run nightly -- --subset=nightly    # core + visual + audio (the default)
 *   npm run nightly -- --display=xvfb      # force the older Xvfb path
 *   npm run nightly -- --display=desktop   # your own session (needs DISPLAY/WAYLAND_DISPLAY)
 *   npm run nightly -- --update            # also append rows to docs/notes/nightly.md
 *   npm run nightly -- --dry-run           # print engine/display/subset and the command, launch nothing
 *
 * Each engine's log is written while its suite runs, never after it exits:
 * `.tmp/nightly/<date>-<engine>.log` grows in place (same path and name as
 * before), `[nightly] <engine>: starting …` / `… finished — …` lines bracket
 * it, and a killed run leaves the part it had already produced. `tail -f` on
 * that file — or the terminal, where whole child lines are mirrored when it is
 * a TTY — answers "where is it now, and how long has it been there".
 *
 * Three subsets, because "cover more" and "finish locally" are different jobs:
 *
 *   core     the phone/tablet-first set: iPhone/iPad viewports, touch, text fit,
 *            boot, the routing graph, sharing, the drawer, the theme.
 *   visual   `e2e/visual.spec.ts`. On WebKit and Firefox the nightly renders
 *            every surface but compares **no** baseline: the baselines are
 *            `*-chromium-linux.png`, and Playwright looks for
 *            `*-webkit-linux.png` / `*-firefox-linux.png` (its path template is
 *            `{arg}{-projectName}{-snapshotSuffix}`, `snapshotSuffix` = platform).
 *            A missing baseline is not skipped: with the default
 *            `updateSnapshots: "missing"` it is *written* and the test is
 *            reported failed, in CI (`"none"`) it just fails. Relaxing the
 *            visual thresholds to make that green is the one thing the plan
 *            forbids; the smoke runs the same flow without the comparison.
 *   audio    the specs whose subject is the sound path in a browser: does the
 *            engine boot (AudioWorklet + autoplay), are the controls that change
 *            what you hear reachable, does the patch carry them.
 *
 * The default is `nightly` = core + visual + audio for whichever engines are
 * named; the timer and CI name WebKit and Firefox. `--all` replaces the file
 * list with everything, which is what CI's WebKit step runs. Chromium is not
 * the nightly's job (it gates every commit), but `--engines=chromium` works and
 * then the visual spec compares against its real baselines.
 *
 * Headed on a compositor is still the default, but the reason is narrower than
 * this comment used to claim. Headless WebKitGTK on Linux *does* fire
 * requestAnimationFrame -- a blank page reaches ~55 fps here -- it just cannot
 * rasterise this app cheaply, so the app page produces ~0 frames/s and
 * Playwright's frame-based actionability waits crawl (every `locator.click()`
 * took 8-30 s; the measurements are in docs/notes/compat.md §3). The test-side
 * fixture `e2e/fixtures.ts` replaces those frame-gated interactions for WebKit,
 * and the non-pixel subsets now run headless in minutes (core subset: 35 passed
 * / 3 failed in 23 min). What still needs a compositor is anything that reads
 * pixels: `locator.screenshot()` never returns without frames, so the visual
 * subset must stay on Weston. Weston's headless backend is the standard local
 * path — measured 1.8 fps against Xvfb's 0.7 on this machine, and it uses the
 * GPU when `/dev/dri` is there (see docs/notes/compat.md). Xvfb stays as a
 * fallback, and a real desktop session is fastest of all.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import {
  NOTES_PATH,
  appendRuns,
  formatRow,
  renderTrend,
} from './nightly-report.mjs';
import { SUBSETS, subsetFor } from './lib/e2e-subsets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, '.tmp', 'nightly');
const lockPath = join(logDir, 'nightly.lock');
const KEEP_LOGS = 14;
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const die = (message) => {
  console.error(`[nightly] ${message}`);
  process.exit(2);
};

const engines = value('engines', 'webkit')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The phone/tablet-first set the plan asks for. Running WebKit over the whole
 * suite on a workstation is not practical — it is several times slower than
 * Chromium and the browser gets unstable deep into a long run (see
 * docs/notes/compat.md) — so the nightly covers three bounded slices and the
 * whole suite stays CI's job. The lists live in `scripts/lib/e2e-subsets.mjs`
 * (shared with the slow-lane packer) and the docs point there.
 */
const subsetName = value('subset') ?? (flag('all') ? 'all' : flag('core') ? 'core' : 'nightly');
const subset = subsetFor(subsetName);
if (subset === null) {
  die(`unknown --subset=${subsetName} (expected ${Object.keys(SUBSETS).join(', ')})`);
}
const update = flag('update');
/**
 * Where the browsers live.
 *
 * Pinning `PLAYWRIGHT_BROWSERS_PATH` to `.pw-browsers` inside the worktree is
 * right when that directory exists (it is what an isolated checkout sets up),
 * but the checkout usually has none: Playwright's own default is
 * `~/.cache/ms-playwright`, and pointing the variable at a directory that does
 * not exist turns "the browser is not here" into *141 test failures* — which
 * reads exactly like a product regression and cost the second sweep a full
 * Firefox pass (§一.35②, still live when the third sweep ran it).
 *
 * So: an explicit variable wins, the worktree copy wins only if it is there,
 * and otherwise the variable is left unset for Playwright to resolve. Whatever
 * it resolves to, a browser that is not installed is now a named error before
 * anything is launched, not a wall of red.
 */
const localBrowsers = join(root, '.pw-browsers');
const pinnedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH || (existsSync(localBrowsers) ? localBrowsers : null);
const env = { ...process.env };
if (pinnedBrowsers) env.PLAYWRIGHT_BROWSERS_PATH = pinnedBrowsers;

mkdirSync(logDir, { recursive: true });

const which = (name) => spawnSync('which', [name], { encoding: 'utf8' }).status === 0;
const hasWeston = which('weston');
const hasXvfb = which('xvfb-run');
/**
 * How a browser is given a display, and the word the record uses for it:
 * `weston`, `xvfb`, `desktop` or `headless`. `auto` is Weston → Xvfb → headless;
 * an explicitly requested path that is not available is an error rather than a
 * silent fallback, because the record would then name a path that was not used.
 */
const aliases = { wayland: 'weston', none: 'headless' };
const rawDisplay = value('display', 'auto');
const display = aliases[rawDisplay] ?? rawDisplay;
const chosen = display !== 'auto' ? display : hasWeston ? 'weston' : hasXvfb ? 'xvfb' : 'headless';
if (display !== 'auto') {
  if (chosen === 'weston' && !hasWeston) die('--display=weston needs weston on PATH');
  if (chosen === 'xvfb' && !hasXvfb) die('--display=xvfb needs xvfb-run on PATH');
  if (chosen === 'desktop' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    die('--display=desktop needs DISPLAY or WAYLAND_DISPLAY (run it from a session, or use weston/xvfb)');
  }
  if (!['weston', 'xvfb', 'desktop', 'headless'].includes(chosen)) {
    die(`unknown --display=${display} (expected auto, headless, weston, xvfb or desktop)`);
  }
}
for (const engine of engines) {
  if (!['chromium', 'webkit', 'firefox'].includes(engine)) die(`unknown engine "${engine}"`);
}
/**
 * A browser that is not installed is a launch problem, and it has to be said
 * before Playwright runs: an unset `PLAYWRIGHT_BROWSERS_PATH` used to point at a
 * `.pw-browsers` that was not there, and the suite reported it as 141 failed
 * tests. Naming the path (and the fix) costs one line and saves a sweep.
 */
{
  const browsersRoot =
    pinnedBrowsers ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
      : join(homedir(), '.cache', 'ms-playwright'));
  const installed = existsSync(browsersRoot) ? readdirSync(browsersRoot) : [];
  const missing = engines.filter((engine) => !installed.some((entry) => entry.startsWith(engine)));
  if (missing.length) {
    die(
      `no ${missing.join(', ')} browser under ${browsersRoot} — run "npx playwright install ${missing.join(' ')}", ` +
        'or point PLAYWRIGHT_BROWSERS_PATH at the directory that has it',
    );
  }
}
if (engines.includes('webkit') && chosen === 'headless') {
  console.error(
    '[nightly] WebKit headless: interactions work through e2e/fixtures.ts, but the visual subset reads pixels and ' +
      'needs a real frame clock — locator.screenshot() will hang without a compositor (see docs/notes/compat.md)',
  );
}

/**
 * The visual spec's verdict is host- and engine-specific, so it is opt-in per
 * engine: Chromium compares its baselines, the other two only prove the surfaces
 * render. `e2e/visual.spec.ts` explains the split in full.
 */
const envFor = (engine) => {
  const runEnv = { ...env };
  if (engine === 'chromium') runEnv.GS1_VISUAL = '1';
  else {
    runEnv.GS1_VISUAL = '1';
    runEnv.GS1_VISUAL_SMOKE = '1';
  }
  return runEnv;
};

/**
 * One engine's log file, written while the suite runs.
 *
 * The first version kept everything the child printed in memory and wrote it
 * once the child had exited (`spawnSync`, then one `writeFileSync`). That made
 * a two-hour `--all` run look exactly like a hung one: nothing on disk to
 * `tail -f`, nothing left behind when the run was killed, and the systemd
 * unit's `TimeoutStartSec=3h` unable to tell "slow" from "stuck" — which is why
 * §一.18 could not measure the wall clock. Every chunk now goes to the fd as it
 * arrives.
 *
 * `writeSync` on a plain fd is deliberate: there is no userland buffer to lose,
 * so the partial log survives SIGTERM and SIGKILL alike. Whole lines are
 * mirrored to an interactive terminal (`tee`); under systemd or CI the progress
 * lines are the live view and the file is the artefact.
 */
function openEngineLog(path) {
  const fd = openSync(path, 'w');
  const partial = { stdout: '', stderr: '' };
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  return {
    /** Append a `[nightly]` progress line — the file always carries them too. */
    append(text) {
      writeSync(fd, text);
    },
    /** Append one of the child's stdout/stderr chunks, and tee whole lines. */
    write(chunk, which) {
      writeSync(fd, chunk);
      if (!process.stdout.isTTY) return;
      const lines = (partial[which] + decoders[which].write(chunk)).split('\n');
      partial[which] = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(`${line}\n`);
    },
    close() {
      closeSync(fd);
    },
  };
}

/** The child a signal should stop; set by `run`, cleared when it settles. */
let running = null;

/**
 * Run one command to completion, streaming its output into the engine log.
 *
 * The verdict is the one `spawnSync` gave: `code` is `status ?? 1`, so a child
 * killed by a signal still counts as a failure, a spawn that never happened is
 * `1` with empty output (which is what the launch-failure retry looks for), and
 * `out` is the stdout-then-stderr concatenation the pass/fail and
 * launch-failure regexes were written against. Only the *file* sees the
 * interleaved stream a `tail -f` wants; the judgement sees the same string it
 * always got.
 */
const run = (command, commandArgs, options = {}) => {
  const { log = null, ...spawnOptions } = options;
  return new Promise((done) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...spawnOptions,
    });
    const chunks = { stdout: [], stderr: [] };
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (running?.child === child) running = null;
      // Decode after concatenating, so a multibyte character split across two
      // chunks decodes exactly as `spawnSync`'s single read would have.
      done({
        code,
        out: Buffer.concat(chunks.stdout).toString('utf8') + Buffer.concat(chunks.stderr).toString('utf8'),
      });
    };
    running = { child, log };
    child.stdin?.end();
    for (const which of ['stdout', 'stderr']) {
      child[which].on('data', (chunk) => {
        chunks[which].push(chunk);
        log?.write(chunk, which);
      });
    }
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 1));
  });
};

/**
 * SIGTERM/SIGINT: say so in the log and stop the child.
 *
 * Nothing needs flushing — every chunk is already on disk because the writes
 * are synchronous — but the child would otherwise outlive the runner and keep
 * the preview server's port, which is how the next run fails with EADDRINUSE.
 * Re-raising the signal keeps the caller's wait status what it was before this
 * handler existed (death by signal, not a synthetic exit code), and systemd's
 * `TimeoutStartSec` kill therefore still leaves the partial log behind.
 */
const signalHandlers = {};
const stopOnSignal = (signal) => {
  const current = running;
  if (current) {
    try {
      current.log?.append(`\n[nightly] ${signal}: interrupted — the log above is what had run\n`);
    } catch {
      /* the log is best-effort once we are on the way out */
    }
    const { child } = current;
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  process.removeListener(signal, signalHandlers[signal]);
  process.kill(process.pid, signal);
};
for (const signal of ['SIGTERM', 'SIGINT']) {
  signalHandlers[signal] = () => stopOnSignal(signal);
  process.on(signal, signalHandlers[signal]);
}

/**
 * Messages that mean "the suite never started", as opposed to "a test failed".
 *
 * The nightly's job is to be the record, and the first version of this wrote a
 * port conflict down as `❌ fail — 0 passed, 0 failed (5s)`, which reads like a
 * product regression and sent a whole sweep chasing it (§一.20④). Playwright
 * fails a handful of ways before a single test runs, and every one of them
 * leaves the same signature: no test result at all.
 */
const LAUNCH_FAILURE_SIGNATURES = [
  /EADDRINUSE/,
  /is already used/,
  /reuseExistingServer/,
  /Executable doesn't exist/,
  /Host system is missing dependencies/,
  /Looks like you launched a headed browser/,
  /browserType\.launch/,
];

/**
 * Did the run fail *before* any test produced a verdict?
 *
 * `passed === 0 && failed === 0` with a non-zero exit is the invariant: a real
 * test failure always reports at least one, and Playwright prints no summary at
 * all when it never reached the suite. The signature list only sharpens the
 * message — the decision does not depend on recognising a particular one, so a
 * launch failure nobody has seen before still gets its retry.
 */
export function looksLikeLaunchFailure(out, { passed, failed, exited }) {
  if (passed > 0 || failed > 0) return false;
  if (exited === 0) return false;
  if (/No tests found/i.test(out)) return false;
  return true;
}

/** Why we think it was a launch failure, for the log line. */
export const launchFailureReason = (out) =>
  LAUNCH_FAILURE_SIGNATURES.find((pattern) => pattern.test(out))?.source ?? 'no test ran';

/**
 * The first port at or above `start` that nothing is listening on, or `null`.
 *
 * The probe runs in a child process because this whole file is built on
 * `spawnSync`: a synchronous bind is the one thing Node does not offer from
 * here. `127.0.0.1` is what the preview server binds, so that is what is
 * tested.
 */
export function findFreePort(start, tries = 10) {
  const probe = `
    const net = require('node:net');
    const [start, tries] = process.argv.slice(1).map(Number);
    const attempt = (port) => new Promise((resolve) => {
      if (port >= start + tries) return resolve(null);
      const server = net.createServer();
      server.once('error', () => resolve(attempt(port + 1)));
      server.once('listening', () => server.close(() => resolve(port)));
      server.listen(port, '127.0.0.1');
    });
    attempt(start).then((port) => { console.log(port ?? ''); process.exit(port ? 0 : 1); });
  `;
  const result = spawnSync(process.execPath, ['-e', probe, String(start), String(tries)], { encoding: 'utf8' });
  const port = Number((result.stdout ?? '').trim());
  return result.status === 0 && Number.isInteger(port) && port > 0 ? port : null;
}

// `nightly-report.mjs --self-test` verifies the table; this verifies the one
// piece of judgement the nightly makes about Playwright's output, with the
// strings that actually produced the wrong row.
if (flag('self-test')) {
  const cases = [
    {
      name: 'a port conflict is a launch failure',
      out: 'Error: http://localhost:4783 is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.',
      verdict: { passed: 0, failed: 0, exited: 1 },
      expected: true,
    },
    {
      name: 'EADDRINUSE is a launch failure',
      out: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:4783',
      verdict: { passed: 0, failed: 0, exited: 1 },
      expected: true,
    },
    {
      name: 'an unknown launch failure is still a launch failure',
      out: 'Error: something nobody has seen before',
      verdict: { passed: 0, failed: 0, exited: 1 },
      expected: true,
    },
    {
      name: 'real test failures are not',
      out: '  1 failed\n    [chromium] › e2e/roll.spec.ts:181:3 › drag\n  130 passed (12.0m)',
      verdict: { passed: 130, failed: 1, exited: 1 },
      expected: false,
    },
    {
      name: 'a green run is not',
      out: '  130 passed (12.0m)',
      verdict: { passed: 130, failed: 0, exited: 0 },
      expected: false,
    },
    {
      name: 'an empty selection is not',
      out: 'No tests found',
      verdict: { passed: 0, failed: 0, exited: 1 },
      expected: false,
    },
  ];
  let bad = 0;
  for (const entry of cases) {
    const got = looksLikeLaunchFailure(entry.out, entry.verdict);
    const ok = got === entry.expected;
    if (!ok) bad += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${entry.name}${ok ? '' : ` — expected ${entry.expected}, got ${got}`}`);
  }
  console.log(`[nightly] self-test ${bad ? `FAIL — ${bad} case(s)` : 'PASS'}`);
  process.exit(bad ? 1 : 0);
}

/**
 * The display path an engine gets, and the command that gives it one. Both are
 * shared by the real loop and `--dry-run`, so what the dry run prints is what
 * the record would say.
 */
const howFor = (engine) => (engine === 'webkit' ? chosen : 'headless');
const commandFor = (engine) => ['playwright', 'test', '--project', engine, '--workers=1', ...subset];

if (flag('dry-run')) {
  for (const engine of engines) {
    const how = howFor(engine);
    const cmd = commandFor(engine);
    const line =
      how === 'xvfb'
        ? `xvfb-run -a npx ${cmd.join(' ')} --headed`
        : `npx ${cmd.join(' ')}${how === 'headless' ? '' : ' --headed'}`;
    console.log(`[nightly] ${engine}: ${how} · subset=${subsetName} (${subset.length || 'all'} files) · ${line}`);
  }
  console.log('[nightly] DRY RUN — nothing launched, no record written');
  process.exit(0);
}

// One run at a time: two browser suites at once make both look slow, and the
// timings this writes down would be meaningless.
if (existsSync(lockPath)) {
  const age = Date.now() - Number(readFileSync(lockPath, 'utf8').split('\n')[0] || 0);
  if (age < LOCK_STALE_MS) {
    console.error(`[nightly] another run is in progress (${Math.round(age / 60000)} min old) — exiting`);
    process.exit(1);
  }
  console.log('[nightly] clearing a stale lock');
  rmSync(lockPath, { force: true });
}
writeFileSync(lockPath, `${Date.now()}\n${process.pid}\n`);

/**
 * Start a headless Weston and wait for its socket, so WebKit has a compositor
 * to composite into. Returns the pid to stop it again.
 */
function startWeston() {
  const runtime = join(logDir, 'xdg');
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const socket = 'wayland-gs1';
  const child = spawn(
    'weston',
    ['--backend=headless-backend.so', `--socket=${socket}`, '--width=1280', '--height=900', '--idle-time=0'],
    { cwd: root, env: { ...env, XDG_RUNTIME_DIR: runtime }, detached: true, stdio: 'ignore' },
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(runtime, socket))) return { pid: child.pid, runtime, socket };
    spawnSync('sleep', ['0.25']);
  }
  return { pid: child.pid, runtime, socket, failed: true };
}

/** The date the run happened on, in the local day a reader would write down. */
function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The port `playwright.config.ts` will bind, read out of it rather than copied:
 * the two have to agree, and the only way to be sure is to parse the one that
 * actually listens.
 */
const DEFAULT_PORT = (() => {
  const config = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
  return Number(/process\.env\.GS1_E2E_PORT\s*\?\?\s*(\d+)/.exec(config)?.[1] ?? 4783);
})();

/**
 * Launch one engine's suite with the display path it needs, and clean up the
 * compositor afterwards. Split out of the loop so a retry can run the same
 * thing again with a different port.
 */
async function launchEngine(engine, cmd, runEnv, initialHow, log) {
  let how = initialHow;
  if (engine === 'webkit' && chosen === 'weston') {
    const weston = startWeston();
    if (weston.failed) {
      console.error('[nightly] weston did not come up; running WebKit headless');
      how = 'headless';
      return { result: await run('npx', cmd, { env: runEnv, log }), how };
    }
    runEnv.XDG_RUNTIME_DIR = weston.runtime;
    runEnv.WAYLAND_DISPLAY = weston.socket;
    try {
      return { result: await run('npx', [...cmd, '--headed'], { env: runEnv, log }), how };
    } finally {
      try {
        process.kill(-weston.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(weston.pid, 'SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }
  }
  if (engine === 'webkit' && chosen === 'xvfb') {
    return { result: await run('xvfb-run', ['-a', 'npx', ...cmd, '--headed'], { env: runEnv, log }), how };
  }
  if (engine === 'webkit' && chosen === 'desktop') {
    return { result: await run('npx', [...cmd, '--headed'], { env: runEnv, log }), how };
  }
  return { result: await run('npx', cmd, { env: runEnv, log }), how };
}

const stamp = localDay();
const rows = [];
let failures = 0;

try {
  for (const engine of engines) {
    const logPath = join(logDir, `${stamp}-${engine}.log`);
    const cmd = commandFor(engine);
    // The port is machine-wide, not per-worktree (`playwright.config.ts`), so a
    // preview server another run left behind makes this one fail before a single
    // test starts. Retry once on a free port rather than writing that down as an
    // engine failure — the record is the point of this script.
    const basePort = Number(env.GS1_E2E_PORT ?? DEFAULT_PORT);
    let runEnv = envFor(engine);
    let how = howFor(engine);
    let result;
    let passed = 0;
    let failed = 0;
    let seconds = 0;
    // Opened before anything is launched, so the log answers "which engine, and
    // since when" even if the browser never produces a line of its own.
    const log = openEngineLog(logPath);
    const progress = (message) => {
      log.append(`${message}\n`);
      console.log(message);
    };
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const started = Date.now();
        how = howFor(engine);
        progress(
          `[nightly] ${engine}: starting (attempt ${attempt}/2) · ${how} · ` +
            `subset=${subsetName} (${subset.length || 'all'} files) · port=${runEnv.GS1_E2E_PORT ?? basePort}`,
        );
        ({ result, how } = await launchEngine(engine, cmd, runEnv, how, log));
        seconds = Math.round((Date.now() - started) / 1000);
        passed = Number(/ (\d+) passed/.exec(result.out)?.[1] ?? 0);
        failed = Number(/ (\d+) failed/.exec(result.out)?.[1] ?? 0);
        progress(
          `[nightly] ${engine}: finished — ${result.code === 0 ? 'pass' : 'fail'} · ` +
            `${passed} passed, ${failed} failed (${seconds}s)`,
        );
        if (attempt === 2 || !looksLikeLaunchFailure(result.out, { passed, failed, exited: result.code })) break;
        const next = findFreePort(basePort + 1);
        if (next === null) {
          console.error(`[nightly] ${engine}: the suite never started and no free port was found near ${basePort}`);
          break;
        }
        // The retry separator has to go in *before* the second attempt streams
        // under it (the old code appended it after the fact); it names the port
        // about to be used and the reason the first attempt gave, which is what
        // the console line below says too.
        log.append(`\n\n===== retry on port ${next} (${launchFailureReason(result.out)}) =====\n\n`);
        console.error(
          `[nightly] ${engine}: the suite never started (${launchFailureReason(result.out)}) after ${seconds}s — retrying on port ${next}`,
        );
        runEnv = { ...runEnv, GS1_E2E_PORT: String(next) };
      }
    } finally {
      log.close();
    }
    console.log(
      `[nightly] ${engine}: ${how} · subset=${subsetName} (${subset.length || 'all'} files) · npx ${cmd.join(' ')}`,
    );
    const status = result.code === 0 ? 'pass' : 'fail';
    if (result.code !== 0) failures += 1;
    console.log(`[nightly] ${engine}: ${status} — ${passed} passed, ${failed} failed (${seconds}s) · ${logPath}`);
    rows.push({ date: stamp, engine, display: how, result: status === 'pass' ? '✅ pass' : '❌ fail', passed, failed, seconds });
  }

  const summary = rows.map(formatRow).join('\n');
  if (update) {
    // The record is read back, extended and rewritten: the trend is recomputed
    // from the table the reader sees, never carried along as prose.
    const runs = appendRuns(NOTES_PATH, rows);
    console.log(`[nightly] wrote ${NOTES_PATH}`);
    console.log(`[nightly] trend (generated from ${runs.length} rows):\n${renderTrend(runs)}`);
  } else {
    console.log(`[nightly]\n${summary}`);
  }
} finally {
  rmSync(lockPath, { force: true });
}

// Keep the log directory small enough to be worth looking at.
const logs = readdirSync(logDir)
  .filter((name) => name.endsWith('.log'))
  .sort()
  .reverse();
for (const stale of logs.slice(KEEP_LOGS * Math.max(1, engines.length))) {
  rmSync(join(logDir, stale), { force: true });
}

if (failures) {
  console.error(`[nightly] FAIL — ${failures} engine(s) not green`);
  process.exit(1);
}
console.log('[nightly] PASS');
