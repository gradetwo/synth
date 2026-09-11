import { expect, test } from '@playwright/test';
import { layeredMidiFile } from './layered-midi';

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

  test('exports the layer mix, not the raw file', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.locator('.player-open').click();
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'two-tracks.mid',
      mimeType: 'audio/midi',
      buffer: layeredMidiFile(),
    });
    const strip = page.locator('.layer-strip');
    await expect(strip).toHaveAttribute('data-layers', '2');

    // Balance it like a player would: drop the bass, push the lead right.
    await strip.locator('[data-layer="0"] [data-act="mute"]').click();
    await strip.locator('[data-layer="1"] .layer-pan').fill('50');
    await expect(strip.locator('[data-layer="0"] [data-act="mute"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('.player-actions .player-btn', { hasText: '导出 MIDI' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.mid$/);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    await file.delete();
    const bytes = Buffer.concat(chunks);

    // One layer left audible: a format-0 file with its own track.
    expect(bytes[8]).toBe(0);
    expect(bytes[9]).toBe(0);
    expect((bytes[10] << 8) | bytes[11]).toBe(1);
    // The muted bass note-on (0x90 0x30) is gone, the lead's (0x90 0x3e) is there.
    const hasNoteOn = (note: number) =>
      [...bytes].some((b, i) => b === 0x90 && bytes[i + 1] === note);
    expect(hasNoteOn(0x30)).toBe(false);
    expect(hasNoteOn(0x3e)).toBe(true);
    // …and the pan went out as CC10: +0.5 is 95.
    const events = [...bytes];
    const pan = events.findIndex((b, i) => b === 0xb0 && events[i + 1] === 10);
    expect(pan).toBeGreaterThan(0);
    expect(events[pan + 2]).toBe(95);
  });
});
