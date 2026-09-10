import { expect, test } from '@playwright/test';

async function openGuide(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.locator('[data-act="settings"]').click();
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
    await page.locator('[data-act="settings"]').tap();
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

test.describe('changelog', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('opens from the preset drawer next to the guide', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.locator('[data-act="settings"]').click();
    // Same action row as the guide.
    await expect(page.getByRole('button', { name: '使用指南' })).toBeVisible();
    await page.getByRole('button', { name: '更新记录' }).click();

    const panel = page.locator('.changelog.open');
    await expect(panel).toBeVisible();
    // The running build is marked and its notes are shown.
    await expect(panel.locator('.release.current')).toHaveCount(1);
    await expect(panel.locator('.release.current .release-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(panel.locator('.release')).not.toHaveCount(1);
    await expect(panel).toContainText('修复');
    await expect(panel).toContainText('新功能');

    // Escape closes it, like the guide.
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
  });

  test('follows the interface language', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.locator('[data-act="settings"]').click();
    await page.locator('.settings-drawer', { hasText: 'EN' }).getByRole('button', { name: 'EN' }).click();
    await page.getByRole('button', { name: 'Changelog' }).click();
    const panel = page.locator('.changelog.open');
    await expect(panel).toContainText('current');
    await expect(panel).toContainText('Release history');
  });
});
