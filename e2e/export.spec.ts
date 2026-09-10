import { expect, test } from '@playwright/test';

/**
 * Export path smoke test: the file must actually arrive, and it must be a
 * normal-level render (the level guarantee itself is unit-tested in
 * `src/audio/render.test.ts`, which is where the maths lives).
 */
test.describe('export', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('exports the current track as MP3', async ({ page }) => {
    test.setTimeout(240000);
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();
    await page.locator('.pcard', { hasText: 'Electric Piano' }).first().click();
    await page.locator('.preset-drawer .d-close').click();
    await page.locator('.display-row .monitor-actions .demo-btn').click();
    await page.waitForTimeout(300);
    await page.locator('.player-track', { hasText: '琶音' }).click();
    await page.waitForTimeout(400);

    // Rendering an export must not fight the live transport for the CPU: the
    // player pauses for the duration and picks up again afterwards.
    const play = page.locator('.player-play');
    await play.click();
    await expect(play).toHaveClass(/on/);
    const download = page.waitForEvent('download', { timeout: 200000 });
    await page.locator('.player-actions .player-btn', { hasText: '导出 MP3' }).click();
    await expect(play).not.toHaveClass(/on/);
    const file = await download;
    await expect(play).toHaveClass(/on/);
    expect(file.suggestedFilename()).toMatch(/\.mp3$/);
    const stream = await file.createReadStream();
    let bytes = 0;
    for await (const chunk of stream) bytes += (chunk as Buffer).length;
    // A one-minute render at 256 kbps is comfortably over a megabyte.
    expect(bytes).toBeGreaterThan(300_000);
    await file.delete();
    // Leave the transport stopped: the next spec should not compete with a
    // running render/playback for CPU.
    await play.click();
    await expect(play).not.toHaveClass(/on/);
  });
});
