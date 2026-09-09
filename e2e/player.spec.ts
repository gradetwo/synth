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

    // Transport uses SVG icons, not platform-dependent font glyphs.
    await expect(page.locator('.player-play svg')).toHaveCount(1);
    await expect(page.locator('.player-transport .player-btn svg')).toHaveCount(3);

    // Selecting a track auto-plays it.
    await page.locator('.player-track', { hasText: '致爱丽丝' }).click();
    await expect(page.locator('.player-track.current')).toHaveCount(1);
    const play = page.locator('.player-play');
    await expect(play).toHaveClass(/\bon\b/);

    // Stop halts playback.
    await page.locator('.player-transport .player-btn').first().click();
    await expect(play).not.toHaveClass(/\bon\b/);

    // Double-clicking the current track toggles play/pause.
    const current = page.locator('.player-track.current');
    await current.dblclick();
    await expect(play).toHaveClass(/\bon\b/);
    await current.dblclick();
    await expect(play).not.toHaveClass(/\bon\b/);
  });

  test('shows a chord name for three held notes, visually distinct', async ({ page }) => {
    await boot(page);
    const keys = page.locator('.wkey');
    const valStyle = () =>
      page.locator('.note-display .nd-val').evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: parseFloat(s.fontSize), color: s.color };
      });

    // Single note first, for comparison.
    const single = (await keys.nth(0).boundingBox())!;
    await keys.nth(0).dispatchEvent('pointerdown', {
      pointerId: 9,
      pointerType: 'touch',
      clientX: single.x + single.width / 2,
      clientY: single.y + single.height - 6,
    });
    await expect(page.locator('.nd-label')).toHaveText('NOTE');
    const noteStyle = await valStyle();
    await keys.nth(0).dispatchEvent('pointerup', { pointerId: 9, pointerType: 'touch' });

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
    await expect(page.locator('.note-display')).toHaveClass(/chord/);

    const chordStyle = await valStyle();
    expect(chordStyle.size).toBeGreaterThan(noteStyle.size);
    expect(chordStyle.color).not.toBe(noteStyle.color);

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

test.describe('player keyboard shortcuts', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('space toggles playback and escape closes the panel', async ({ page }) => {
    await boot(page);
    await page.locator('.player-open').click();
    const play = page.locator('.player-play');
    await page.keyboard.press(' ');
    await expect(play).toHaveClass(/\bon\b/);
    await expect(page.locator('.player-track.current .pt-bars')).toHaveCount(1);
    await page.keyboard.press(' ');
    await expect(play).not.toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.player.open')).toHaveCount(0);
  });
});
