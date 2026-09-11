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
    await expect(panel.locator('.settings-section')).toHaveCount(5);
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

test.describe('two instances', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('switches which timbre the panels edit, and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('[data-act="settings"]').click();
    const panel = page.locator('.settings-drawer.open');
    const instances = panel.locator('[data-section="instances"]');
    await expect(instances).toBeVisible();
    // Instance 1 is what the panels edit by default.
    await expect(instances.locator('[data-instance="1"]')).toHaveAttribute('aria-pressed', 'true');

    await instances.locator('[data-instance="2"]').click();
    await expect(instances.locator('[data-instance="2"]')).toHaveAttribute('aria-pressed', 'true');
    await panel.locator('[data-setting="route"] select').selectOption('layer');
    await expect(panel.locator('[data-setting="route"] select')).toHaveValue('layer');
    await panel.locator('.d-close').click();
    await expect(panel).not.toBeVisible();

    // Both are workspace state, so a reload brings them back.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('[data-setting="route"] select')).toHaveValue('layer');
    await expect(page.locator('[data-instance="2"]')).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * Patch files arrive through the drawer's importer, which parses JSON the user
 * downloaded. Junk has to be refused with a message instead of a broken patch.
 */
test.describe('patch file import', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('imports a .gs1.json patch and refuses junk', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '预设库' }).click();

    const input = page.locator('input[accept=".json,application/json"]');
    await input.setInputFiles({
      name: 'my-patch.gs1.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'gs1-preset',
          name: 'From a file',
          params: { '14': 900, '15': 0.42 },
        }),
      ),
    });
    await expect(page.locator('.toast')).toContainText('已导入音色文件');
    // The patch is live: the top bar names the file it came from.
    await expect(page.locator('.preset-name')).toContainText('From a file');

    // A file that is not a patch is refused, and the patch stays where it was.
    await input.setInputFiles({
      name: 'junk.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"something-else"}'),
    });
    await expect(page.locator('.toast')).toContainText('文件格式无法识别');
    await expect(page.locator('.preset-name')).toContainText('From a file');
  });
});
