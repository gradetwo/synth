import { expect, test } from './fixtures';

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
const kernelLine = async (page: import('@playwright/test').Page) => {
  await page.locator('[data-act="settings"]').click();
  await page.getByRole('button', { name: '打开音频设置' }).click();
  const panel = await page.locator('.audio-settings.open').innerText();
  await page.keyboard.press('Escape');
  return panel.replace(/\s+/g, ' ');
};

test('a resume that is never answered still leaves a usable app', async ({ page }) => {
  test.setTimeout(60_000);
  // Firefox leaves `AudioContext.resume()` pending for a context it considers
  // blocked, and iOS can do the same when another app owns the session. The
  // start button must not sit on "starting…" for ever: the graph gets built,
  // the gate lifts, and the suspended hint offers the way back in.
  await page.addInitScript(() => {
    AudioContext.prototype.resume = function resume() {
      return new Promise(() => {});
    };
  });
  await page.goto('/');
  await page.waitForTimeout(800);
  await expect(page.locator('.start-overlay')).toHaveCount(1);

  await page.locator('.start-btn').click();
  // Bounded wait (the engine gives up after ~2.5 s), then the app is usable —
  // either the context started on its own or the suspended hint is offered.
  await expect(page.locator('.start-overlay')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.start-error')).toHaveCount(0);
  // The keyboard is there: the app is not a dead page.
  await expect(page.locator('.kbd-dock')).toBeVisible();
  // Whichever way it went, the transport is reachable: the synth is not gated.
  await expect(page.locator('.player-open')).toBeVisible();
});

/**
 * Chrome's real autoplay policy is what makes this one interesting: the context
 * comes back *running* with no graph in it. WebKit rejects the flag outright
 * ("Failed to parse 'user-gesture-required' as an autoplay policy"), which killed
 * the whole file there, so the policy lives in the Chromium project's launch
 * options (playwright.config.ts) and this file stays engine-neutral.
 */
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
