import { expect, test } from '@playwright/test';

/**
 * The monitor readout with nothing playing.
 *
 * It used to show a hardcoded floor (-60 for loudness, -120 for the peak) and
 * flicker between two strings at the rounding boundary, which reads as "the
 * synth is doing something" while it is doing nothing.
 */
test('idle meter is stable and reads silence', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(1200);

  const meter = page.locator('.vu-meter');
  const seen = new Set<string>();
  for (let i = 0; i < 15; i++) {
    // Drop the optional load field: that one is a live CPU reading and may come
    // and go with the machine's background load. Everything before it is the
    // measurement, and with nothing playing it must not move.
    const text = ((await meter.textContent()) ?? '').replace(/ · \d+%$/, '');
    seen.add(text);
    await page.waitForTimeout(150);
  }
  expect([...seen]).toEqual(['— · —']);

  // Playing a note makes it a measurement again.
  await page.locator('.bkey').nth(4).click();
  await expect.poll(async () => meter.textContent(), { timeout: 5000 }).not.toBe('— · —');
});
