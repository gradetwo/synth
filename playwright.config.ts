import { defineConfig, devices } from '@playwright/test';

/**
 * The port this suite serves itself on.
 *
 * It used to be 4173 with `reuseExistingServer: true`, which is the common
 * convenience setting and a trap on a shared development box: this machine also
 * runs an unrelated app whose dev server had taken 4173, so Playwright reused
 * *that* server and the whole suite tested the wrong application. Every test
 * failed, all of them for reasons that had nothing to do with this repository,
 * and the failures read like an app regression (a start overlay that never
 * appeared) rather than like a port collision. Two changes fix it: the port is
 * one nothing else on this box uses, and a server that is already there is an
 * error instead of something to reuse -- `--strictPort` then makes the failure
 * loud and immediate. `GS1_E2E_PORT` overrides it when a CI box needs to.
 */
const PORT = Number(process.env.GS1_E2E_PORT ?? 4783);

export default defineConfig({
  testDir: './e2e',
  // 45 s was tight on a machine that is doing something else: this box runs at
  // load 8-9 on eight old cores at times, and pages then take tens of seconds to
  // boot. A broken locator still fails (it never appears, however long we wait);
  // what this buys is not failing because the host was busy.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  // All engines can be run with `--project=<name>`. `npm run test:e2e` is the
  // Chromium app suite (`--project=chromium`, what CI and release run), and
  // `npm run test:perf` is the isolated single-worker `perf` project.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The app suite's budget, raised from the default 60 s for the same
      // reason WebKit (120 s) and Firefox (90 s) below have one: this box is
      // shared, and a busy host stretches *every* step of a test, boot
      // included. It is a budget, not an assertion -- every assertion is
      // unchanged, and a broken locator still fails, because it never appears
      // however long we wait. No `retries` here on purpose: a retry would turn
      // a real one-in-three flake into a green line (the plan forbids masking
      // this way, §一.39⑤), while a budget only decides how long a *hung* step
      // may wait.
      //
      // Measured on `e2e/player.spec.ts:45` with the renderer throttled through
      // CDP (`Emulation.setCPUThrottlingRate`) on a quiet host, which is the
      // reproducible stand-in for a loaded one:
      //
      //   1x  20.0 s   (60 s budget: fine)
      //   4x  40.8 s
      //   6x  41.7 s
      //   8x  `Test timeout of 60000ms exceeded`
      //
      // That test no longer carries three guessed sleeps (it waits on the
      // transport's own clock now) and passes at 8x, but it still measures
      // 48.6 s at 4x and 54.0 s at 6x -- i.e. on a host six times slower than
      // this one the fixed test spends 90 % of a 60 s budget. The same full
      // suite (160 tests, 4 workers, load 8 -> 17) has `preset-audition:42` at
      // 48.7 s and `player:45` at 34.9 s, so 60 s leaves a loaded host no room
      // at all. 90 s is the Firefox number for exactly this reason.
      timeout: 90_000,
      // `e2e/boot.spec.ts` needs Chrome's real autoplay policy: it is the case
      // where a context comes back already running but with no graph. WebKit
      // refuses the flag, so it lives here rather than in the spec.
      launchOptions: { args: ['--autoplay-policy=user-gesture-required'] },
      // `e2e/performance.spec.ts` measures the app's frame cost, and a number
      // measured while the other spec files boot Chromium workers on every core
      // measures the host, not the app: on this machine the same build read
      // 13.8-20.0 fps inside the parallel suite and 60.0 fps run alone, and that
      // gap blocked a release (v1.111.0). It is the isolated `perf` project
      // below instead, so the app suite never contends with it.
      testIgnore: /performance\.spec\.ts/,
    },
    {
      // The performance suite: the same browser and the same flags as
      // `chromium`, in a project of its own so it can be run alone and single
      // worker (`npm run test:perf` -> `--project=perf --workers=1`). Every
      // threshold is unchanged -- this is isolation, not a relaxed gate.
      name: 'perf',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /performance\.spec\.ts/,
      launchOptions: { args: ['--autoplay-policy=user-gesture-required'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: /e2e\/(performance|devices)\.spec\.ts/,
      // WebKit on Linux runs this app several times slower than Chromium (a
      // click that takes 160 ms in Chromium took 5.4 s there, and the first
      // open of the preset library is the worst of it). The default 45 s
      // timeout turned that into failures that said nothing about the app, so
      // this engine gets room and one retry: a report, not a gate.
      //
      // `reducedMotion` is not cosmetic either: with the app's decorative
      // animations running, a click on an animated surface could wait for a
      // stable box for ever under WebKit (measured: 90 s timeout with them,
      // 6.3 s with this set). The app honours the preference, tests assert
      // behaviour, and neither wants the animation.
      reducedMotion: 'reduce',
      timeout: 120_000,
      expect: { timeout: 20_000 },
      retries: 1,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /e2e\/(performance|devices)\.spec\.ts/,
      // Same reasoning as WebKit, less extreme: slower than Chromium, and the
      // same animation-versus-stability trap.
      reducedMotion: 'reduce',
      timeout: 90_000,
      retries: 1,
    },
  ],
});
