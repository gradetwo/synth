import { expect, test } from '@playwright/test';

/**
 * Touch-model regression: a coarse-pointer device must get the touch gesture
 * hints (no Shift / wheel wording), a single-line hint under the keyboard and
 * long-press fine-tune on knobs.
 */
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

test('touch device gets touch gestures, not mouse hints', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).tap();

  // The dock switches to the touch model.
  const dock = page.locator('.kbd-dock.open');
  await expect(dock).toHaveClass(/touch/);

  // One-line touch hint is shown and never mentions mouse-only gestures.
  const hint = dock.locator('.kbd-hint');
  await expect(hint).toBeVisible();
  await expect(hint).not.toContainText('Shift');
  await expect(hint).not.toContainText('滚轮');

  // The four-line desktop tip list stays hidden on phones.
  await expect(dock.locator('.kbd-tips')).toBeHidden();

  // Long-pressing a knob enters fine-tune mode; releasing leaves it.
  const dial = page.locator('.knob .knob-dial').first();
  const box = await dial.boundingBox();
  expect(box).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  const opts = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y };

  await dial.dispatchEvent('pointerdown', opts);
  await page.waitForTimeout(400);
  await dial.dispatchEvent('pointermove', { ...opts, clientY: y - 24 });
  await expect(page.locator('.knob.fine')).toHaveCount(1);
  await expect(page.locator('.knob-tip-fine')).toHaveText('微调');

  await dial.dispatchEvent('pointerup', opts);
  await expect(page.locator('.knob.fine')).toHaveCount(0);
});
