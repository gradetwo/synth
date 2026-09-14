import { expect, test, type Page } from './fixtures';

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

    // Opening the library from the overflow menu closes the menu first, so it
    // cannot float over the drawer.
    await page.locator('.top-more .tbtn').click();
    await expect(page.locator('.top-menu')).toBeVisible();
    await page.locator('.top-menu .tbtn', { hasText: '预设库' }).click();
    await expect(page.locator('.top-menu')).toHaveCount(0);
    await expect(page.locator('.drawer.open')).toBeVisible();
    await page.locator('.preset-drawer .d-close').click();
    await expect(page.locator('.drawer.open')).toHaveCount(0);

    // Phone chrome: the patch name gets a full row of its own (no more "Re…"),
    // and the modules / signal-flow switch sits on the row below it so nothing
    // is squeezed or clipped.
    const rows = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        const b = el.getBoundingClientRect();
        return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width), el };
      };
      const name = document.querySelector('.preset-name') as HTMLElement;
      return {
        preset: r('.preset-ctrl'),
        view: r('.view-row'),
        truncated: name.scrollWidth > name.clientWidth + 1,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(rows.truncated).toBe(false);
    expect(rows.view.y).toBeGreaterThanOrEqual(rows.preset.y + rows.preset.h - 4);
    expect(rows.overflow).toBeLessThanOrEqual(1);

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

    // Secondary chrome yields to the graph: the monitor row is hidden and the
    // dock starts tucked away.
    await expect(page.locator('.display-row')).toBeHidden();
    await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
    await expect(page.locator('.dock-show')).toBeVisible();

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

    // The show-keyboard pill still works and the canvas makes room for it.
    await page.locator('.dock-show').tap();
    await expect(page.locator('.kbd-dock.open')).toBeVisible();
    const withDock = await page.evaluate(() => {
      const wrap = document.querySelector('.flow-canvas-wrap')!.getBoundingClientRect();
      const spacer = document.querySelector('.dock-spacer')!.getBoundingClientRect();
      return { bottom: Math.round(wrap.bottom), spacerTop: Math.round(spacer.top) };
    });
    expect(withDock.bottom).toBeLessThanOrEqual(withDock.spacerTop + 2);

    // Going back to modules brings the monitor strip back.
    await page.getByRole('button', { name: '模块' }).tap();
    await expect(page.locator('.display-row.compact')).toBeVisible();
    await expect(page.locator('.kbd-dock.open')).toBeVisible();
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

  test('two rows of chrome, two module columns, compact strip with meters', async ({ page }) => {
    await boot(page, true);
    const m = await metrics(page);
    expect(m.compactTop).toBe(true);
    expect(m.compactDisplay).toBe(true);
    expect(m.brandText).toBe(true); // tablets keep the wordmark
    expect(m.scope).toBe(false);
    expect(m.collapsed).toBe(0); // modules stay expanded on tablets
    expect(m.moduleCols).toBe(2);
    expect(m.displayCols).toBe(0); // compact strip is a flex row

    // The preset stepper owns the second row and the name is never clipped.
    const rows = await page.evaluate(() => {
      const r = (sel: string) => {
        const b = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
        return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) };
      };
      const name = document.querySelector('.preset-name') as HTMLElement;
      return {
        brand: r('.brand'),
        preset: r('.preset-ctrl'),
        vw: window.innerWidth,
        truncated: name.scrollWidth > name.clientWidth + 1,
      };
    });
    expect(rows.preset.y).toBeGreaterThanOrEqual(rows.brand.y + rows.brand.h - 2);
    expect(rows.preset.w).toBeGreaterThan(rows.vw * 0.9);
    expect(rows.truncated).toBe(false);

    // The wide strip carries the live waveform and spectrum.
    await expect(page.locator('.display-row.compact.has-meters .strip-scope')).toBeVisible();
    await expect(page.locator('.display-row.compact.has-meters .strip-spec')).toBeVisible();
  });
});

