import { expect, test, type Page } from '@playwright/test';

/**
 * Recorded takes and overdubbing (P5.4).
 *
 * The model, the cap, the migration and the share-code round trip are unit
 * tested; what this case walks is the chain a player actually performs: import
 * something to play over, record once, record again (nothing already there is
 * lost), switch take and watch the strip change, and get the same two takes
 * back after a reload. The strip's note blocks are the observable — they are
 * drawn from the take that is selected, so their count *is* "what would play".
 */

/** A minimal format-0 SMF: one D4 quarter note at 120 BPM (a 0.5 s note). */
const oneNoteFile = () =>
  Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 22,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 0x3e, 0x64,
    0x83, 0x60, 0x80, 0x3e, 0x40,
    0x00, 0xff, 0x2f, 0x00,
  ]);

const boot = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(300);
};

/** Hold one key long enough for the recorder to capture a note, then release. */
const play = async (page: Page, midi: number, hold = 120) => {
  const key = page.locator(`[data-midi="${midi}"]`).first();
  await key.dispatchEvent('pointerdown', { pointerId: midi });
  await page.waitForTimeout(hold);
  await key.dispatchEvent('pointerup', { pointerId: midi });
  await page.waitForTimeout(60);
};

const recordButton = (page: Page) => page.locator('.player .player-transport button[aria-label="录制"]');
const stopRecordButton = (page: Page) =>
  page.locator('.player .player-transport button[aria-label="停止录制"]');
const stopButton = (page: Page) => page.locator('.player .player-transport button[aria-label="停止"]');

/** Place the playhead, so "the position was kept" can be read back as a number. */
const seekTo = async (page: Page, value: number) => {
  await page.locator('.player-seek').fill(String(value));
  return Number(await page.locator('.player-seek').inputValue());
};

