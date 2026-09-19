import { expect, test, type Page } from './fixtures';

/**
 * The 2x oversampling switch (P6.5), from the browser's side.
 *
 * The DSP is measured where it lives — the audio gate holds the aliases more
 * than 12 dB down through the real wasm build, and the Rust tests cover the
 * decimator's stopband and the bit-exact default. What only a browser can
 * answer is whether the switch is reachable, whether it says what it does, and
 * whether it travels with the patch through a share code.
 */

async function boot(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(300);
}

const filterModule = (page: Page) => page.locator('[data-module-id="filter"]');
/** The LED's accessible name is the whole i18n hint, so match on its stem. */
const oversampleLed = (page: Page) => filterModule(page).locator('button[aria-label*="过采样"]');

test.describe('2x oversampling switch', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('toggles from the filter module and travels with the patch', async ({ page, browser }) => {
    await boot(page);
    const filter = filterModule(page);
    await expect(filter).toBeVisible();

    const led = oversampleLed(page);
    await expect(led).toHaveCount(1);
    // Off by default: every patch written before P6.5 renders the same.
    await expect(led).toHaveAttribute('aria-pressed', 'false');

    // Both directions are one tap, so there is no state the player cannot undo.
    await led.click();
    await expect(led).toHaveAttribute('aria-pressed', 'true');
    await led.click();
    await expect(led).toHaveAttribute('aria-pressed', 'false');
    await led.click();
    await expect(led).toHaveAttribute('aria-pressed', 'true');

    // A share link carries the switch, in a browser that has never seen it.
    await page.getByRole('button', { name: '预设库' }).click();
    await page.locator('.preset-drawer button', { hasText: '分享' }).first().click();
    await expect.poll(async () => page.evaluate(() => location.hash)).toContain('gs1.');
    const url = await page.evaluate(() => location.href);

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const receiver = await other.newPage();
    await receiver.goto(url);
    await expect
      .poll(async () => oversampleLed(receiver).getAttribute('aria-pressed'), { timeout: 15_000 })
      .toBe('true');
    // And it survives a reload of the shared patch, not just the first load.
    await receiver.reload();
    await expect
      .poll(async () => oversampleLed(receiver).getAttribute('aria-pressed'), { timeout: 15_000 })
      .toBe('true');
    await other.close();
  });
});
