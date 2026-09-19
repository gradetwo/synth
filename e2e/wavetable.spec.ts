import { expect, test } from './fixtures';

/**
 * Imported single-cycle wavetable (A6.2).
 *
 * The unit tests cover the analysis; this covers the path a player actually
 * takes — pick the wavetable wave, choose a file, hear it described back,
 * reload, and still have it.
 */

/** A one-cycle 16-bit PCM WAV, built here so the repo carries no binary. */
function cycleWav(period = 2048): Buffer {
  const samples = new Int16Array(period);
  for (let i = 0; i < period; i++) {
    // A saw: easy to recognise, and clearly not any factory bank.
    samples[i] = Math.round(((2 * (i / period) - 1) * 0.9) * 32767);
  }
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(88200, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(samples[i], 44 + i * 2);
  return buffer;
}

test.describe('imported wavetable', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('imports a cycle, switches to it, and keeps it across a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);

    const osc = page.locator('[data-module-id="osc1"]');
    // The wavetable wave is the last button in the wave selector.
    await osc.locator('.wave-btn').nth(8).click();
    const row = osc.locator('.wt-row');
    await expect(row).toBeVisible();
    await expect(row.locator('[data-act="name"]')).toHaveText('未导入');
    // Nothing to use yet, so the switch is not offered as usable.
    await expect(row.locator('[data-act="use"]')).toBeDisabled();

    await row.locator('input[type=file]').setInputFiles({
      name: 'saw-cycle.wav',
      mimeType: 'audio/wav',
      buffer: cycleWav(),
    });

    // Importing says what it took in and turns the switch on: the player asked
    // for this waveform, so leaving the patch playing a factory bank would be
    // a silent no-op.
    await expect(row.locator('[data-act="name"]')).toHaveText('saw-cycle.wav');
    await expect(row.locator('[data-act="use"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(row.locator('[data-act="use"]')).toHaveClass(/on/);
    await expect(page.locator('.toast')).toContainText('已导入波形 saw-cycle.wav');

    // A note still plays, and the console stays clean through the import.
    await page.keyboard.press('a');
    await page.waitForTimeout(300);

    // The waveform is instrument state: a reload must bring it back, on both
    // oscillators (they share one imported cycle).
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    const reloaded = page.locator('[data-module-id="osc1"] .wt-row');
    await expect(reloaded.locator('[data-act="name"]')).toHaveText('saw-cycle.wav');
    await expect(reloaded.locator('[data-act="use"]')).toHaveAttribute('aria-pressed', 'true');

    // Removing it puts the row back and stops asking for a table that is gone.
    await reloaded.locator('[data-act="clear"]').click();
    await expect(reloaded.locator('[data-act="name"]')).toHaveText('未导入');
    await expect(reloaded.locator('[data-act="use"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(reloaded.locator('[data-act="use"]')).toBeDisabled();
  });

  test('reports a file that holds no waveform', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    const osc = page.locator('[data-module-id="osc1"]');
    await osc.locator('.wave-btn').nth(8).click();
    const row = osc.locator('.wt-row');
    // A silent WAV decodes fine and is still not a waveform: keep the header,
    // zero the samples.
    const silent = cycleWav();
    silent.fill(0, 44);
    await row.locator('input[type=file]').setInputFiles({
      name: 'silence.wav',
      mimeType: 'audio/wav',
      buffer: silent,
    });
    await expect(page.locator('.toast')).toContainText('没有声音');
    await expect(row.locator('[data-act="name"]')).toHaveText('未导入');
  });
});
