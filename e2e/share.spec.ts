import { expect, test } from '@playwright/test';
import { layeredMidiFile } from './layered-midi';

/**
 * Sharing a whole arrangement (B).
 *
 * The patch already travelled in a link; now the song does too, with the layer
 * mix that makes it sound the way the sender heard it. The receiving side has to
 * end up with a playable song, not just a patch.
 */
test.use({ viewport: { width: 1400, height: 900 } });

test('shares a song with its mix, and the link opens it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);

  // Import a two-track file and balance it.
  await page.locator('.player-open').click();
  await page.locator('.player input[type=file]').setInputFiles({
    name: 'two-tracks.mid',
    mimeType: 'audio/midi',
    buffer: layeredMidiFile(),
  });
  const strip = page.locator('.layer-strip');
  await expect(strip).toHaveAttribute('data-layers', '2');
  await strip.locator('[data-layer="0"] [data-act="mute"]').click();
  await strip.locator('[data-layer="1"] .layer-pan').fill('60');

  // Share it: the code now carries the arrangement as well as the patch.
  await page.locator('.player-head .d-close').click();
  await expect(page.locator('.player.open')).toHaveCount(0);
  await page.getByRole('button', { name: '预设库' }).click();
  await page.locator('.preset-drawer button', { hasText: '分享' }).first().click();
  // The arrangement travels deflated (the `gs1.2.` form) — that is what keeps a
  // long song inside a URL: this one comes to ~680 characters all in, where the
  // plain form of the same song is a few hundred longer.
  await expect
    .poll(async () => page.evaluate(() => location.hash), { timeout: 30_000 })
    .toContain('gs1.2.');
  const url = await page.evaluate(() => location.href);
  expect(url.length).toBeLessThan(16_000);

  // The other side opens the link in a browser context of its own, so nothing
  // of the sender's library or workspace is left over.
  const other = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const receiver = await other.newPage();
  await receiver.goto(url);
  await receiver.getByRole('button', { name: /启动音频引擎/ }).click();
  await receiver.waitForTimeout(600);
  await receiver.locator('.player-open').click();
  const received = receiver.locator('.layer-strip');
  await expect(received).toHaveAttribute('data-layers', '2');
  // The mix arrives with the song and is applied just after it loads, so poll
  // rather than reading once (slow engines need a moment longer).
  await expect
    .poll(async () => received.locator('[data-layer="0"] [data-act="mute"]').getAttribute('aria-pressed'), {
      timeout: 30_000,
    })
    .toBe('true');
  await expect
    .poll(async () => received.locator('[data-layer="1"] .layer-pan').inputValue(), { timeout: 30_000 })
    .toBe('60');
  // Playable: the transport knows the song's length.
  const max = await receiver
    .locator('.player-seek')
    .evaluate((el) => Number((el as HTMLInputElement).max));
  expect(max).toBeGreaterThan(0);
  await other.close();
});
