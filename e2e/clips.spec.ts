import { expect, test, type Page } from '@playwright/test';

/**
 * Arrangement clips (P5.2).
 *
 * The model and the expansion are unit-tested; what these cases are for is the
 * chain a player actually walks: fold a layer into a clip, repeat it, copy it,
 * hear the arrangement grow — and get the same thing back out of an exported
 * file, which is the promise that the exports follow the arrangement.
 */

/** A minimal format-0 SMF: one C4 quarter note at 120 BPM (a 0.5 s note). */
const oneNoteFile = () =>
  Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 22,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 0x3c, 0x64,
    0x83, 0x60, 0x80, 0x3c, 0x40,
    0x00, 0xff, 0x2f, 0x00,
  ]);

const seekMax = (page: Page) =>
  page.locator('.player-seek').evaluate((el) => Number((el as HTMLInputElement).max));

test.describe('arrangement clips', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('folds, repeats and copies a layer, and the export follows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.locator('.player-open').click();
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'one-note.mid',
      mimeType: 'audio/midi',
      buffer: oneNoteFile(),
    });

    const notes = page.locator('.layer-strip [data-layer="0"] .layer-note');
    await expect(notes).toHaveCount(1);
    // 120 BPM, one quarter note: half a second of note and the usual tail. The
    // transport's duration arrives with the import, so wait for it to settle.
    await expect.poll(() => seekMax(page), { timeout: 20_000 }).toBeGreaterThan(0.4);
    const flat = await seekMax(page);
    expect(flat).toBeLessThan(1.5);

    // Fold the layer: the note becomes a clip whose window is one bar, so the
    // performance does not change — one note, same length.
    await page.locator('[data-act="clip-fold"]').click();
    const clips = page.locator('.layer-strip [data-act="clip"]');
    await expect(clips).toHaveCount(1);
    await expect(notes).toHaveCount(1);
    // The player adds a short tail to a stored song, so "the same performance"
    // is the same notes and a length that has not moved by anything audible.
    expect(Math.abs((await seekMax(page)) - flat)).toBeLessThan(0.5);

    // Select the clip and loop it three times: the lane still shows one block,
    // the map shows the three passes, and the song is three windows long.
    await clips.first().click();
    await expect(page.locator('[data-act="clip-info"]')).toContainText('1×');
    await page.locator('[data-act="clip-more"]').click();
    await page.locator('[data-act="clip-more"]').click();
    await expect(page.locator('[data-act="clip-info"]')).toContainText('3×');
    await expect(notes).toHaveCount(3);
    await expect.poll(() => seekMax(page), { timeout: 20_000 }).toBeGreaterThan(flat * 3 - 0.6);
    const looped = await seekMax(page);

    // Copy the clip: it lands after the original, so the layer plays six times.
    await page.locator('[data-act="clip-copy"]').click();
    await expect(clips).toHaveCount(2);
    await expect(notes).toHaveCount(6);
    await expect.poll(() => seekMax(page), { timeout: 20_000 }).toBeGreaterThan(looped * 1.8);
    const arranged = await seekMax(page);

    // Every clip is a button in the lane and the loop marks are drawn.
    await expect(page.locator('.layer-strip .clip-loop').first()).toBeVisible();

    // The arrangement is stored with the song, so it comes back after a reload.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.player-open').click();
    await expect(page.locator('.layer-strip [data-act="clip"]')).toHaveCount(2);
    await expect(notes).toHaveCount(6);
    expect(await seekMax(page)).toBeCloseTo(arranged, 1);

    // The export follows the arrangement: export the MIDI, import it back, and
    // the same music comes in — six notes in the same amount of time. (The
    // imported file is a flat performance: MIDI has nowhere to put our clips,
    // which is why this is the last step and why the reload above came first.)
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('.player-actions .player-btn', { hasText: '导出 MIDI' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.mid$/);
    const path = await file.path();
    await page.locator('.player input[type=file]').setInputFiles(path);
    await expect(notes).toHaveCount(6);
    // A file holds notes, not a tail, and the player adds its 0.4 s back: the
    // two lengths agree to within that, which is what "the export follows the
    // arrangement" means.
    await expect.poll(() => seekMax(page), { timeout: 20_000 }).toBeCloseTo(arranged, 0);
  });
});
