import { expect, test } from '@playwright/test';

/**
 * Preset library and settings drawers.
 *
 * The settings used to be pinned to the bottom of the preset library, where they
 * grew a control at a time into a ragged wall that also took a fixed slice of the
 * list. They are their own entry now; these assertions pin both halves of that.
 */
test.describe('drawers', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('keeps the preset list whole and the settings out of its way', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    await page.waitForTimeout(400);

    // Every preset is rendered, and the library's own footer is just the patch
    // file actions: three equal buttons and nothing else.
    expect(await page.locator('.d-list .pcard').count()).toBeGreaterThan(20);
    const actions = page.locator('.preset-actions > .d-reset');
    await expect(actions).toHaveCount(3);
    await expect(page.locator('.d-foot-actions > label')).toHaveCount(0);
    const widths = await actions.evaluateAll((buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
    );
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  });

  test('gives the settings their own grouped panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    // Same level as the preset library: a top-bar entry of its own.
    await page.locator('[data-act="settings"]').click();
    const panel = page.locator('.settings-drawer.open');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.settings-section')).toHaveCount(4);
    await expect(panel).toContainText('工作区');
    await expect(panel).toContainText('演奏');
    await expect(panel).toContainText('界面');

    // Controls are sized to their content, not stretched to fill a column: a
    // select that shows three characters does not need the whole drawer width.
    const select = panel.locator('select').first();
    const box = (await select.boundingBox())!;
    const drawer = (await panel.boundingBox())!;
    expect(box.width).toBeLessThan(drawer.width * 0.6);

    // And they still work: the audio panel opens from here.
    await panel.getByRole('button', { name: '打开音频设置' }).click();
    await expect(page.locator('.audio-settings.open')).toBeVisible();
  });
});
