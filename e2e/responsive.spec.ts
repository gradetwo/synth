import { expect, test, type Page } from '@playwright/test';

/**
 * iPhone and iPad, both orientations.
 *
 * The layout switches on the short side of the viewport (`<620` phone, `<900`
 * tablet), so portrait and landscape exercise different code paths, and the
 * compact top bar puts entries behind a menu. These tests boot the app at real
 * device sizes and check the things a wrong breakpoint breaks: the start gate
 * fitting on screen, no sideways scrolling, the settings entry reachable, the
 * drawer fitting, and the keyboard being there.
 */
const DEVICES = [
  { name: 'iPhone portrait', width: 393, height: 852, touch: true },
  { name: 'iPhone landscape', width: 852, height: 393, touch: true },
  { name: 'iPad portrait', width: 820, height: 1180, touch: true },
  { name: 'iPad landscape', width: 1180, height: 820, touch: true },
  { name: 'iPad mini portrait', width: 768, height: 1024, touch: true },
  { name: 'iPad mini landscape', width: 1024, height: 768, touch: true },
];

/** Horizontal overflow is the classic breakpoint failure. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const device of DEVICES) {
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.touch,
      isMobile: device.touch,
    });

    test('boots, fits, and opens the settings', async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto('/');

      // The start gate has to fit the screen it is offered on.
      const start = page.locator('.start-btn');
      await expect(start).toBeVisible();
      const startBox = (await start.boundingBox())!;
      expect(startBox.x).toBeGreaterThanOrEqual(0);
      expect(startBox.y).toBeGreaterThanOrEqual(0);
      expect(startBox.x + startBox.width).toBeLessThanOrEqual(device.width + 1);
      expect(startBox.y + startBox.height).toBeLessThanOrEqual(device.height + 1);

      await start.click();
      await page.waitForTimeout(500);
      expect(await overflow(page), 'no sideways scrolling after start').toBeLessThanOrEqual(1);

      // The settings are their own entry at this size too: inline where the bar
      // has room, behind the overflow menu on phones and portrait tablets.
      const entry = page.locator('[data-act="settings"]').first();
      if (!(await entry.isVisible())) {
        await page.locator('.top-more > .tbtn.icon').first().click();
      }
      await expect(entry).toBeVisible();
      await entry.click();
      const panel = page.locator('.settings-drawer.open');
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(device.width + 1);
      // Every section is there, and nothing inside pushes the drawer sideways.
      await expect(panel.locator('.settings-section')).toHaveCount(4);
      expect(await overflow(page), 'no sideways scrolling with the drawer open').toBeLessThanOrEqual(1);

      await panel.locator('.d-close').click();
      await expect(panel).not.toBeVisible();

      // The keyboard is the one control that must never be off screen.
      const keyboard = page.locator('.keyboard, .kbd-dock').first();
      await expect(keyboard).toBeVisible();
      const keys = (await keyboard.boundingBox())!;
      expect(keys.y + keys.height).toBeLessThanOrEqual(device.height + 1);
    });
  });
}
