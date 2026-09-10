import { expect, test } from '@playwright/test';

/**
 * Preset drawer layout.
 *
 * The settings block grew a control at a time until it was a ragged wall of
 * buttons that also took a fixed slice of the drawer. These assertions are the
 * two things that made it a problem: the rows have to line up, and the preset
 * list must not be squeezed or clipped by them.
 */
test.describe('preset drawer', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('keeps the settings tidy and out of the preset list’s way', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    await page.waitForTimeout(400);

    // Every preset is rendered: the list is not clipped to whatever fitted next
    // to a docked settings block.
    const cards = await page.locator('.d-list .pcard').count();
    expect(cards).toBeGreaterThan(20);

    // The drawer body is the scroller, and the list is not a second one.
    const scroll = await page.evaluate(() => {
      const body = document.querySelector('.d-body') as HTMLElement;
      const list = document.querySelector('.d-list') as HTMLElement;
      return {
        bodyScrolls: body.scrollHeight > body.clientHeight + 50,
        listScrolls: list.scrollHeight > list.clientHeight + 2,
        listBelowFold: list.getBoundingClientRect().height > body.clientHeight,
      };
    });
    expect(scroll.bodyScrolls).toBe(true);
    expect(scroll.listScrolls).toBe(false);
    expect(scroll.listBelowFold).toBe(true);

    // The action buttons share one grid: four to a row, all the same width.
    const widths = await page.locator('.d-foot-actions > .d-reset').evaluateAll((buttons) =>
      buttons.slice(0, 4).map((button) => Math.round(button.getBoundingClientRect().width)),
    );
    expect(widths).toHaveLength(4);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
    // And they sit on one row.
    const tops = await page.locator('.d-foot-actions > .d-reset').evaluateAll((buttons) =>
      buttons.slice(0, 4).map((button) => Math.round(button.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);

    // The settings are reachable and still work.
    await page.locator('.d-foot').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: '音频设置', exact: true }).click();
    await expect(page.locator('.audio-settings.open')).toBeVisible();
  });
});
