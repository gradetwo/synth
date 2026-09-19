import { test, expect } from './fixtures';
import { hostAudioUnavailableReason } from './audio-host';
import { readFileSync } from 'node:fs';

const APP_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

/**
 * The host redirects `/index.html` to `/` (see the preview plugin in
 * `vite.config.ts`). A navigation request has `redirect: 'manual'`, so a service
 * worker that returns the followed response makes the browser refuse the load
 * and show its own error page — the regression this guards against showed up as
 * "this page might be down" on the live site while incognito (no worker yet)
 * worked fine.
 */
test('a redirected shell does not break the second visit', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  // The worker now serves the navigation itself, and its own shell fetch is the
  // one the host redirects.
  await page.reload();
  await expect(page.getByRole('button', { name: /启动音频引擎/ })).toBeVisible();
  // Nothing was served from the browser's error page. Derived from the
  // configured origin rather than a literal port: the suite's port is a
  // per-machine detail (see `playwright.config.ts`), and a hard-coded one
  // stopped meaning anything the moment it moved.
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  expect(new URL(page.url()).origin).toBe(origin);
});

/** The app must boot and make sound while controlled by its service worker. */
test('boots with a service worker controlling the page', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  // Wait for the worker to take control, then reload as a returning user would.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  await page.reload();
  // A note can only produce audio on a host with an audio device; skip with the
  // reading rather than report the missing sound card as a product red.
  const hostSkip = await hostAudioUnavailableReason(page);
  test.skip(hostSkip !== null, hostSkip ?? undefined);
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(1200);

  // No error on the start gate, and a note produces real audio.
  await expect(page.locator('.start-overlay')).toHaveCount(0);
  const meter = page.locator('.vu-meter');
  const key = page.locator('.bkey').nth(4);
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => meter.textContent(), { timeout: 8000 }).not.toMatch(/^— · —/);
  await page.mouse.up();
});

/**
 * The generated worker has to answer the update banner's version handshake.
 *
 * `e2e/update-banner.spec.ts` fakes the service-worker container, so it pins the
 * *page* side of the protocol; this exercises the real `dist/sw.js` that
 * `scripts/gen-sw.mjs` emitted, in a real browser. Only the worker itself can
 * name the build it carries — the running page's own `CHANGELOG_HEAD` is the
 * version being replaced after a rollback, which is the bug the handshake is
 * for (P12.6).
 */
test('the generated worker answers the version handshake', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  await page.reload();

  // The same message shape `src/pwa/register.ts` sends: `GET_VERSION` with a
  // transferred port, `VERSION` back over it. A silent worker resolves to null
  // and fails the assertion below instead of hanging.
  const version = await page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(null), 3000);
        channel.port1.onmessage = (event: MessageEvent) => {
          clearTimeout(timer);
          resolve((event.data as { version?: string } | null)?.version ?? null);
        };
        navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
      }),
  );
  expect(version).toBe(APP_VERSION);
});

/**
 * The app has to open with the network switched off.
 *
 * This is the case the redirect bug above was hiding, and it survived every
 * check that looked at the cache: `cache.addAll` follows the host's redirect of
 * `/index.html` to `/`, so the *precached* shell carries the `redirected` flag,
 * and a navigation request refuses to consume such a response. The worker
 * answered offline from a full, correct cache and the browser still showed its
 * own error page. Online nothing looked wrong, which is why the suite now pulls
 * the plug and starts the engine from the cached core.
 *
 * WebKit cannot run this case at all: `page.reload()` while the context is
 * offline throws `WebKit encountered an internal error` before the engine has
 * produced a response, so the precached shell can never be observed there.
 * Reproduced here on Linux headless WebKit (both the attempt and its retry) and
 * by the user on macOS 26.6.2 / Playwright 1.63 -- two platforms, same reading
 * -- while the three online cases in this file pass on both, so it is the
 * engine/driver layer and not the worker. Skipped by name with the reason on
 * the terminal (the `e2e/audio-host.ts` pattern) instead of being left red as a
 * fake product signal; Chromium runs it for real, which is where the offline
 * path is covered.
 */
test('opens from the precache with the network off', async ({ page, context, browserName }) => {
  test.setTimeout(180_000);
  const webkitOfflineReload =
    browserName === 'webkit'
      ? 'page.reload() under context.setOffline(true) throws "WebKit encountered an internal error" ' +
        'on Linux headless and on macOS WebKit alike (Playwright 1.63); the engine never issues the ' +
        'navigation, so the precached shell cannot be observed there. Chromium covers this case.'
      : null;
  if (webkitOfflineReload) console.log(`[pwa-offline] ${browserName}: skip -- ${webkitOfflineReload}`);
  test.skip(webkitOfflineReload !== null, webkitOfflineReload ?? undefined);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole('button', { name: /启动音频引擎/ })).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload();
    const start = page.getByRole('button', { name: /启动音频引擎/ });
    await expect(start).toBeVisible();
    // The gate is not enough: the shell has to be styled and the engine has to
    // come up from the precached wasm and worklet, which is what "offline" means.
    //
    // Wait on the engine's own signal instead of one long click. An offline
    // reload can re-create the gate while the click is in flight (the service
    // worker takes control as the page loads), and a single `click()` then
    // retries "element was detached from the DOM" until its whole budget is
    // gone -- which is how this case flaked in two release runs. Clicking while
    // the overlay is there and treating "the overlay is gone" as "the engine
    // started" is the same assertion without the race; the keyboard dock below
    // is the visible confirmation.
    await expect
      .poll(
        async () => {
          if ((await page.locator('.start-overlay').count()) === 0) return true;
          await start.click({ timeout: 2_000 }).catch(() => {});
          return (await page.locator('.start-overlay').count()) === 0;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect(page.locator('.kbd-dock.open')).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.setOffline(false);
  }
});
