import { expect, test } from './fixtures';

/**
 * Effect chain reordering (A5).
 *
 * The DSP tests cover what the order does to the sound; this covers the control
 * the player uses, and that a reorder and a parallel send both survive a reload
 * because they live in the patch.
 */

const chips = (page: import('@playwright/test').Page) =>
  page.locator('[data-module-id="fx"] [data-unit="chain"] .fx-chip');

const names = (page: import('@playwright/test').Page) =>
  chips(page).locator('.fx-chip-name').allTextContents();

test.describe('effect chain', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('reorders the chain and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);

    await expect(chips(page)).toHaveCount(6);
    expect(await names(page)).toEqual([
      'DELAY',
      'REVERB',
      'CHORUS',
      'FLANGER',
      'PHASER',
      'DRIVE',
    ]);
    // The first position cannot move earlier, the last cannot move later.
    await expect(chips(page).first().locator('[data-act="left"]')).toBeDisabled();
    await expect(chips(page).last().locator('[data-act="right"]')).toBeDisabled();

    // Move DELAY later twice: it should end up third, behind REVERB and CHORUS.
    await chips(page).first().locator('[data-act="right"]').click();
    expect(await names(page)).toEqual([
      'REVERB',
      'DELAY',
      'CHORUS',
      'FLANGER',
      'PHASER',
      'DRIVE',
    ]);
    await chips(page).nth(1).locator('[data-act="right"]').click();
    expect(await names(page)).toEqual([
      'REVERB',
      'CHORUS',
      'DELAY',
      'FLANGER',
      'PHASER',
      'DRIVE',
    ]);

    // Reordering is a swap, so no effect can be lost or doubled: six chips
    // before, six distinct effects after.
    expect(await names(page)).toEqual([
      'REVERB',
      'CHORUS',
      'DELAY',
      'FLANGER',
      'PHASER',
      'DRIVE',
    ]);

    // A send switch exists on the insert effects but not on delay/reverb.
    const chorus = chips(page).filter({ hasText: 'CHORUS' }).first();
    const send = chorus.locator('[data-act="parallel"]');
    await expect(send).toHaveAttribute('aria-pressed', 'false');
    await send.click();
    await expect(send).toHaveAttribute('aria-pressed', 'true');
    await expect(chips(page).filter({ hasText: 'REVERB' }).first().locator('[data-act="parallel"]')).toHaveCount(0);

    // Everything here is patch state, so a reload keeps it.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    expect(await names(page)).toEqual([
      'REVERB',
      'CHORUS',
      'DELAY',
      'FLANGER',
      'PHASER',
      'DRIVE',
    ]);
    await expect(
      chips(page).filter({ hasText: 'CHORUS' }).first().locator('[data-act="parallel"]'),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * Impulse-response reverb (A5).
 *
 * The DSP tests prove the convolution; this proves the player can get a file
 * into it and that the choice sticks.
 */
test.describe('impulse response reverb', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('imports a response and uses it as the reverb', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);

    const unit = page.locator('[data-module-id="fx"] [data-unit="reverb"]');
    // Algorithmic by default: the size/damping controls, no import row.
    await expect(unit.locator('[data-unit="ir"]')).toHaveCount(0);
    await unit.locator('[data-setting="reverbMode1"]').click();
    const row = unit.locator('[data-unit="ir"]');
    await expect(row).toBeVisible();
    await expect(row.locator('[data-act="name"]')).toHaveText('未导入');
    // DAMP is an algorithmic control and is gone in IR mode; TRIM replaces it.
    await expect(unit.getByRole('slider', { name: 'DAMP' })).toHaveCount(0);
    await expect(row.getByRole('slider', { name: 'TRIM' })).toBeVisible();

    // A decaying noise burst as a 16-bit WAV, built here so the repo stays free
    // of binary fixtures.
    const length = 8192;
    const wav = Buffer.alloc(44 + length * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(96000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(length * 2, 40);
    let seed = 99;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const value = (seed / 0x3fffffff - 1) * Math.exp(-i / 1500);
      wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
    }

    await row.locator('input[type=file]').setInputFiles({
      name: 'hall.wav',
      mimeType: 'audio/wav',
      buffer: wav,
    });
    await expect(row.locator('[data-act="name"]')).toHaveText('hall.wav');
    await expect(page.locator('.toast')).toContainText('已导入 IR hall.wav');

    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    const reloaded = page.locator('[data-module-id="fx"] [data-unit="ir"]');
    await expect(reloaded.locator('[data-act="name"]')).toHaveText('hall.wav');
    await reloaded.locator('[data-act="clear"]').click();
    await expect(reloaded.locator('[data-act="name"]')).toHaveText('未导入');
  });
});
