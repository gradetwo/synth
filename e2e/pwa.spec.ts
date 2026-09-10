import { test, expect } from '@playwright/test';

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
  // Nothing was served from the browser's error page.
  expect(page.url()).toContain('127.0.0.1:4173');
});

/** The app must boot and make sound while controlled by its service worker. */
test('boots with a service worker controlling the page', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  // Wait for the worker to take control, then reload as a returning user would.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
  await page.reload();
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
