import { expect, test, type Page } from './fixtures';
import { CHANGELOG_HEAD } from '../src/changelog-head';

/**
 * The update banner, in the state a returning player actually sees it: a new
 * worker is waiting. The service-worker container is faked before the app boots
 * so the banner renders without deploying twice, which is also the only way to
 * pin a layout that otherwise only appears for one release per visitor.
 *
 * It used to be a bare flex row: no width cap, no `min-width:0` on the text and
 * no sizes on the buttons, so on a wide window the headline could not ellipsize
 * and dragged the two actions into tall blocks.
 *
 * The fake's `postMessage` answers the version handshake exactly the way the
 * generated `sw.js` does (`scripts/gen-sw.mjs`: `GET_VERSION` in, `VERSION`
 * back over the transferred port). `version: null` models a waiting worker that
 * never answers; the banner must then show no version rather than the running
 * build's.
 */
async function withWaitingWorker(page: Page, version: string | null = '2.0.2') {
  await page.addInitScript((version: string | null) => {
    const waiting = {
      state: 'installed',
      postMessage(message: { type?: string }, transfer?: MessagePort[]) {
        if (message?.type === 'GET_VERSION' && version && transfer?.[0]) {
          transfer[0].postMessage({ type: 'VERSION', version });
        }
      },
    };
    const registration = {
      waiting,
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
  }, version);
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

  /**
   * P12.6: the version label. It used to come from the *running* bundle's
   * `CHANGELOG_HEAD` — the release the page already has, and after a rollback
   * the release being removed. The waiting worker is the only thing that knows
   * which build the button will install.
   */
  test('names the version the waiting worker will install, not the running one', async ({ page }) => {
    await withWaitingWorker(page, '9.9.9');
    await page.goto('/');
    const line = page.locator('.update-what');
    await expect(page.locator('.update-banner')).toBeVisible();
    await expect(line).toContainText('v9.9.9 ·');
    await expect(line).not.toContainText(`v${CHANGELOG_HEAD.version} `);
  });

  test('names the rollback target when the waiting worker is older than the page', async ({ page }) => {
    // The exact P12.4 -> P12.6 shape: the page still runs the newer build (the
    // version being rolled back) while the waiting worker is the older rollback
    // target. The label has to be the target, because that is what gets
    // installed.
    const rollbackTarget = '0.9.9';
    expect(rollbackTarget).not.toBe(CHANGELOG_HEAD.version);
    await withWaitingWorker(page, rollbackTarget);
    await page.goto('/');
    const banner = page.locator('.update-banner');
    await expect(banner).toBeVisible();
    await expect(page.locator('.update-what')).toContainText(`v${rollbackTarget} ·`);
    await expect(banner).not.toContainText(`v${CHANGELOG_HEAD.version}`);
  });

  test('shows no version at all when the waiting worker never answers', async ({ page }) => {
    await withWaitingWorker(page, null);
    await page.goto('/');
    const banner = page.locator('.update-banner');
    await expect(banner).toBeVisible();
    // Wait past the handshake timeout: the copy must still carry no version,
    // and specifically not the running build's. No number is honest; a wrong
    // one is what this whole handshake exists to stop.
    await page.waitForTimeout(1700);
    const line = page.locator('.update-what');
    await expect(line).toBeVisible();
    await expect(banner).not.toContainText(`v${CHANGELOG_HEAD.version}`);
    expect(await line.textContent()).not.toMatch(/\bv\d/);
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
