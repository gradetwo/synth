import { expect, test, type Page } from './fixtures';
import { hostAudioUnavailableReason } from './audio-host';

/**
 * The P12.2 showcase patches, from the browser's side.
 *
 * The DSP is measured where it lives: `src/audio/preset-audition.test.ts`
 * renders every new patch through the real wasm, proves it makes a clean sound,
 * and proves that switching the capability it demonstrates off changes the
 * samples. What only a browser can answer is whether a player can actually
 * reach each patch from the drawer and hear it — a preset that loads but never
 * reaches the worklet, or a capability that the live parameter flood drops,
 * would pass the offline test and fail here.
 *
 * The observable is the app's own monitor: holding a key has to take the VU
 * caption off its silence floor (the same signal `meter.spec.ts` uses).
 */

/** The English half of each name, which both locales share. */
const SHOWCASE = [
  'SEM Morph Pad',
  'SEM Parallel Bass',
  'SEM Notch Drone',
  'Crushed Lead',
  'Crushed Sub',
  'Tape Crush Keys',
  'Oversampled Drive',
  'Oversampled Sub',
  'Graph Pump',
  'Graph Swell',
];

async function boot(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(600);
}

test.describe('P12.2 showcase presets', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(240_000);

  test('every showcase preset loads and is audible', async ({ page }) => {
    await boot(page);
    // Audibility needs a running engine, which needs a host with an audio
    // device; without one every preset reads as silent. Skip with the reading.
    const hostSkip = await hostAudioUnavailableReason(page);
    test.skip(hostSkip !== null, hostSkip ?? undefined);
    const meter = page.locator('.vu-meter');
    const name = page.locator('.preset-name');
    const key = page.locator('.bkey').nth(4);
    const box = (await key.boundingBox())!;

    for (const preset of SHOWCASE) {
      await page.getByRole('button', { name: '预设库' }).click();
      const card = page.locator('.pcard', { hasText: preset }).first();
      await expect(card, preset).toHaveCount(1);
      await card.click();
      await expect(name, `${preset} loaded`).toContainText(preset);
      await page.locator('.preset-drawer .d-close').click();

      // Hold rather than click: a short note can decay before the poll samples.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect
        .poll(async () => meter.textContent(), { timeout: 8_000, message: `${preset} is silent` })
        .not.toMatch(/^— · —/);
      await page.mouse.up();
      // Let the tail settle so the next patch starts from silence.
      await expect.poll(async () => meter.textContent(), { timeout: 8_000 }).toMatch(/^— · —/);
    }
  });
});
