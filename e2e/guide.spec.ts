import { expect, test } from '@playwright/test';

async function openGuide(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.getByRole('button', { name: '预设库' }).click();
  await expect(page.locator('.drawer.open')).toBeVisible();
  await page.getByRole('button', { name: '使用指南' }).click();
  await expect(page.locator('.guide.open')).toBeVisible();
}

test.describe('guide (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('opens from the preset drawer and switches sections', async ({ page }) => {
    await openGuide(page);
    const content = page.locator('.guide-content');
    await expect(content).toContainText('振荡器');
    await expect(content).toContainText('滤波器');

    await page.locator('.guide-tab', { hasText: '从零捏一个音色' }).click();
    await expect(content).toContainText('Pluck Bass');
    await expect(content).toContainText('Warm Pad');

    await page.keyboard.press('Escape');
    await expect(page.locator('.guide.open')).toHaveCount(0);
  });
});

test.describe('guide (phone)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('fills the screen with a horizontal section bar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).tap();
    // Phone top bar keeps 预设库 inside the overflow menu.
    await page.locator('.top-more .tbtn').tap();
    await page.getByRole('button', { name: '预设库' }).tap();
    await page.getByRole('button', { name: '使用指南' }).tap();
    const guide = page.locator('.guide.open');
    await expect(guide).toBeVisible();
    await page.waitForTimeout(350); // let the open transition settle

    const m = await page.evaluate(() => {
      const g = document.querySelector('.guide.open')!.getBoundingClientRect();
      const nav = document.querySelector('.guide-nav') as HTMLElement;
      const tabs = [...document.querySelectorAll('.guide-tab')].map((t) => t.textContent);
      return {
        w: Math.round(g.width),
        h: Math.round(g.height),
        navDirection: getComputedStyle(nav).flexDirection,
        tabs,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    expect(m.w).toBeGreaterThanOrEqual(m.vw - 2);
    expect(m.h).toBeGreaterThanOrEqual(m.vh - 2);
    expect(m.navDirection).toBe('row');
    expect(m.tabs).toContain('合成器基础');
  });
});
