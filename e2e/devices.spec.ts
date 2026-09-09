import { expect, test, type Page } from '@playwright/test';

/**
 * Device-aware chrome: phones get a compact top bar, a single-strip monitor and
 * collapsed secondary modules; tablets and desktops keep the full layout.
 */

async function boot(page: Page, touch: boolean) {
  await page.goto('/');
  const start = page.getByRole('button', { name: /启动音频引擎/ });
  if (touch) await start.tap();
  else await start.click();
  await page.waitForTimeout(250);
}

const metrics = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.modules-grid')!;
    const display = document.querySelector('.display-row')!;
    return {
      compactTop: !!document.querySelector('.topbar.compact'),
      compactDisplay: !!document.querySelector('.display-row.compact'),
      brandText: !!document.querySelector('.brand-text'),
      more: !!document.querySelector('.top-more'),
      scope: !!document.querySelector('.scope-body'),
      collapsed: document.querySelectorAll('.module.collapsed').length,
      moduleCols: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      displayCols: getComputedStyle(display).display === 'grid'
        ? getComputedStyle(display).gridTemplateColumns.split(' ').filter(Boolean).length
        : 0,
    };
  });

test.describe('iPhone portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('compact chrome, overflow menu and expandable monitor', async ({ page }) => {
    await boot(page, true);
    const m = await metrics(page);
    expect(m.compactTop).toBe(true);
    expect(m.compactDisplay).toBe(true);
    expect(m.brandText).toBe(false);
    expect(m.more).toBe(true);
    expect(m.scope).toBe(false);
    expect(m.collapsed).toBe(4); // lfo, matrix, fx, fx2
    expect(m.moduleCols).toBe(1);
    // The player stays reachable from the compact strip.
    await expect(page.locator('.display-row.compact .player-open')).toBeVisible();

    // The preset stepper sits on its own full-width row.
    const rows = await page.evaluate(() => {
      const r = (sel: string) => {
        const b = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
        return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) };
      };
      return { brand: r('.brand'), preset: r('.preset-ctrl'), vw: window.innerWidth };
    });
    expect(rows.preset.y).toBeGreaterThanOrEqual(rows.brand.y + rows.brand.h - 2);
    expect(rows.preset.w).toBeGreaterThan(rows.vw - 30);

    // Overflow menu exposes the secondary actions.
    await page.locator('.top-more .tbtn').click();
    await expect(page.locator('.top-menu')).toBeVisible();
    await expect(page.locator('.top-menu')).toContainText('预设库');
    await page.keyboard.press('Escape');

    // Expanding the monitor brings the scope/spectrum back, with a collapse
    // control pinned at the top of the row (no scrolling required).
    await page.locator('.display-toggle').first().click();
    await expect(page.locator('.display-row.compact')).toHaveCount(0);
    await expect(page.locator('.scope-body')).toBeVisible();
    const bar = await page.evaluate(() => {
      const b = (document.querySelector('.display-bar') as HTMLElement).getBoundingClientRect();
      const scope = (document.querySelector('.scope-panel') as HTMLElement).getBoundingClientRect();
      return { barY: Math.round(b.y), scopeY: Math.round(scope.y) };
    });
    expect(bar.barY).toBeLessThan(bar.scopeY);
    await page.locator('.display-bar .display-toggle').click();
    await expect(page.locator('.display-row.compact')).toBeVisible();
  });
});

test.describe('iPhone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('still a phone: compact chrome and two module columns', async ({ page }) => {
    await boot(page, true);
    const m = await metrics(page);
    expect(m.compactTop).toBe(true);
    expect(m.compactDisplay).toBe(true);
    expect(m.collapsed).toBe(4);
    expect(m.moduleCols).toBeGreaterThanOrEqual(2);
  });
});

test.describe('iPad portrait', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('full chrome with two-column modules and monitor', async ({ page }) => {
    await boot(page, true);
    const m = await metrics(page);
    expect(m.compactTop).toBe(false);
    expect(m.compactDisplay).toBe(false);
    expect(m.brandText).toBe(true);
    expect(m.scope).toBe(true);
    expect(m.collapsed).toBe(0);
    expect(m.moduleCols).toBe(2);
    expect(m.displayCols).toBeGreaterThanOrEqual(2);
  });
});

test.describe('iPad landscape', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test('wide layout with three module columns', async ({ page }) => {
    await boot(page, true);
    const m = await metrics(page);
    expect(m.compactTop).toBe(false);
    expect(m.moduleCols).toBe(3);
    expect(m.displayCols).toBeGreaterThanOrEqual(2);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('full chrome and four module columns', async ({ page }) => {
    await boot(page, false);
    const m = await metrics(page);
    expect(m.compactTop).toBe(false);
    expect(m.compactDisplay).toBe(false);
    expect(m.more).toBe(false);
    expect(m.moduleCols).toBe(4);
    expect(m.displayCols).toBe(3);
    // The monitor only keeps the player entry (the WAV button was removed).
    await expect(page.locator('.monitor-actions .demo-btn')).toHaveCount(1);
    await expect(page.locator('.monitor-actions')).not.toContainText('WAV');
  });
});