test.describe('iPad landscape', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test('inline actions with the preset on its own row, three module columns', async ({ page }) => {
    await boot(page, true);
    const m = await metrics(page);
    expect(m.compactTop).toBe(false);
    expect(m.moduleCols).toBe(3);
    expect(m.compactDisplay).toBe(true);

    // Inline action row: no overflow menu, and the preset row is full width.
    await expect(page.locator('.top-more')).toHaveCount(0);
    const rows = await page.evaluate(() => {
      const r = (sel: string) => {
        const b = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
        return { y: Math.round(b.y), h: Math.round(b.height), w: Math.round(b.width) };
      };
      const name = document.querySelector('.preset-name') as HTMLElement;
      return {
        brand: r('.brand'),
        preset: r('.preset-ctrl'),
        vw: window.innerWidth,
        truncated: name.scrollWidth > name.clientWidth + 1,
      };
    });
    expect(rows.preset.y).toBeGreaterThanOrEqual(rows.brand.y + rows.brand.h - 2);
    expect(rows.preset.w).toBeGreaterThan(rows.vw * 0.9);
    expect(rows.truncated).toBe(false);

    // Expanding the strip brings the full three-panel monitor row back.
    await page.locator('.display-row.compact .display-toggle').click();
    await expect(page.locator('.scope-body')).toBeVisible();
    expect(await page.locator('.display-row').evaluate((el) => getComputedStyle(el).display)).toBe('grid');
    await page.locator('.display-bar .display-toggle').click();
    await expect(page.locator('.display-row.compact')).toBeVisible();
  });
});

test.describe('iPad flow view', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('portrait uses three columns and gives the graph the screen', async ({ page }) => {
    await boot(page, true);
    await page.getByRole('button', { name: '信号流' }).tap();
    await page.waitForTimeout(600);
    await expect(page.locator('.display-row')).toBeHidden();
    const geo = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.flow-node')].map((n) => n.getBoundingClientRect());
      const wrap = document.querySelector('.flow-canvas-wrap')!.getBoundingClientRect();
      const scale = document.querySelector('.flow-scale')!.getBoundingClientRect();
      return {
        rows: new Set(nodes.map((b) => Math.round(b.y))).size,
        cols: new Set(nodes.map((b) => Math.round(b.x))).size,
        wrapH: Math.round(wrap.height),
        scaleH: Math.round(scale.height),
        bottom: Math.round(wrap.bottom),
        vh: window.innerHeight,
      };
    });
    expect(geo.cols).toBe(3);
    expect(geo.rows).toBe(4);
    // Everything fits on one screen and the canvas reaches the bottom.
    expect(geo.scaleH).toBeLessThanOrEqual(geo.wrapH + 2);
    expect(geo.bottom).toBeGreaterThan(geo.vh - 260);
  });

  test('landscape uses five columns in two rows', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await boot(page, true);
    await page.getByRole('button', { name: '信号流' }).tap();
    await page.waitForTimeout(600);
    const geo = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.flow-node')].map((n) => n.getBoundingClientRect());
      const wrap = document.querySelector('.flow-canvas-wrap')!.getBoundingClientRect();
      const scale = document.querySelector('.flow-scale')!.getBoundingClientRect();
      return {
        rows: new Set(nodes.map((b) => Math.round(b.y))).size,
        cols: new Set(nodes.map((b) => Math.round(b.x))).size,
        wrapH: Math.round(wrap.height),
        scaleH: Math.round(scale.height),
      };
    });
    expect(geo.cols).toBe(5);
    expect(geo.rows).toBe(2);
    expect(geo.scaleH).toBeLessThanOrEqual(geo.wrapH + 2);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('full chrome, four module columns and a readable preset name', async ({ page }) => {
    await boot(page, false);
    const m = await metrics(page);
    expect(m.compactTop).toBe(false);
    expect(m.compactDisplay).toBe(false);
    expect(m.moduleCols).toBe(4);
    expect(m.displayCols).toBe(3);
    expect(m.collapsed).toBe(0); // modules default to all expanded
    // The monitor only keeps the player entry (the WAV button was removed).
    await expect(page.locator('.monitor-actions .demo-btn')).toHaveCount(1);
    await expect(page.locator('.monitor-actions')).not.toContainText('WAV');

    // Secondary actions moved into the overflow menu so the preset name fits.
    await expect(page.locator('.top-actions .top-more')).toHaveCount(1);
    const truncated = await page.locator('.preset-name').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(truncated).toBe(false);
    // The decorative power light and engine badge were removed.
    await expect(page.locator('.power-btn, .engine-badge')).toHaveCount(0);
    // Using an overflow action closes the menu instead of leaving it floating
    // over the page.
    await page.locator('.top-more .tbtn').click();
    await expect(page.locator('.top-menu')).toBeVisible();
    await page.locator('.top-menu .tbtn', { hasText: '保存' }).click();
    await expect(page.locator('.top-menu')).toHaveCount(0);
  });

  test('a phone-sized visit does not leave the desktop modules collapsed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page, false);
    await page.waitForTimeout(400);
    expect(await page.locator('.module.collapsed').count()).toBe(4);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(600);
    expect(await page.locator('.module.collapsed').count()).toBe(0);
  });
});
