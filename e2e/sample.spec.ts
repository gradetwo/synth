import { expect, test } from './fixtures';

/**
 * Sampler import (A).
 *
 * The DSP is covered by the Rust tests; this covers the path a player takes —
 * pick the sample wave, import a file, hear it described back — and that the
 * choice survives a reload.
 */

/** A one-second decaying tone as 16-bit PCM at 22.05 kHz. */
function toneWav(rate = 22050, seconds = 0.5, freq = 440): Buffer {
  const length = Math.floor(rate * seconds);
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const value = Math.sin((2 * Math.PI * freq * i) / rate) * Math.exp(-i / (rate * 0.3)) * 0.9;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return buffer;
}

test.describe('sampler', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('imports a sample and plays it from the note', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);

    const osc = page.locator('[data-module-id="osc1"]');
    // The sample wave is the last button in the wave selector.
    await osc.locator('.wave-btn').nth(9).click();
    const row = osc.locator('[data-smp="1"]');
    await expect(row).toBeVisible();
    await expect(row.locator('[data-act="name"]')).toHaveText('未导入');
    // Root note and loop mode are there whether or not a file is loaded.
    await expect(osc.getByRole('slider', { name: 'ROOT' })).toBeVisible();
    await expect(osc.locator('.smp-controls .seg')).toBeVisible();

    await row.locator('input[type=file]').setInputFiles({
      name: 'kick.wav',
      mimeType: 'audio/wav',
      buffer: toneWav(),
    });
    await expect(row.locator('[data-act="name"]')).toHaveText('kick.wav');
    await expect(page.locator('.toast')).toContainText('已导入采样 kick.wav');

    // A note plays without the console filling up with errors.
    await page.keyboard.press('a');
    await page.waitForTimeout(300);

    // The sample is instrument state: a reload brings it back.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    const reloaded = page.locator('[data-module-id="osc1"] [data-smp="1"]');
    await expect(reloaded.locator('[data-act="name"]')).toHaveText('kick.wav');

    await reloaded.locator('[data-act="clear"]').click();
    await expect(reloaded.locator('[data-act="name"]')).toHaveText('未导入');
  });

  test('reports a silent file', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    const osc = page.locator('[data-module-id="osc1"]');
    await osc.locator('.wave-btn').nth(9).click();
    const silent = toneWav();
    silent.fill(0, 44);
    await osc.locator('[data-smp="1"] input[type=file]').setInputFiles({
      name: 'silence.wav',
      mimeType: 'audio/wav',
      buffer: silent,
    });
    await expect(page.locator('.toast')).toContainText('没有声音');
    await expect(osc.locator('[data-smp="1"] [data-act="name"]')).toHaveText('未导入');
  });
});
