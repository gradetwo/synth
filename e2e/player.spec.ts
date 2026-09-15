import { expect, test } from './fixtures';

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
    // The built-in playlist is a lazy chunk (P9.26), so the panel can be open
    // for a frame before the demos are in it: poll rather than read once.
    await expect.poll(() => tracks.count()).toBeGreaterThanOrEqual(16);
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
    //
    // Both points are cut from the transport's *own clock*, so the waits are on
    // that clock and not on a wall timer. The fixed 1200/1500/4000 ms sleeps
    // this used to carry were the same requirement with a guess attached, and
    // on a slow host the guess plus everything around it spends the test's 60 s
    // budget: measured with the renderer throttled (quiet host, CDP
    // `Emulation.setCPUThrottlingRate`) this test takes 20.0 s at 1x, 40.8 s at
    // 4x, and at 8x it dies with `Test timeout of 60000ms exceeded` in the
    // middle of a step that is not itself special. `expect.poll` returns as
    // soon as the playhead is where the assertion needs it, so the wall time is
    // the playback the test is actually about rather than the playback plus
    // three sleeps that were guessed for a fast machine.
    const seek = page.locator('.player-seek');
    const duration = await seek.evaluate((el) => Number((el as HTMLInputElement).max));
    const position = () => seek.evaluate((el) => Number((el as HTMLInputElement).value));
    // `region.hi > region.lo + 1` below is a *percentage* band, so B has to land
    // more than 1 % of the song after A; 1.5 % leaves that assertion its margin
    // without the poll overshooting by a whole extra sleep.
    const apart = Math.max(0.5, duration * 0.015);

    await expect
      .poll(position, { timeout: 30_000, intervals: [100] })
      .toBeGreaterThan(apart);
    await page.locator('.player-transport .player-btn[aria-label^="把 A 点"]').click();
    const aAt = await position();
    await expect
      .poll(position, { timeout: 30_000, intervals: [100] })
      .toBeGreaterThan(aAt + apart);
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

    // Playback must stay inside the region instead of running past it. The old
    // shape of this assertion was a single reading taken after a fixed 4 s
    // sleep; sampling the transport's own clock keeps the claim *and* its
    // evidence -- every reading has to be inside the band, and the playhead has
    // to wrap, which is what "loops the region" means and what a playhead that
    // ran past `hi` would never do. It also stops as soon as it has seen the
    // wrap instead of sleeping to a wall-clock deadline.
    //
    // The samples are `player.time` itself (the input's value, the same state
    // the CSS band is drawn from) rather than the `m:ss` readout: a region a
    // second or two wide cannot be told apart from a stalled one at that
    // resolution, and the wrap is the whole point here. The ±1 s slack is the
    // one the readout used to need.
    const lo = (region.lo / 100) * duration;
    const hi = (region.hi / 100) * duration;
    const samples: number[] = [];
    await expect
      .poll(
        async () => {
          samples.push(await position());
          const wrapped = samples.some((t, i) => i > 0 && t < samples[i - 1]);
          return wrapped && samples.length >= 3;
        },
        { timeout: 30_000, intervals: [400] },
      )
      .toBe(true);
    for (const t of samples) {
      expect(t).toBeGreaterThanOrEqual(lo - 1);
      expect(t).toBeLessThanOrEqual(hi + 1);
    }

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
    // Each layer shows its notes as blocks on a bar, with a playhead.
    await expect(strip.locator('[data-layer="0"] .layer-note')).toHaveCount(1);
    await expect(strip.locator('[data-layer="1"] .layer-note')).toHaveCount(1);
    await expect(strip.locator('[data-layer="0"] .layer-playhead')).toHaveCount(1);
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

    // Each layer has a place in the stereo image, saved with the song.
    const pan = strip.locator('[data-layer="0"] .layer-pan');
    await pan.fill('-60');
    await expect(pan).toHaveValue('-60');

    // The mini timeline is a control too: a tap scrubs the transport…
    const map = strip.locator('[data-layer="0"] .layer-map');
    await map.scrollIntoViewIfNeeded();
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    const bar = box!;
    const seek = page.locator('.player-seek');
    const seekMax = await seek.evaluate((el) => Number((el as HTMLInputElement).max));
    expect(seekMax).toBeGreaterThan(0);
    await page.mouse.click(bar.x + bar.width * 0.6, bar.y + bar.height / 2);
    const scrubbed = await seek.evaluate((el) => Number((el as HTMLInputElement).value));
    expect(scrubbed / seekMax).toBeGreaterThan(0.4);
    expect(scrubbed / seekMax).toBeLessThan(0.8);

    // …and a sideways drag slides the whole layer in time.
    const block = strip.locator('[data-layer="0"] .layer-note').first();
    const before = await block.evaluate((el) => (el as HTMLElement).style.left);
    await page.mouse.move(bar.x + bar.width * 0.1, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.35, bar.y + bar.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => block.evaluate((el) => (el as HTMLElement).style.left))
      .not.toBe(before);
    const moved = await block.evaluate((el) => (el as HTMLElement).style.left);
    // A drag must not also scrub: moving a layer is not a transport jump.
    expect(await seek.evaluate((el) => Number((el as HTMLInputElement).value))).toBeCloseTo(
      scrubbed,
      3,
    );

    // The mix belongs to the song, so it survives a reload.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.player-open').click();
    const again = page.locator('.layer-strip');
    await expect(again).toHaveAttribute('data-layers', '2');
    await expect(again.locator('[data-layer="0"] .layer-vol')).toHaveValue('40');
    await expect(again.locator('[data-layer="0"] [data-act="mute"]')).toHaveAttribute('aria-pressed', 'true');
    // The pan comes back with it too.
    await expect(again.locator('[data-layer="0"] .layer-pan')).toHaveValue('-60');
    // The nudge is arrangement, not session: it comes back with the song.
    await expect
      .poll(async () =>
        again.locator('[data-layer="0"] .layer-note').first().evaluate((el) => (el as HTMLElement).style.left),
      )
      .toBe(moved);

    // A phone is the narrowest place the strip has to work: the extra control
    // wraps instead of pushing the row out of the panel.
    await page.setViewportSize({ width: 320, height: 720 });
    await expect(again.locator('[data-layer="0"] .layer-pan')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

  });
});

