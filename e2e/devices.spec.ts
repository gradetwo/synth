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

test.describe('iPhone portrait flow view', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('hands the screen to the graph and restores the chrome on exit', async ({ page }) => {
    await boot(page, true);
    await page.getByRole('button', { name: '信号流' }).tap();
    await page.waitForTimeout(500);

    // Secondary chrome yields to the graph.
    await expect(page.locator('.display-row')).toBeHidden();
    await expect(page.locator('.kbd-dock')).toBeHidden();
    await expect(page.locator('.top-actions .tbtn[data-kb]')).toBeHidden();

    const geo = await page.evaluate(() => {
      const wrap = document.querySelector('.flow-canvas-wrap')!.getBoundingClientRect();
      const scale = document.querySelector('.flow-scale')!.getBoundingClientRect();
      return {
        bottom: Math.round(wrap.bottom),
        vh: window.innerHeight,
        wrapH: Math.round(wrap.height),
        scaleH: Math.round(scale.height),
      };
    });
    // The canvas runs to the bottom of the screen and the graph fits inside it.
    expect(geo.bottom).toBeGreaterThan(geo.vh - 40);
    expect(geo.scaleH).toBeLessThanOrEqual(geo.wrapH + 2);

    // Going back to modules brings the monitor strip and the keyboard back.
    await page.getByRole('button', { name: '模块' }).tap();
    await expect(page.locator('.display-row.compact')).toBeVisible();
    await expect(page.locator('.kbd-dock')).toBeVisible();
  });
});

test.describe('iPhone landscape flow view', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('lays the nodes out in two rows that fit on one screen', async ({ page }) => {
    await boot(page, true);
    await page.getByRole('button', { name: '信号流' }).tap();
    await page.waitForTimeout(700);
    const geo = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.flow-node')].map((n) => n.getBoundingClientRect());
      const wrap = document.querySelector('.flow-canvas-wrap')!.getBoundingClientRect();
      const scale = document.querySelector('.flow-scale')!.getBoundingClientRect();
      return {
        rows: new Set(nodes.map((b) => Math.round(b.y))).size,
        wrapH: Math.round(wrap.height),
        scaleH: Math.round(scale.height),
        bottom: Math.round(wrap.bottom),
        vh: window.innerHeight,
      };
    });
    expect(geo.rows).toBe(2);
    expect(geo.scaleH).toBeLessThanOrEqual(geo.wrapH + 4);
    expect(geo.bottom).toBeLessThanOrEqual(geo.vh);
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
    expect(m.displayCols).toBe(3);

    // The monitor row can still collapse to the phone-style strip.
    await expect(page.locator('.display-bar')).toBeVisible();
    await page.locator('.display-bar .display-toggle').click();
    await expect(page.locator('.display-row.compact')).toBeVisible();
    await page.locator('.display-row.compact .display-toggle').click();
    await expect(page.locator('.scope-body')).toBeVisible();
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
