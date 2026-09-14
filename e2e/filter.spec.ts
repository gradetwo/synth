import { expect, test, type Page } from './fixtures';

/**
 * The SEM continuous multimode (P6.3a), from the browser's side.
 *
 * The DSP is measured where it lives — the Rust tests check the four canonical
 * responses and the audio gate measures the slopes, the notch and a click-free
 * knob through the real wasm build. What only a browser can answer is whether
 * the control is reachable on a desktop and on a phone, whether it only shows
 * up where it does something, and whether the type and its position travel with
 * the patch.
 */

async function boot(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(300);
}

/** Drag a knob upward with the real gesture rather than a setter. */
async function turn(page: Page, name: string, pixels: number) {
  const dial = page.getByRole('slider', { name, exact: true }).first();
  await dial.scrollIntoViewIfNeeded();
  const box = (await dial.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - pixels, { steps: 6 });
  await page.mouse.up();
  return Number(await dial.getAttribute('aria-valuenow'));
}

const filterModule = (page: Page) => page.locator('[data-module-id="filter"]');
const morphKnob = (page: Page) => filterModule(page).getByRole('slider', { name: 'MORPH', exact: true });

test.describe('SEM continuous multimode', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the morph knob appears with the type and travels with the patch', async ({ page, browser }) => {
    await boot(page);
    const filter = filterModule(page);
    await expect(filter).toBeVisible();

    // The default patch is a plain low-pass, and a knob that does nothing on
    // six of the seven types would be a lie: it is not there.
    await expect(morphKnob(page)).toHaveCount(0);

    await filter.getByRole('button', { name: 'SEM' }).click();
    await expect(morphKnob(page)).toBeVisible();
    await expect(morphKnob(page)).toHaveAttribute('aria-valuenow', '0');

    const value = await turn(page, 'MORPH', 40);
    expect(value).toBeGreaterThan(0.1);

    // A share link has to carry both the type and the position, in a browser
    // that has never seen this one.
    await page.getByRole('button', { name: '预设库' }).click();
    await page.locator('.preset-drawer button', { hasText: '分享' }).first().click();
    await expect.poll(async () => page.evaluate(() => location.hash)).toContain('gs1.');
    const url = await page.evaluate(() => location.href);

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const receiver = await other.newPage();
    await receiver.goto(url);
    await expect
      .poll(async () => Number(await morphKnob(receiver).getAttribute('aria-valuenow')), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0.1);
    await other.close();
  });
});

test.describe('the second filter stage', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('appears when it is switched on and travels with the patch', async ({ page, browser }) => {
    await boot(page);
    const filter = filterModule(page);

    // Off by default: an older patch must not even see these controls.
    await expect(filter.getByRole('slider', { name: 'CUTOFF 2', exact: true })).toHaveCount(0);

    await filter.getByRole('button', { name: 'SER' }).click();
    const cutoff2 = filter.getByRole('slider', { name: 'CUTOFF 2', exact: true });
    await expect(cutoff2).toBeVisible();
    await expect(filter.getByRole('slider', { name: 'RES 2', exact: true })).toBeVisible();
    // The blend is the parallel mix, so it is not offered in series.
    await expect(filter.getByRole('slider', { name: 'BLEND', exact: true })).toHaveCount(0);

    await filter.getByRole('button', { name: 'PAR' }).click();
    const blend = filter.getByRole('slider', { name: 'BLEND', exact: true });
    await expect(blend).toBeVisible();
    await expect(blend).toHaveAttribute('aria-valuenow', '0.5');

    const value = await turn(page, 'CUTOFF 2', 40);
    expect(value).toBeGreaterThan(9000);

    // The arrangement and both stages are part of the patch.
    await page.getByRole('button', { name: '预设库' }).click();
    await page.locator('.preset-drawer button', { hasText: '分享' }).first().click();
    await expect.poll(async () => page.evaluate(() => location.hash)).toContain('gs1.');
    const url = await page.evaluate(() => location.href);

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const receiver = await other.newPage();
    await receiver.goto(url);
    await expect
      .poll(async () =>
        Number(await receiver.locator('[data-module-id="filter"] [role="slider"][aria-label="CUTOFF 2"]').getAttribute('aria-valuenow')),
      { timeout: 15_000 })
      .toBeGreaterThan(9000);
    await expect(
      receiver.locator('[data-module-id="filter"] [role="slider"][aria-label="BLEND"]'),
    ).toBeVisible();
    await other.close();
  });
});

test.describe('SEM on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the type and the knob are reachable and big enough to hit', async ({ page }) => {
    await boot(page);
    const filter = filterModule(page);
    await filter.getByRole('button', { name: 'SEM' }).tap();
    const morph = morphKnob(page);
    await expect(morph).toBeVisible();
    const box = (await morph.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(36);
    expect(box.height).toBeGreaterThanOrEqual(36);

    // The module gets busy with a second stage; it still has to fit a thumb.
    await filter.getByRole('button', { name: 'SER' }).tap();
    const cutoff2 = filter.getByRole('slider', { name: 'CUTOFF 2', exact: true });
    await expect(cutoff2).toBeVisible();
    const second = (await cutoff2.boundingBox())!;
    expect(second.width).toBeGreaterThanOrEqual(36);
    expect(second.height).toBeGreaterThanOrEqual(36);
  });
});
