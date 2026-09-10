import { expect, test } from '@playwright/test';

/**
 * Audio settings panel + the background preload: the panel is the place a
 * "why does it sound like that on my device" question gets answered, and the
 * preload is what makes the first tap cheap.
 */

test.describe('audio settings', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('reports the live engine numbers and pins the polyphony', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '预设库' }).click();
    await page.getByRole('button', { name: '音频设置', exact: true }).click();

    const panel = page.locator('.audio-settings.open');
    await expect(panel).toBeVisible();
    // The browser really gave us a rate and a latency figure.
    await expect(panel).toContainText('kHz');
    await expect(panel).toContainText('ms');
    await expect(panel).toContainText('simd');
    await expect(panel.locator('.audio-row')).toHaveCount(6);

    // Pinning the polyphony goes through the store to the engine.
    await panel.locator('.audio-poly-seg .seg-btn', { hasText: '8' }).click();
    await expect(panel.locator('.audio-poly-seg .seg-btn.active')).toHaveText('8');
    await expect(page.locator('.poly-badge')).toContainText('POLY 8');

    // Escape closes it like the other panels.
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
  });

  test('preloads the DSP core before the start gesture', async ({ page }) => {
    const wasmRequests: string[] = [];
    page.on('request', (request) => {
      if (/synth_core.*\.wasm/.test(request.url())) wasmRequests.push(request.url());
    });
    await page.goto('/');
    // No click yet: warming the audio path is what makes the first tap cheap.
    await expect.poll(() => wasmRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(500);
    // Starting must reuse the preloaded bytes, not fetch them a second time.
    expect(wasmRequests.length).toBe(1);
  });
});

test.describe('microtuning', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('offers temperaments in the drawer and remembers the choice', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    const select = page.locator('.d-temperament select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(4);
    await select.selectOption('just');
    await expect(select).toHaveValue('just');

    // The choice survives a reload, which is what "remembers" means here.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '预设库' }).click();
    await expect(page.locator('.d-temperament select')).toHaveValue('just');
  });
});

test.describe('MIDI CC mapping', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('arms learn, shows the waiting state and clears a mapping', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    await page.getByRole('button', { name: '音频设置', exact: true }).click();
    const panel = page.locator('.audio-settings.open');
    await expect(panel).toContainText('尚未映射任何 CC');

    await panel.locator('.audio-cc-row select').selectOption({ label: 'CUTOFF' });
    await panel.getByRole('button', { name: '学习' }).click();
    await expect(panel.getByRole('button', { name: /等待 CC/ })).toBeVisible();
    // Cancelling leaves nothing bound.
    await panel.getByRole('button', { name: /等待 CC/ }).click();
    await expect(panel.getByRole('button', { name: '学习' })).toBeVisible();
    await expect(panel).toContainText('尚未映射任何 CC');
  });
});

test.describe('Scala scale import', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('imports a .scl file and switches the tuning to it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    const scala = `! 19-EDO\n19 equal\n19\n${Array.from({ length: 19 }, (_, i) =>
      ((i + 1) * 1200 / 19).toFixed(6),
    ).join('\n')}\n`;
    await page.locator('input[type="file"][accept*=".scl"]').setInputFiles({
      name: '19edo.scl',
      mimeType: 'text/plain',
      buffer: Buffer.from(scala),
    });
    await expect(page.locator('.toast')).toContainText('19 equal');
    await expect(page.locator('.d-temperament select')).toHaveValue('custom');
    await expect(page.locator('.d-temperament select option:checked')).toContainText('19 equal');

    // The imported scale survives a reload.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '预设库' }).click();
    await expect(page.locator('.d-temperament select')).toHaveValue('custom');
  });
});

test.describe('MPE input', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('toggles MPE and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    await page.getByRole('button', { name: '音频设置', exact: true }).click();
    const panel = page.locator('.audio-settings.open');
    const toggle = panel.locator('.audio-toggle input');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '预设库' }).click();
    await page.getByRole('button', { name: '音频设置', exact: true }).click();
    await expect(page.locator('.audio-settings.open .audio-toggle input')).toBeChecked();
  });
});

test.describe('velocity curve', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('switches the live velocity curve and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    const select = page.locator('.d-velocity select');
    await expect(select).toHaveValue('linear');
    await select.selectOption('soft');
    await expect(page.locator('.toast')).toContainText('柔和');
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '预设库' }).click();
    await expect(page.locator('.d-velocity select')).toHaveValue('soft');
  });
});