test.describe('player keyboard shortcuts', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('space toggles playback and escape closes the panel', async ({ page }) => {
    await boot(page);
    await page.locator('.player-open').click();
    // The panel arrives as its own chunk: give it a moment to mount before the
    // keyboard shortcut has a listener to reach.
    await expect(page.locator('.player.open')).toBeVisible();
    const play = page.locator('.player-play');
    await expect(play).toBeVisible();
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

test.describe('player library compliance', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('labels every track with its source and licence', async ({ page }) => {
    await boot(page);
    await page.locator('.player-open').click();
    await expect(page.locator('.player.open')).toBeVisible();
    const rows = page.locator('.player-track');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(16);
    // One label per row — the row is not a row without provenance (P10.5).
    await expect(page.locator('.player-track .pt-source')).toHaveCount(count);
    await expect(
      page.locator('.player-track', { hasText: '致爱丽丝', hasNotText: '八位机' }).locator('.pt-source'),
    ).toContainText('公版');
    await expect(page.locator('.player-track', { hasText: '黄昏圆舞曲' }).locator('.pt-source')).toContainText(
      '原创',
    );
    // The protected works P10.5 removed must not come back.
    for (const gone of [
      '梦中的婚礼', 'River Flows in You', 'Summer', '天空之城', '超级玛丽',
      '权力的游戏', '梁祝', '沧海一声笑', '克罗地亚',
    ]) {
      await expect(page.locator('.player-track', { hasText: gone })).toHaveCount(0);
    }
  });

  test('refuses a damaged file with a visible reason', async ({ page }) => {
    await boot(page);
    await page.locator('.player-open').click();
    await expect(page.locator('.player.open')).toBeVisible();
    const input = page.locator('.player input[type=file]');

    // Not a MIDI file at all.
    await input.setInputFiles({
      name: 'broken.mid',
      mimeType: 'audio/midi',
      buffer: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    await expect(page.locator('.toast')).toContainText('导入失败');
    await expect(page.locator('.player-track', { hasText: 'broken' })).toHaveCount(0);

    // A `.gs1song` whose share code cannot be decoded.
    await input.setInputFiles({
      name: 'broken.gs1song',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'gs1-song', schema: 1, code: 'not-a-share-code' })),
    });
    await expect(page.locator('.toast')).toContainText('损坏');

    // A patch file is not a song and is named as such.
    await input.setInputFiles({
      name: 'patch.gs1.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'gs1-preset', version: 1, params: { 1: 1 } })),
    });
    await expect(page.locator('.toast')).toContainText('音色文件');
  });
});
