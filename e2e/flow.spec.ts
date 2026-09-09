import { expect, test } from '@playwright/test';

async function boot(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.getByRole('button', { name: '信号流' }).click();
  await expect(page.locator('.flow-view')).toBeVisible();
}

test.describe('signal flow view', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders nodes, drags, bypasses and adds/removes', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.flow-node')).toHaveCount(10);

    // Drag the filter node.
    const filter = page.locator('.flow-node[data-node="filter"]');
    const before = (await filter.boundingBox())!;
    await page.mouse.move(before.x + 60, before.y + 12);
    await page.mouse.down();
    await page.mouse.move(before.x + 160, before.y + 72, { steps: 8 });
    await page.mouse.up();
    const after = (await filter.boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x + 50);
    expect(after.y).toBeGreaterThan(before.y + 20);

    // Bypass OSC 1.
    const osc1 = page.locator('.flow-node[data-node="osc1"]');
    await osc1.locator('.flow-icon').first().click();
    await expect(osc1).toHaveClass(/off/);
    await expect(osc1.locator('.flow-bypass')).toBeVisible();

    // Remove LFO 2 and add it back from the palette.
    const lfo2 = page.locator('.flow-node[data-node="lfo2"]');
    await lfo2.locator('.flow-icon').last().click();
    await expect(page.locator('.flow-node[data-node="lfo2"]')).toHaveCount(0);
    await page.locator('.flow-chip', { hasText: 'LFO 2' }).click();
    await expect(page.locator('.flow-node[data-node="lfo2"]')).toHaveCount(1);

    // Expand the filter parameters.
    await filter.locator('.flow-icon', { hasText: '⤢' }).click();
    await expect(page.locator('.flow-params')).toBeVisible();
    await expect(page.locator('.flow-params')).toContainText('CUTOFF');
  });

  test('performance bar plays a track', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.flow-select')).toBeVisible();
    const play = page.locator('.flow-bar .player-play');
    await play.click();
    await expect(play).toHaveClass(/\bon\b/);
  });
});
