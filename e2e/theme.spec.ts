import { expect, test, type Page } from '@playwright/test';

/**
 * Colour schemes: the light palette must fully repaint every surface, `auto`
 * must follow the operating system live, and the choice must persist.
 */

async function boot(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(250);
}

/** Every rgb() inside a computed background must be light in light mode. */
async function darkSurfaces(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const luminance = (r: number, g: number, b: number) =>
      (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const selectors = [
      'body',
      '.topbar',
      '.preset-display',
      '.panel',
      '.module',
      '.module-body',
      '.display-row',
      '.scope-body',
      '.kbd-dock',
      '.flow-bar',
      '.flow-canvas-wrap',
      '.flow-node',
      '.flow-canvas',
      '.flow-params',
      '.roll',
      '.roll-tools',
      '.roll-scroll',
      '.roll-grid',
      '.roll-kbd',
      '.drawer',
      '.player',
      '.guide',
      '.d-theme',
      '.vu-track',
      '.mini-canvas',
    ];
    const bad: string[] = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      for (const source of [cs.backgroundColor, cs.backgroundImage]) {
        for (const match of source.matchAll(/rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?\)/g)) {
          const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
          const alpha = match[4] === undefined ? 1 : Number(match[4]);
          if (alpha < 0.35) continue; // translucent overlays are fine
          if (luminance(r, g, b) < 0.42) bad.push(`${sel}: rgb(${r},${g},${b})`);
        }
      }
    }
    return bad;
  });
}

test.describe('colour scheme', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('light mode repaints every surface without dark leftovers', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await boot(page);
    // Fresh installs follow the system, which is dark here.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Pin light mode from the preset drawer.
    await page.locator('[data-act="settings"]').click();
    await page.locator('[data-setting="theme"] .d-theme-btn', { hasText: '浅色' }).click();
    await page.locator('.settings-drawer .d-close').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light');

    // Open every surface that paints its own colours before scanning.
    await page.getByRole('button', { name: '信号流' }).click();
    await page.waitForTimeout(700);
    await page.locator('.flow-node[data-node="filter"]').click({ position: { x: 60, y: 46 } });
    await page.waitForTimeout(400);
    expect(await darkSurfaces(page)).toEqual([]);
    await page.locator('.flow-params-close').click();

    await page.locator('.top-actions .tbtn', { hasText: '钢琴卷帘' }).click();
    await page.waitForTimeout(600);
    expect(await darkSurfaces(page)).toEqual([]);
    await page.locator('.roll-head .d-close').click();

    await page.getByRole('button', { name: '模块' }).click();
    await page.waitForTimeout(300);
    await page.locator('.display-row .monitor-actions .demo-btn').click();
    await page.waitForTimeout(400);
    expect(await darkSurfaces(page)).toEqual([]);

    // Text must be dark ink, not light.
    const ink = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.brand-name')!).color,
    );
    const [r, g, b] = ink.match(/\d+/g)!.map(Number);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThan(160);
  });

  test('filled controls keep their contrast in light mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);

    // Colours cross-fade (`.15s` transitions), so a computed style read while
    // the theme is still animating is an interpolated colour: let it settle.
    await page.waitForTimeout(300);

    // WCAG relative luminance + contrast ratio, straight from the spec.
    const contrastOf = (fg: string, bg: string) => {
      const parse = (c: string) => {
        const [r, g, b] = c.match(/[\d.]+/g)!.map(Number);
        const lin = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const a = parse(fg);
      const b = parse(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const ratio = async (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const cs = getComputedStyle(el);
        return [cs.color, cs.backgroundColor] as const;
      });

    // The preset drawer button is a filled control in the top bar.
    const [presetInk, presetBg] = await ratio('.tbtn.primary');
    expect(contrastOf(presetInk, presetBg)).toBeGreaterThan(4.4);

    // So are the transport buttons and the performance badge, in flow view.
    await page.getByRole('button', { name: '信号流' }).click();
    await page.waitForTimeout(600);
    const loop = page.getByRole('button', { name: '循环' });
    await loop.click();
    await page.waitForTimeout(200);
    const [loopInk, loopBg] = await loop.evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.color, cs.backgroundColor] as const;
    });
    expect(contrastOf(loopInk, loopBg)).toBeGreaterThan(4.4);

    // The on-screen keyboard must keep its black keys black in light mode
    // (theme surface variables used to paint them white).
    await page.getByRole('button', { name: '模块' }).click();
    await page.waitForTimeout(300);
    const keyBg = await page
      .locator('.kbd-dock .bkey')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    const keyStops = [...keyBg.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map(
      (m) => (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3,
    );
    expect(Math.min(...keyStops)).toBeLessThan(90);
    // …and the white keys stay light.
    const whiteBg = await page
      .locator('.kbd-dock .wkey')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    const whiteStops = [...whiteBg.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map(
      (m) => (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3,
    );
    expect(Math.max(...whiteStops)).toBeGreaterThan(220);

    await page.getByRole('button', { name: '信号流' }).click();
    await page.waitForTimeout(600);
    const badge = page.locator('.flow-badge').first();
    if (await badge.count()) {
      const [badgeInk, badgeBg] = await badge.evaluate((el) => {
        const cs = getComputedStyle(el);
        return [cs.color, cs.backgroundColor] as const;
      });
      expect(contrastOf(badgeInk, badgeBg)).toBeGreaterThan(4.4);
    }
  });

  test('auto follows the system live, and the choice persists', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // The operating system switches while the app is open.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Pin dark, then reload: the pinned choice wins over the system.
    await page.locator('[data-act="settings"]').click();
    await page.locator('[data-setting="theme"] .d-theme-btn', { hasText: '深色' }).click();
    await page.locator('.settings-drawer .d-close').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await page.waitForTimeout(600);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the overflow menu cycles dark → light → auto', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);
    // Fresh install is auto → light with a light system preference. The cycle
    // is auto → dark → light → auto.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('.top-more .tbtn').click();
    await page.locator('.top-menu .tbtn', { hasText: '自动' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.locator('.top-more .tbtn').click();
    await page.locator('.top-menu .tbtn', { hasText: '深色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.locator('.top-more .tbtn').click();
    await page.locator('.top-menu .tbtn', { hasText: '浅色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Back to auto, still light because the system is light.
    await page.locator('.top-more .tbtn').click();
    await expect(page.locator('.top-menu .tbtn', { hasText: '自动' })).toBeVisible();
  });
});
