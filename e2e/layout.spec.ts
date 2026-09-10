import { expect, test } from '@playwright/test';

/**
 * Mobile layout regressions: portrait and landscape both give the keyboard the
 * full width, with the gesture hints moved underneath it.
 */

async function boot(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).tap();
  await expect(page.locator('.kbd-dock.open')).toBeVisible();
}

test.describe('phone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('hints sit below the keyboard and the keys span the dock', async ({ page }) => {
    await boot(page);
    const m = await page.evaluate(() => {
      const kb = document.querySelector('.keyboard')!.getBoundingClientRect();
      const hint = document.querySelector('.kbd-hint') as HTMLElement;
      const dock = document.querySelector('.kbd-dock')!.getBoundingClientRect();
      const grid = document.querySelector('.modules-grid')!;
      return {
        kbBottom: kb.bottom,
        kbWidth: kb.width,
        hintTop: hint.getBoundingClientRect().top,
        hintDisplay: getComputedStyle(hint).display,
        tipsDisplay: getComputedStyle(document.querySelector('.kbd-tips')!).display,
        dockWidth: dock.width,
        cols: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      };
    });
    expect(m.hintDisplay).not.toBe('none');
    expect(m.tipsDisplay).toBe('none');
    expect(m.hintTop).toBeGreaterThanOrEqual(m.kbBottom - 1);
    expect(m.kbWidth / m.dockWidth).toBeGreaterThan(0.75);
    expect(m.cols).toBeGreaterThanOrEqual(2);
  });
});

test.describe('iPad portrait', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('tips move below a taller keyboard', async ({ page }) => {
    await boot(page);
    const m = await page.evaluate(() => {
      const kb = document.querySelector('.keyboard')!.getBoundingClientRect();
      const tips = document.querySelector('.kbd-tips') as HTMLElement;
      const hint = document.querySelector('.kbd-hint') as HTMLElement;
      const dock = document.querySelector('.kbd-dock')!.getBoundingClientRect();
      const grid = document.querySelector('.modules-grid')!;
      return {
        kbBottom: kb.bottom,
        kbHeight: kb.height,
        kbWidth: kb.width,
        tipsTop: tips.getBoundingClientRect().top,
        tipsDisplay: getComputedStyle(tips).display,
        hintDisplay: getComputedStyle(hint).display,
        dockWidth: dock.width,
        cols: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      };
    });
    expect(m.tipsDisplay).not.toBe('none');
    expect(m.hintDisplay).toBe('none');
    expect(m.tipsTop).toBeGreaterThanOrEqual(m.kbBottom - 1);
    expect(m.kbHeight).toBeGreaterThanOrEqual(110);
    expect(m.kbWidth / m.dockWidth).toBeGreaterThan(0.7);
    expect(m.cols).toBe(2);
  });
});

test.describe('touch velocity', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('strike position maps to velocity', async ({ page }) => {
    await boot(page);

    // Touch velocity is opt-in: the VEL chip in the keyboard header.
    const vel = page.locator('.vel-btn', { hasText: '力度' });
    await expect(vel).toBeVisible();
    await vel.tap();
    await expect(vel).toHaveClass(/\bon\b/);

    const key = page.locator('.wkey').first();
    const box = await key.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width * 0.25; // left of the key: no black key above

    const readVel = async () => {
      const text = (await page.locator('.nd-sub').textContent()) ?? '';
      return Number(/VEL (\d+)/.exec(text)?.[1] ?? -1);
    };

    await page.touchscreen.tap(x, box!.y + 5);
    const soft = await readVel();
    await page.touchscreen.tap(x, box!.y + box!.height - 5);
    const hard = await readVel();

    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
  });
});

test.describe('undo covers the workspace', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('collapsing a module can be undone from the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    const module = page.locator('.module[data-module-id="filter"]');
    await expect(module).toBeVisible();
    const bodyBefore = await module.locator('.module-body').count();

    await module.locator('.module-collapse').click();
    await expect
      .poll(async () => module.locator('.module-body').count())
      .not.toBe(bodyBefore);

    // Ctrl/Cmd+Z restores the layout, not just the patch.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => module.locator('.module-body').count()).toBe(bodyBefore);
  });

  test('switching views can be undone', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-view', 'modules');
    await page.getByRole('button', { name: '信号流' }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-view', 'flow');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.app')).toHaveAttribute('data-view', 'modules');
  });
});
