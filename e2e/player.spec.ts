import { expect, test } from '@playwright/test';

async function boot(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
}

test.describe('player', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('lists the built-in songs and drives the transport', async ({ page }) => {
    await boot(page);
    await page.locator('.player-open').click();
    await expect(page.locator('.player.open')).toBeVisible();

    const tracks = page.locator('.player-track');
    expect(await tracks.count()).toBeGreaterThanOrEqual(16);
    await expect(page.locator('.player-track', { hasText: '致爱丽丝' })).toHaveCount(1);
    await expect(page.locator('.player-track', { hasText: '茉莉花' })).toHaveCount(1);
    await expect(page.locator('.player-track', { hasText: '音阶' })).toHaveCount(1);

    await page.locator('.player-track', { hasText: '致爱丽丝' }).click();
    await expect(page.locator('.player-track.current')).toHaveCount(1);

    const play = page.locator('.player-play');
    await play.click();
    await expect(play).toHaveClass(/\bon\b/);
    await page.locator('.player-btn', { hasText: '■' }).first().click();
    await expect(play).not.toHaveClass(/\bon\b/);
  });

  test('shows a chord name for three held notes', async ({ page }) => {
    await boot(page);
    const keys = page.locator('.wkey');
    const picks = [0, 2, 4]; // C E G
    const boxes = [];
    for (const i of picks) boxes.push((await keys.nth(i).boundingBox())!);
    for (let n = 0; n < picks.length; n++) {
      await keys.nth(picks[n]).dispatchEvent('pointerdown', {
        pointerId: 20 + n,
        pointerType: 'touch',
        clientX: boxes[n].x + boxes[n].width / 2,
        clientY: boxes[n].y + boxes[n].height - 6,
      });
    }
    await expect(page.locator('.nd-label')).toHaveText('CHORD');
    await expect(page.locator('.nd-val')).toHaveText('C');
    for (let n = 0; n < picks.length; n++) {
      await keys.nth(picks[n]).dispatchEvent('pointerup', { pointerId: 20 + n, pointerType: 'touch' });
    }
  });
});

test.describe('player MIDI import', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('plays back an imported .mid file', async ({ page }) => {
    await boot(page);
    await page.locator('.player-open').click();
    // Minimal format-0 SMF: one C4 quarter note at 120 BPM.
    const track = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
      0x00, 0x90, 0x3c, 0x64,
      0x83, 0x60, 0x80, 0x3c, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const bytes = Buffer.from([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track,
    ]);
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'unit-test.mid',
      mimeType: 'audio/midi',
      buffer: bytes,
    });
    await expect(page.locator('.player-track', { hasText: 'unit-test' })).toHaveCount(1);
    await expect(page.locator('.player-track.current')).toContainText('unit-test');
  });
});
