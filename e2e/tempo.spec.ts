import { expect, test } from './fixtures';

/**
 * Tempo and time signature map (P5.3).
 *
 * The unit tests cover the arithmetic and the file round trip; what needs a
 * browser is the chain a player actually walks: change the tempo, see the
 * readout follow, and find it again after a reload — with the metronome
 * clicking on the map rather than on one BPM.
 */
test.describe('tempo map', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('edits the tempo and signature, shows bar.beat, and keeps it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(300);
    await page.locator('.player-open').click();

    const readout = page.locator('[data-act="bar-beat"]');
    await expect(readout).toBeVisible();
    // Whatever the demo's own tempo is, a fresh song is *one* section with a
    // 4/4 signature, and the readout starts at the top.
    const bpm0 = page.locator('[data-act="tempo-bpm-0"]');
    await expect(bpm0).toBeVisible();
    const initial = Number(await bpm0.inputValue());
    expect(initial).toBeGreaterThan(20);
    await expect(page.locator('[data-act="tempo-bar-0"]')).toHaveValue('4');
    await expect(readout).toContainText('1.1');

    // Change the tempo and the signature: the map is written with the song.
    await bpm0.fill('60');
    await bpm0.dispatchEvent('change');
    await page.locator('[data-act="tempo-bar-0"]').selectOption('3');
    await expect(page.locator('[data-act="tempo-bar-0"]')).toHaveValue('3');

    // Add a second section and give it its own tempo: two segments on screen.
    await page.locator('[data-act="tempo-add"]').click();
    await expect(page.locator('[data-act="tempo-bpm-1"]')).toBeVisible();
    await page.locator('[data-act="tempo-bpm-1"]').fill('120');
    await page.locator('[data-act="tempo-bpm-1"]').dispatchEvent('change');

    // The readout follows the map: at 60 BPM in 3/4 the third beat of the first
    // bar is one second in, and the bar counter uses the *signature*, not four.
    // At 60 BPM a beat is a second, so two seconds in is beat 3 of bar 1 — and
    // three seconds in is the *next* bar because the signature is 3/4.
    await page.locator('.player-seek').fill('2');
    await expect(readout).toContainText('1.3');
    await page.locator('.player-seek').fill('3');
    await expect(readout).toContainText('2.1');

    // A reload keeps the whole map: it went to storage with the song.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.player-open').click();
    await expect(page.locator('[data-act="tempo-bpm-0"]')).toHaveValue('60');
    await expect(page.locator('[data-act="tempo-bar-0"]')).toHaveValue('3');
    await expect(page.locator('[data-act="tempo-bpm-1"]')).toHaveValue('120');

    // The metronome can be switched on with a map in force, which is the audible
    // half of "the clicks follow the map": it must not throw or go silent.
    await page.getByRole('button', { name: '节拍器' }).click();
    await page.locator('[data-act="tempo-remove"]').click();
    await expect(page.locator('[data-act="tempo-bpm-1"]')).toHaveCount(0);
    await expect(page.locator('[data-act="tempo-bpm-0"]')).toHaveValue('60');
  });
});
