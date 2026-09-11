import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  // All three engines can be run with `--project=<name>`; the default suite is
  // Chromium so a normal `npm run e2e` stays fast.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // `e2e/boot.spec.ts` needs Chrome's real autoplay policy: it is the case
      // where a context comes back already running but with no graph. WebKit
      // refuses the flag, so it lives here rather than in the spec.
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
