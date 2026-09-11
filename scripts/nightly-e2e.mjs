#!/usr/bin/env node
/**
 * Nightly browser run (C1).
 *
 * The engines that are not on every commit — WebKit and Firefox — get a run of
 * their own here, either from a timer on a machine that stays on or from the
 * scheduled CI job. Waiting for a push means a WebKit-only regression can sit
 * unnoticed for days; that is exactly what happened to the start button.
 *
 *   npm run nightly                  # WebKit, headed under Xvfb, whole suite
 *   npm run nightly -- --engines=webkit,firefox
 *   npm run nightly -- --subset      # the phone/tablet viewports + the new work
 *   npm run nightly -- --update      # also append a row to docs/notes/nightly.md
 *
 * Headed under a virtual display is not a preference: headless WebKit on Linux
 * never fires requestAnimationFrame, so Playwright's pre-click stability check
 * waits for ever and every click times out (see docs/notes/compat.md). The
 * script therefore runs `xvfb-run -a ... --headed` when Xvfb is available, and
 * says so when it is not.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, '.tmp', 'nightly');
const lockPath = join(logDir, 'nightly.lock');
const notesPath = join(root, 'docs', 'notes', 'nightly.md');
const KEEP_LOGS = 14;
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const engines = value('engines', 'webkit').split(',').map((s) => s.trim()).filter(Boolean);
/**
 * The phone/tablet-first set the plan asks for. Running WebKit over the whole
 * suite on a workstation is not practical — it is several times slower than
 * Chromium and the browser gets unstable deep into a long run (see
 * docs/notes/compat.md) — so WebKit's nightly default is this subset and the
 * whole suite stays CI's job. `--all` asks for everything.
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
const all = flag('all');
const subset = all ? [] : CORE_SUBSET;
const update = flag('update');
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || join(root, '.pw-browsers');
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath };

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: root, env, encoding: 'utf8', ...options });
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

mkdirSync(logDir, { recursive: true });

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

const hasXvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' }).status === 0;
const stamp = new Date().toISOString().slice(0, 10);
const rows = [];
let failures = 0;

for (const engine of engines) {
  const logPath = join(logDir, `${stamp}-${engine}.log`);
  const cmd = ['playwright', 'test', '--project', engine, '--workers=1', ...subset];
  let argv;
  if (engine === 'webkit' && hasXvfb) {
    // The renderer needs frames for the clicks to be considered stable.
    argv = ['-a', 'npx', ...cmd, '--headed'];
  } else {
    argv = ['npx', ...cmd];
  }
  const started = Date.now();
  console.log(`[nightly] ${engine}: npx ${cmd.join(' ')}${engine === 'webkit' && hasXvfb ? ' --headed (xvfb)' : ''}`);
  const result = hasXvfb && engine === 'webkit'
    ? run('xvfb-run', argv)
    : run(argv[0], argv.slice(1));
  const seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(logPath, result.out);

  const passed = Number(/ (\d+) passed/.exec(result.out)?.[1] ?? 0);
  const failed = Number(/ (\d+) failed/.exec(result.out)?.[1] ?? 0);
  const status = result.code === 0 ? 'pass' : 'fail';
  if (result.code !== 0) failures += 1;
  console.log(`[nightly] ${engine}: ${status} — ${passed} passed, ${failed} failed (${seconds}s) · ${logPath}`);
  rows.push({ engine, status, passed, failed, seconds });
}

const summary = rows
  .map((r) => `| ${stamp} | ${r.engine} | ${r.status === 'pass' ? '✅' : '❌'} ${r.status} | ${r.passed} | ${r.failed} | ${r.seconds}s |`)
  .join('\n');

if (update) {
  if (!existsSync(notesPath)) {
    writeFileSync(
      notesPath,
      '# 夜间浏览器跑 / Nightly browser runs\n\n' +
        '由 `npm run nightly -- --update`（本机）或 CI 的 `nightly` 作业写入：WebKit / Firefox 全量 E2E。\n' +
        '本机需 `xvfb-run`：headless WebKit 不触发 rAF，点击会一直等（见 `docs/notes/compat.md`）。\n\n' +
        '| 日期 | 内核 | 结果 | 通过 | 失败 | 用时 |\n| :--- | :--- | :--- | ---: | ---: | ---: |\n',
    );
  }
  appendFileSync(notesPath, `${summary}\n`);
  console.log(`[nightly] wrote ${notesPath}`);
} else {
  console.log(`[nightly]\n${summary}`);
}

// Keep the log directory small enough to be worth looking at.
const logs = readdirSync(logDir)
  .filter((name) => name.endsWith('.log'))
  .sort()
  .reverse();
for (const stale of logs.slice(KEEP_LOGS * Math.max(1, engines.length))) {
  rmSync(join(logDir, stale), { force: true });
}
rmSync(lockPath, { force: true });

if (failures) {
  console.error(`[nightly] FAIL — ${failures} engine(s) not green`);
  process.exit(1);
}
console.log('[nightly] PASS');
