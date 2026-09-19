import { expect, test, type Page } from './fixtures';

/**
 * English labels must not break a layout sized for Chinese.
 *
 * Chinese labels are two to four glyphs; the same string in English can be twice
 * as wide. Fixed slots therefore ellipsise, rows that run out of room wrap, and
 * nothing pushes the shell sideways.
 */
const CLIPPED_CHECK = `
  (() => {
    const selectors = [
      '.topbar', '.preset-display', '.view-toggle', '.module-head',
      '.settings-section', '.settings-row', '.player-actions', '.layer-row',
    ];
    const bad = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const box = el.getBoundingClientRect();
        if (box.width === 0) continue;
        // A child sticking out of its parent's right edge is the failure;
        // intentional horizontal scrollers are excluded by the overflow test.
        if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible') {
          bad.push(sel);
        }
      }
    }
    return { bad, overflow: document.documentElement.scrollWidth - window.innerWidth };
  })()
`;

/** Open the settings drawer, from the row or from the compact overflow menu. */
async function openSettings(page: Page) {
  if (await page.locator('.settings-drawer.open').isVisible().catch(() => false)) return;
  const entry = page.locator('[data-act="settings"]').first();
  if (!(await entry.isVisible().catch(() => false))) {
    await page.locator('.top-more > .tbtn.icon').first().click();
  }
  await entry.click();
  await expect(page.locator('.settings-drawer.open')).toBeVisible();
}

async function closeSettings(page: Page) {
  const close = page.locator('.settings-drawer.open .d-close');
  if (await close.isVisible().catch(() => false)) await close.click();
  await expect(page.locator('.settings-drawer.open')).toHaveCount(0);
  await page.waitForTimeout(150);
}

for (const size of [
  { name: 'phone portrait', width: 393, height: 852 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`English labels fit — ${size.name}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎|Start Audio Engine/ }).click();
    await page.waitForTimeout(400);

    await openSettings(page);
    await page.locator('.settings-drawer', { hasText: 'EN' }).getByRole('button', { name: 'EN' }).click();
    await closeSettings(page);
    // The view switch is always on screen, in either language.
    await expect(page.locator('.vt-btn', { hasText: 'Modules' }).first()).toBeVisible();

    // The module view first…
    let result = await page.evaluate(CLIPPED_CHECK);
    expect(result.bad, 'module view').toEqual([]);
    expect(result.overflow, 'module view').toBeLessThanOrEqual(1);

    // …then the settings drawer, which carries most of the English text.
    await openSettings(page);
    result = await page.evaluate(CLIPPED_CHECK);
    expect(result.bad, 'settings drawer').toEqual([]);
    expect(result.overflow, 'settings drawer').toBeLessThanOrEqual(1);
    await closeSettings(page);

    // And the preset library, whose names and categories are its own labels.
    const browse = page.locator('.tbtn.primary').first();
    if (!(await browse.isVisible().catch(() => false))) {
      await page.locator('.top-more > .tbtn.icon').first().click();
    }
    await browse.click();
    await expect(page.locator('.preset-drawer.open')).toBeVisible();
    result = await page.evaluate(CLIPPED_CHECK);
    expect(result.overflow, 'preset library').toBeLessThanOrEqual(1);
  });
}
