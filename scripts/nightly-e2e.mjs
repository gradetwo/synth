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
 * Headed on a compositor is not a preference: headless WebKit on Linux never
 * fires requestAnimationFrame, so Playwright's pre-click stability check waits
 * for ever and every click times out. Weston's headless backend is the standard
 * local path now — measured 1.8 fps against Xvfb's 0.7 on this machine, and it
 * uses the GPU when `/dev/dri` is there (see docs/notes/compat.md). Xvfb stays
 * as a fallback, and a real desktop session is fastest of all.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTES_PATH,
  appendRuns,
  formatRow,
  renderTrend,
} from './nightly-report.mjs';

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
 * whole suite stays CI's job. The lists are the single source of truth: the docs
 * point here instead of copying them.
 */
const CORE_SUBSET = [
  'e2e/responsive.spec.ts', // iPhone/iPad, both orientations
  'e2e/touch.spec.ts',
  'e2e/text-fit.spec.ts',
  'e2e/boot.spec.ts',
  'e2e/fxgraph.spec.ts',
  'e2e/share.spec.ts',
  'e2e/drawer.spec.ts',
  'e2e/theme.spec.ts',
];
/** Render-everything, compare-nothing on WebKit/Firefox; see the header. */
const VISUAL_SUBSET = ['e2e/visual.spec.ts'];
/** The browser side of the sound path. */
const AUDIO_SUBSET = [
  'e2e/smoke.spec.ts', // boots, starts the engine, plays a note
  'e2e/audio.spec.ts', // engine numbers, preload, polyphony
  'e2e/filter.spec.ts',
  'e2e/delay.spec.ts',
  'e2e/fm.spec.ts',
  'e2e/oversample.spec.ts',
  'e2e/wavetable.spec.ts',
  'e2e/sample.spec.ts',
  'e2e/meter.spec.ts', // idle monitor readout
];
const SUBSETS = {
  core: CORE_SUBSET,
  nightly: [...CORE_SUBSET, ...VISUAL_SUBSET, ...AUDIO_SUBSET],
  all: [],
};
const subsetName = value('subset') ?? (flag('all') ? 'all' : flag('core') ? 'core' : 'nightly');
if (!(subsetName in SUBSETS)) {
  die(`unknown --subset=${subsetName} (expected ${Object.keys(SUBSETS).join(', ')})`);
}
const subset = [...new Set(SUBSETS[subsetName])];
const update = flag('update');
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || join(root, '.pw-browsers');
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath };

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
if (engines.includes('webkit') && chosen === 'headless') {
  console.error('[nightly] WebKit headless never fires requestAnimationFrame — clicks will time out (see docs/notes/compat.md)');
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

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: root, env, encoding: 'utf8', ...options });
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

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

const stamp = localDay();
const rows = [];
let failures = 0;

try {
  for (const engine of engines) {
    const logPath = join(logDir, `${stamp}-${engine}.log`);
    const cmd = commandFor(engine);
    const runEnv = envFor(engine);
    const started = Date.now();
    /** The display path this engine actually got, for the log and the record. */
    let how = howFor(engine);
    let result;
    if (engine === 'webkit' && chosen === 'weston') {
      const weston = startWeston();
      if (weston.failed) {
        console.error('[nightly] weston did not come up; running WebKit headless');
        how = 'headless';
        result = run('npx', cmd, { env: runEnv });
      } else {
        runEnv.XDG_RUNTIME_DIR = weston.runtime;
        runEnv.WAYLAND_DISPLAY = weston.socket;
        try {
          result = run('npx', [...cmd, '--headed'], { env: runEnv });
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
    } else if (engine === 'webkit' && chosen === 'xvfb') {
      result = run('xvfb-run', ['-a', 'npx', ...cmd, '--headed'], { env: runEnv });
    } else if (engine === 'webkit' && chosen === 'desktop') {
      result = run('npx', [...cmd, '--headed'], { env: runEnv });
    } else {
      result = run('npx', cmd, { env: runEnv });
    }
    console.log(
      `[nightly] ${engine}: ${how} · subset=${subsetName} (${subset.length || 'all'} files) · npx ${cmd.join(' ')}`,
    );
    const seconds = Math.round((Date.now() - started) / 1000);
    writeFileSync(logPath, result.out);

    const passed = Number(/ (\d+) passed/.exec(result.out)?.[1] ?? 0);
    const failed = Number(/ (\d+) failed/.exec(result.out)?.[1] ?? 0);
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
