import { expect, test } from '@playwright/test';

/**
 * Starting the engine.
 *
 * Real Chrome may hand back an AudioContext that is *already running* before any
 * gesture, and `preload()` creates one on page load. Treating that context state
 * as "the synth is playing" hid the start gate over a completely silent app:
 * no AudioWorkletNode existed, nothing would build one, and refreshing repeated
 * the same state. These tests run with Chrome's real autoplay policy so the
 * running-context-without-a-graph case actually happens.
 */
test.use({ launchOptions: { args: ['--autoplay-policy=user-gesture-required'] } });

const kernelLine = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: '预设库' }).click();
  await page.getByRole('button', { name: '音频设置', exact: true }).click();
  const panel = await page.locator('.audio-settings.open').innerText();
  await page.keyboard.press('Escape');
  return panel.replace(/\s+/g, ' ');
};

test('the gate stays up until the graph exists, and a reload is never a dead end', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.waitForTimeout(1500);

  // A context exists (preload creates it) but nothing is playing yet: the gate
  // must still be there, however the context reports itself.
  await expect(page.locator('.start-overlay')).toHaveCount(1);

  await page.locator('.start-btn').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('.start-overlay')).toHaveCount(0);
  // The kernel is loaded *and* the context is running: that is a started engine.
  const started = await kernelLine(page);
  expect(started).toContain('引擎状态 running');
  expect(started).not.toContain('DSP 内核 —');

  // Reloading (the reported "refresh does not help") must offer the gate again
  // rather than settling into a silent, gate-less state.
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator('.start-overlay')).toHaveCount(1);
  await page.locator('.start-btn').click();
  await page.waitForTimeout(1500);
  const again = await kernelLine(page);
  expect(again).not.toContain('DSP 内核 —');
});
