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
    await page.locator('[data-act="settings"]').click();
    await page.getByRole('button', { name: '打开音频设置' }).click();

    const panel = page.locator('.audio-settings.open');
    await expect(panel).toBeVisible();
    // The browser really gave us a rate and a latency figure.
    await expect(panel).toContainText('kHz');
    await expect(panel).toContainText('ms');
    await expect(panel).toContainText('simd');
    // MIDI output is offered (disabled here: a headless browser has no ports).
    await expect(panel).toContainText('MIDI 输出');
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
    const wasmTypes: string[] = [];
    page.on('request', (request) => {
      if (/synth_core.*\.wasm/.test(request.url())) wasmRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (/synth_core.*\.wasm/.test(response.url())) {
        wasmTypes.push(response.headers()['content-type'] ?? '');
      }
    });
    await page.goto('/');
    // No click yet: warming the audio path is what makes the first tap cheap.
    await expect.poll(() => wasmRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(500);
    // Starting must reuse the preloaded bytes, not fetch them a second time.
    expect(wasmRequests.length).toBe(1);
    // `application/wasm` is what lets the browser compile the core while it is
    // still downloading (P0.6); anything else silently costs startup time.
    for (const type of wasmTypes) {
      expect(type).toContain('application/wasm');
    }
    expect(wasmTypes.length).toBeGreaterThan(0);
    // And the engine reports that it took the streaming path: the audio
    // settings panel shows the core as `simd · streamed`.
    await page.locator('[data-act="settings"]').click();
    await page.getByRole('button', { name: '打开音频设置' }).click();
    await expect(page.locator('.audio-settings.open')).toContainText('流式编译');
  });
});

test.describe('microtuning', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('offers temperaments in the drawer and remembers the choice', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    const select = page.locator('[data-setting="temperament"] select');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveCount(4);
    await select.selectOption('just');
    await expect(select).toHaveValue('just');

    // The choice survives a reload, which is what "remembers" means here.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '预设库' }).click();
    await expect(page.locator('[data-setting="temperament"] select')).toHaveValue('just');
  });
});

test.describe('MIDI CC mapping', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('arms learn, shows the waiting state and clears a mapping', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('[data-act="settings"]').click();
    await page.getByRole('button', { name: '打开音频设置' }).click();
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
    await expect(page.locator('[data-setting="temperament"] select')).toHaveValue('custom');
    await expect(page.locator('[data-setting="temperament"] select option:checked')).toContainText('19 equal');

    // The imported scale survives a reload.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '预设库' }).click();
    await expect(page.locator('[data-setting="temperament"] select')).toHaveValue('custom');
  });
});

test.describe('MPE input', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('toggles MPE and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('[data-act="settings"]').click();
    await page.getByRole('button', { name: '打开音频设置' }).click();
    const panel = page.locator('.audio-settings.open');
    // Several rows share the toggle style; address this one by its setting id.
    const toggle = panel.locator('[data-setting="mpe"] input');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.locator('[data-act="settings"]').click();
    await page.getByRole('button', { name: '打开音频设置' }).click();
    await expect(page.locator('.audio-settings.open [data-setting="mpe"] input')).toBeChecked();
  });
});

test.describe('velocity curve', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('switches the live velocity curve and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    const select = page.locator('[data-setting="velocity"] select');
    await expect(select).toHaveValue('linear');
    await select.selectOption('soft');
    await expect(page.locator('.toast')).toContainText('柔和');
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '预设库' }).click();
    await expect(page.locator('[data-setting="velocity"] select')).toHaveValue('soft');
  });
});

test.describe('workspace scenes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('saves a scene, changes the workspace, and recalls it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('[data-act="settings"]').click();
    // Save the current workspace (modules view, all expanded).
    await page.locator('[data-setting="scene"] button', { hasText: '保存当前' }).click();
    await page.locator('.settings-drawer .d-close').click();

    // Change it: switch to the signal-flow view.
    await page.getByRole('button', { name: '信号流' }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-view', 'flow');

    // Recall the scene through the settings and the view comes back.
    await page.locator('[data-act="settings"]').click();
    await page.locator('[data-setting="scene"] select').selectOption({ index: 1 });
    await page.locator('.settings-drawer .d-close').click();
    await expect(page.locator('.app')).toHaveAttribute('data-view', 'modules');
  });
});
