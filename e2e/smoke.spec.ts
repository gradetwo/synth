import { expect, test } from '@playwright/test';

/**
 * Browser smoke test: boots the built PWA, starts the audio engine, plays a
 * note, exercises the layout chrome and asserts the page stays error-free.
 * (Audio itself is verified by the Node DSP gates; here we verify the browser
 * wiring around it.)
 */
test('boots, starts audio and stays error-free', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/');
  await expect(page).toHaveTitle(/GROOVE SYNTH/);

  const start = page.getByRole('button', { name: /启动音频引擎/ });
  await expect(start).toBeVisible();
  await start.click();
  await expect(start).toBeHidden();

  // Hold middle C: the note display must update.
  const key = page.locator('[data-midi="60"]').first();
  await key.dispatchEvent('pointerdown', { pointerId: 1 });
  await expect(page.locator('.nd-val')).toHaveText('C4');
  await key.dispatchEvent('pointerup', { pointerId: 1 });

  // Hide / show the floating keyboard.
  await page.getByRole('button', { name: '隐藏键盘' }).click();
  await expect(page.locator('.dock-show')).toBeVisible();
  await page.locator('.dock-show').click();
  await expect(page.locator('.kbd-dock.open')).toBeVisible();

  // Collapse a module.
  await page.locator('[data-module-id="osc1"] .module-collapse').click();
  await expect(page.locator('[data-module-id="osc1"]')).toHaveClass(/collapsed/);

  // Preset drawer loads a patch.
  await page.getByRole('button', { name: '预设库' }).click();
  await expect(page.locator('.drawer.open')).toBeVisible();
  await page.locator('.pcard').nth(2).click();
  await expect(page.locator('.pcard.current')).toHaveCount(1);

  // Manifest + service worker registration.
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);

  expect(errors, errors.join('\n')).toEqual([]);
});