test.describe('recorded takes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('overdubs twice, switches take and keeps them across a reload', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.locator('.player-open').click();
    await expect(page.locator('.player.open')).toHaveCount(1);
    // Something to overdub onto: the imported note is the bed the first take
    // grows out of, so the counts below start at one and "nothing is lost" is
    // visible at every step.
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'one-note.mid',
      mimeType: 'audio/midi',
      buffer: oneNoteFile(),
    });

    const chips = page.locator('.take-tools [data-act="take"]');
    const notes = page.locator('.layer-strip [data-layer="0"] .layer-note');
    await expect(page.locator('.take-tools')).toBeVisible();
    await expect(chips).toHaveCount(0);
    await expect(notes).toHaveCount(1);

    // First pass: two keys. The take is the imported note plus what was played.
    await recordButton(page).click();
    await play(page, 60);
    await play(page, 64);
    await stopRecordButton(page).click();
    await expect(chips).toHaveCount(1);
    await expect(chips.first().locator('.take-notes')).toHaveText('3');
    await expect(notes).toHaveCount(3);

    // Second pass: a third key, laid over the three that are already there. The
    // first pass stays as its own take, so nothing that was played is gone.
    await recordButton(page).click();
    await play(page, 67);
    await stopRecordButton(page).click();
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(1).locator('.take-notes')).toHaveText('4');
    await expect(notes).toHaveCount(4);
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');

    // Switching take changes what plays: the first take has three notes, the
    // overdubbed second has four. (The chip auditions the take as it selects
    // it, which is why the transport is running afterwards.)
    await chips.first().click();
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(notes).toHaveCount(3);
    await chips.nth(1).click();
    await expect(notes).toHaveCount(4);

    // Back to the first take, then reload: the takes are part of the song, so
    // the list and the selection come back with it.
    await chips.first().click();
    await expect(notes).toHaveCount(3);
    await page.reload();
    await boot(page);
    await page.locator('.player-open').click();
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(notes).toHaveCount(3);
    await chips.nth(1).click();
    await expect(notes).toHaveCount(4);

    // Merging keeps the material of both: the union is four notes, in one take,
    // selected.
    await page.locator('.take-tools [data-act="take-merge"]').click();
    await expect(chips).toHaveCount(1);
    await expect(chips.first().locator('.take-notes')).toHaveText('4');
    await expect(notes).toHaveCount(4);

    // Deleting the last take cannot lose the performance: the layer keeps
    // playing what it was playing.
    await page.locator('.take-tools [data-act="take-delete"]').click();
    await expect(chips).toHaveCount(0);
    await expect(notes).toHaveCount(4);
    // Auditioning a chip starts the transport; leave it stopped so the next
    // spec is not competing with a running player.
    const playButton = page.locator('.player .player-play');
    if (await playButton.evaluate((el) => el.classList.contains('on'))) await playButton.click();
  });

  test('renames a take, and A/B auditions both from the same point (P10.3)', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.locator('.player-open').click();
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'one-note.mid',
      mimeType: 'audio/midi',
      buffer: oneNoteFile(),
    });
    const chips = page.locator('.take-tools [data-act="take"]');
    const notes = page.locator('.layer-strip [data-layer="0"] .layer-note');

    // Two long-ish passes, so there is room to move the playhead between them.
    await recordButton(page).click();
    await play(page, 64, 2500);
    await stopRecordButton(page).click();
    await recordButton(page).click();
    await play(page, 67, 2500);
    await stopRecordButton(page).click();
    await expect(chips).toHaveCount(2);
    await expect(notes).toHaveCount(3);

    // Rename the first take through the row's button: Enter commits.
    await chips.first().click();
    await page.locator('[data-act="take-rename"]').click();
    const input = page.locator('[data-act="take-rename-input"]');
    await expect(input).toBeVisible();
    await input.fill('verse');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(chips.first()).toContainText('verse');

    // Escape cancels: the draft never lands.
    await page.locator('[data-act="take-rename"]').click();
    await page.locator('[data-act="take-rename-input"]').fill('nope');
    await page.locator('[data-act="take-rename-input"]').press('Escape');
    await expect(chips.first()).toContainText('verse');

    // The name is part of the song, so it comes back after a reload.
    await page.reload();
    await boot(page);
    await page.locator('.player-open').click();
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toContainText('verse');
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');

    // A/B: compare the two takes from a point the user chose, not from the top.
    await chips.first().click();
    await expect(notes).toHaveCount(2);
    const placed = await seekTo(page, 0.5);
    expect(placed).toBeGreaterThan(0.25);
    await page.locator('[data-act="take-ab"]').click();
    await expect(page.locator('[data-act="take-ab-pair"]')).toBeVisible();
    await expect(page.locator('[data-act="take-ab-hint"]')).toBeVisible();
    // The comparison starts on B — and it really is B's performance playing.
    await expect(notes).toHaveCount(3);
    await expect(page.locator('[data-act="take-ab-b"]')).toHaveAttribute('aria-pressed', 'true');
    const atB = Number(await page.locator('.player-seek').inputValue());
    expect(atB).toBeGreaterThan(0.25); // the playhead did not jump back to 0
    // Keyboard A / B jumps between the two at the same position.
    await page.keyboard.press('a');
    await expect(notes).toHaveCount(2);
    await expect(page.locator('[data-act="take-ab-a"]')).toHaveAttribute('aria-pressed', 'true');
    expect(Number(await page.locator('.player-seek').inputValue())).toBeGreaterThan(0.25);
    await page.keyboard.press('b');
    await expect(notes).toHaveCount(3);

    // Stopping ends the comparison and puts the layer back on A, with a word.
    await stopButton(page).click();
    await expect(notes).toHaveCount(2);
    await expect(page.locator('[data-act="take-ab-pair"]')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('verse');
  });

  test('merges with union or overwrite, and the two differ (P10.3)', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.locator('.player-open').click();
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'one-note.mid',
      mimeType: 'audio/midi',
      buffer: oneNoteFile(),
    });
    const chips = page.locator('.take-tools [data-act="take"]');
    const notes = page.locator('.layer-strip [data-layer="0"] .layer-note');

    // A branched history, the only shape where the two trades differ: take 2
    // grows out of take 1, then take 3 grows out of take 1 again, so each holds
    // a note the other does not have, played at the same moment. (The on-screen
    // keyboard spans MIDI 48-72, so the three extra notes stay inside it.)
    await recordButton(page).click();
    await play(page, 62);
    await stopRecordButton(page).click();
    await expect(notes).toHaveCount(2);
    await recordButton(page).click();
    await play(page, 65);
    await stopRecordButton(page).click();
    await expect(notes).toHaveCount(3);
    await chips.first().click();
    await expect(notes).toHaveCount(2);
    await recordButton(page).click();
    await play(page, 69);
    await stopRecordButton(page).click();
    await expect(chips).toHaveCount(3);
    await expect(notes).toHaveCount(3);
    await stopButton(page).click();

    // Union: the merged take plays everything any pass played.
    await page.locator('[data-act="take-merge"]').click();
    await expect(chips).toHaveCount(1);
    await expect(chips.first().locator('.take-notes')).toHaveText('4');
    await expect(notes).toHaveCount(4);
    await expect(chips.first()).toContainText('并集');

    // Undo brings the alternates back, and the other trade is offered there.
    await page.keyboard.press('Control+z');
    await expect(chips).toHaveCount(3);
    await page.locator('[data-act="take-merge-overwrite"]').click();
    await expect(chips).toHaveCount(1);
    await expect(chips.first().locator('.take-notes')).toHaveText('3');
    await expect(notes).toHaveCount(3);
    await expect(chips.first()).toContainText('覆盖');
  });

  test('a folded layer says takes are material, and refuses the switch (P10.3)', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.locator('.player-open').click();
    await page.locator('.player input[type=file]').setInputFiles({
      name: 'one-note.mid',
      mimeType: 'audio/midi',
      buffer: oneNoteFile(),
    });
    const chips = page.locator('.take-tools [data-act="take"]');
    const notes = page.locator('.layer-strip [data-layer="0"] .layer-note');
    await recordButton(page).click();
    await play(page, 64);
    await stopRecordButton(page).click();
    await recordButton(page).click();
    await play(page, 67);
    await stopRecordButton(page).click();
    await expect(chips).toHaveCount(2);
    await expect(notes).toHaveCount(3);

    // Fold the layer: the clip is the plan, the takes are what it was built
    // from, and the row says so instead of switching silently.
    await page.locator('[data-act="clip-fold"]').click();
    await expect(page.locator('.layer-strip [data-act="clip"]')).toHaveCount(1);
    await expect(page.locator('[data-act="take-folded-hint"]')).toBeVisible();
    await expect(chips.first()).toHaveAttribute('data-blocked', 'true');
    await expect(page.locator('[data-act="take-merge"]')).toBeDisabled();
    await expect(page.locator('[data-act="take-merge-overwrite"]')).toBeDisabled();
    await expect(page.locator('[data-act="take-ab"]')).toBeDisabled();

    // Tapping a take gives the reason, and changes nothing.
    const playing = await notes.count();
    await chips.first().click();
    await expect(page.locator('.toast')).toContainText('仅作素材');
    await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');
    await expect(notes).toHaveCount(playing);
  });
});
