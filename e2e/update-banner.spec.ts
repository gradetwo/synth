import { expect, test, type Page } from '@playwright/test';

/**
 * The update banner, in the state a returning player actually sees it: a new
 * worker is waiting. The service-worker container is faked before the app boots
 * so the banner renders without deploying twice, which is also the only way to
 * pin a layout that otherwise only appears for one release per visitor.
 *
 * It used to be a bare flex row: no width cap, no `min-width:0` on the text and
 * no sizes on the buttons, so on a wide window the headline could not ellipsize
 * and dragged the two actions into tall blocks.
 */

async function withWaitingWorker(page: Page) {
  await page.addInitScript(() => {
    const registration = {
      waiting: { state: 'installed', postMessage() {} },
      installing: null,
      active: { state: 'activated' },
      scope: `${location.origin}/`,
      update: async () => {},
      addEventListener() {},
      removeEventListener() {},
      unregister: async () => true,
    };
    const container = {
      controller: {},
      ready: Promise.resolve(registration),
      register: async () => registration,
      getRegistration: async () => registration,
      getRegistrations: async () => [registration],
      addEventListener() {},
      removeEventListener() {},
      startMessages() {},
    };
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  });
}

test.describe('update banner', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('is a compact bar with two fixed actions', async ({ page }) => {
    await withWaitingWorker(page);
    await page.goto('/');
    const banner = page.locator('.update-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('新版本已就绪');
    await expect(banner).not.toContainText('🚀');

    const box = (await banner.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(662);
    expect(box.width).toBeGreaterThan(320);
    expect(box.height).toBeLessThanOrEqual(64);

    // The copy is two short lines that ellipsize; the headline is long enough
    // that it must be clipped rather than wrapped.
    const copy = (await page.locator('.update-copy').boundingBox())!;
    expect(copy.height).toBeLessThanOrEqual(36);
    expect(await page.locator('.update-what').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    const go = (await page.getByRole('button', { name: '立即更新' }).boundingBox())!;
    const close = (await page.getByRole('button', { name: '稍后' }).boundingBox())!;
    expect(Math.round(go.height)).toBe(32);
    expect(Math.round(close.height)).toBe(32);
    expect(Math.round(close.width)).toBe(32);
    // Desktop keeps one row: the actions share the copy's line.
    expect(Math.abs(go.y - copy.y)).toBeLessThan(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    await banner.screenshot({ path: 'test-results/banner-desktop.png' });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('puts the actions under the copy instead of squeezing it', async ({ page }) => {
      await withWaitingWorker(page);
      await page.goto('/');
      const banner = page.locator('.update-banner');
      await expect(banner).toBeVisible();
      const box = (await banner.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(380);
      expect(box.height).toBeLessThanOrEqual(120);

      const copy = (await page.locator('.update-copy').boundingBox())!;
      const go = (await page.getByRole('button', { name: '立即更新' }).boundingBox())!;
      expect(go.y).toBeGreaterThan(copy.y + copy.height - 6);
      expect(Math.round(go.height)).toBe(32);
      await banner.screenshot({ path: 'test-results/banner-phone.png' });
    });
  });
});
