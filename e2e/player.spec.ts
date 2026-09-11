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
    await expect(page.locator('.player-track', { hasText: '致爱丽丝', hasNotText: '八位机' })).toHaveCount(1);
    await expect(page.locator('.player-track', { hasText: '茉莉花' })).toHaveCount(1);
    await expect(page.locator('.player-track', { hasText: '音阶' })).toHaveCount(1);

    // Transport uses SVG icons, not platform-dependent font glyphs.
    await expect(page.locator('.player-play svg')).toHaveCount(1);
    // stop, loop, record, metronome
    await expect(page.locator('.player-transport .player-btn svg')).toHaveCount(4);

    // Selecting a track auto-plays it.
    await page.locator('.player-track', { hasText: '致爱丽丝', hasNotText: '八位机' }).click();
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

  test('loops an A/B region and clicks the metronome', async ({ page }) => {
    await boot(page);
    await page.locator('.player-open').click();
    await page.locator('.player-track', { hasText: '致爱丽丝', hasNotText: '八位机' }).click();
    await expect(page.locator('.player-play')).toHaveClass(/\bon\b/);

    // Metronome on, which also reveals the count-in switch.
    const metro = page.locator('.player-transport .player-btn[aria-label="节拍器"]');
    await metro.click();
    await expect(metro).toHaveAttribute('aria-pressed', 'true');
    const countIn = page.locator('.player-transport .player-btn[aria-label="预备拍"]');
    await expect(countIn).toBeVisible();
    await countIn.click();
    await expect(countIn).toHaveAttribute('aria-pressed', 'true');
    await countIn.click();

    // Mark A and B around the current playhead.
    await page.waitForTimeout(1200);
    await page.locator('.player-transport .player-btn[aria-label^="把 A 点"]').click();
    await page.waitForTimeout(1500);
    await page.locator('.player-transport .player-btn[aria-label^="把 B 点"]').click();

    const region = await page.locator('.player-seek').evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return {
        lo: parseFloat(cs.getPropertyValue('--lo')),
        hi: parseFloat(cs.getPropertyValue('--hi')),
      };
    });
    expect(region.hi).toBeGreaterThan(region.lo + 1);
    // Setting both points switches looping on by itself.
    await expect(page.locator('.player-transport .player-btn[aria-label="循环"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Playback must stay inside the region instead of running past it.
    const readTime = async () => {
      const text = (await page.locator('.player-time').textContent()) ?? '';
      const [mm, ss] = (text.split('/')[0] ?? '0:00').trim().split(':').map(Number);
      return mm * 60 + ss;
    };
    await page.waitForTimeout(4000);
    const now = await readTime();
    const duration = await page.locator('.player-seek').evaluate((el) => Number((el as HTMLInputElement).max));
    const lo = (region.lo / 100) * duration;
    const hi = (region.hi / 100) * duration;
    expect(now).toBeGreaterThanOrEqual(Math.floor(lo) - 1);
    expect(now).toBeLessThanOrEqual(Math.ceil(hi) + 1);

    // Clearing the region drops the band.
    await page.locator('.player-transport .player-btn[aria-label^="清除"]').click();
    const cleared = await page.locator('.player-seek').evaluate((el) =>
      getComputedStyle(el as HTMLElement).getPropertyValue('--hi').trim(),
    );
    expect(cleared).toBe('100%');
    await page.locator('.player-play').click();
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

    // The library is the player's own work: it has to survive a reload.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.locator('.player-open').click();
    await expect(page.locator('.player-track', { hasText: 'unit-test' })).toHaveCount(1);
    await expect(page.locator('.player-track.current')).toContainText('unit-test');

    // A format-1 file keeps its layers: the panel shows a strip with mute and
    // solo per track.
    const track2 = [
      0x00, 0xff, 0x03, 0x04, 0x4c, 0x65, 0x61, 0x64,
      0x00, 0x90, 0x3e, 0x64,
      0x83, 0x60, 0x80, 0x3e, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const layered = Buffer.from([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track2.length, ...track2,
    ]);
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'two-tracks.mid',
      mimeType: 'audio/midi',
      buffer: layered,
    });
    const strip = page.locator('.layer-strip');
    await expect(strip).toHaveAttribute('data-layers', '2');
    const mute = strip.locator('[data-layer="0"] [data-act="mute"]');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await strip.locator('[data-layer="1"] [data-act="solo"]').click();
    await expect(strip.locator('[data-layer="1"] [data-act="solo"]')).toHaveAttribute('aria-pressed', 'true');
    // Each layer has its own level, so a two-track file can be balanced.
    const volume = strip.locator('[data-layer="0"] .layer-vol');
    await volume.fill('40');
    await expect(volume).toHaveValue('40');

    // The mix belongs to the song, so it survives a reload.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.player-open').click();
    const again = page.locator('.layer-strip');
    await expect(again).toHaveAttribute('data-layers', '2');
    await expect(again.locator('[data-layer="0"] .layer-vol')).toHaveValue('40');
    await expect(again.locator('[data-layer="0"] [data-act="mute"]')).toHaveAttribute('aria-pressed', 'true');

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

test('record quantise is selectable and remembered', async ({ page }) => {
  await boot(page);
  await page.locator('.player-open').click();
  const select = page.locator('.player-quantise select');
  await expect(select).toHaveValue('off');
  await select.selectOption('1/16');
  await expect(select).toHaveValue('1/16');

  await page.reload();
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.player-open').click();
  await expect(page.locator('.player-quantise select')).toHaveValue('1/16');
});
