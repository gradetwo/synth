import { expect, test } from '@playwright/test';

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
