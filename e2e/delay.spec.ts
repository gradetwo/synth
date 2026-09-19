import { expect, test } from './fixtures';

/**
 * Delay controls (A5).
 *
 * The DSP tests cover what the repeats sound like; this covers the switch the
 * player actually flips, and that the choice travels with the patch.
 */

test.describe('delay', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('offers ping-pong and damping, and remembers them', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);

    const fx = page.locator('[data-module-id="fx"]');
    const ping = fx.locator('[data-setting="delayPingPong"]');
    await expect(ping).toBeVisible();
    await expect(ping).toHaveAttribute('aria-pressed', 'false');

    // Default damping is not zero: repeats lose their top end out of the box.
    // The reverb unit has a DAMP knob too, so scope to the delay unit.
    await expect(
      fx.locator('[data-unit="delay"]').getByRole('slider', { name: 'DAMP' }),
    ).toBeVisible();

    await ping.click();
    await expect(ping).toHaveAttribute('aria-pressed', 'true');
    await expect(ping).toHaveClass(/on/);

    // Patches carry the switch, so a reload keeps it.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-module-id="fx"] [data-setting="delayPingPong"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
