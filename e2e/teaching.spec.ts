import { expect, test, type Page } from '@playwright/test';

/**
 * Practice mode (P12.1).
 *
 * The three things this batch is accepted on, all through the real UI:
 *
 *   * the panel is reachable from the settings drawer and its code arrives as
 *     its own `Teaching-<hash>.js` chunk (the budget evidence proper is
 *     `npm run verify:budget`, which reads `dist/`);
 *   * choosing a scale really paints the target keys — the class is on the
 *     `[data-midi]` elements, so this is a DOM assertion, not a screenshot;
 *   * a correct take scores high and a wrong one scores low, with both numbers
 *     printed below. The keys are dispatched as real `keydown`/`keyup` events on
 *     `window`, i.e. through the app's own computer-keyboard path
 *     (`Keyboard.tsx` -> `noteBus` -> the panel's recorder), so the score is the
 *     score a player would get, not a value poked into the component.
 *
 * The take is anchored to the panel's own `data-state="recording"`: a page-side
 * interval watches for it and fires the first key within a couple of
 * milliseconds, so the result does not depend on how long a Playwright round
 * trip took on a busy host.
 */

const CHUNK = /Teaching-[\w-]+\.js$/;

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(300);
}

async function openPanel(page: Page) {
  await page.locator('[data-act="settings"]').click();
  const settings = page.locator('.settings-drawer.open');
  await expect(settings).toBeVisible();
  await settings.locator('[data-act="teach-open"]').click();
  const panel = page.locator('.teach-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('teaching', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opens from the settings drawer as its own chunk and highlights the target keys', async ({
    page,
  }) => {
    const chunks: string[] = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (CHUNK.test(path)) chunks.push(path);
    });

    await start(page);
    const panel = await openPanel(page);

    // Lazy chunk, reached by one `lazy()` row: the panel's code is not in the
    // entry bundle.
    expect(chunks.length, 'the teaching chunk never loaded').toBeGreaterThan(0);

    // Default exercise: C major from C3, one octave: 8 notes, all inside the
    // two-octave keyboard.
    await expect(panel.locator('[data-role="teach-target"]')).toContainText('C3');
    const painted = page.locator('.keyboard [data-midi].teach-target');
    await expect(painted).toHaveCount(8);
    const c3 = page.locator('.keyboard [data-midi="48"]');
    await expect(c3).toHaveClass(/teach-target/);
    await expect(c3).toHaveAttribute('data-teach-root', '1');
    // A key a semitone above the root is *not* in C major.
    await expect(page.locator('.keyboard [data-midi="49"]')).not.toHaveClass(/teach-target/);
    // The closing octave is part of the figure, and it is a root too.
    await expect(page.locator('.keyboard [data-midi="60"]')).toHaveClass(/teach-target/);
    await expect(page.locator('.keyboard [data-midi="60"]')).toHaveAttribute('data-teach-root', '1');

    // A different set repaints the highlight: C minor pentatonic has 6 notes.
    await panel.locator('[data-role="teach-set"]').selectOption('minorPentatonic');
    await expect(painted).toHaveCount(6);
    await expect(page.locator('.keyboard [data-midi="51"]')).toHaveClass(/teach-target/);
    await expect(page.locator('.keyboard [data-midi="52"]')).not.toHaveClass(/teach-target/);

    // The chord family resets the set and highlights an arpeggio: C3 E3 G3 C4.
    await panel.locator('[data-role="teach-kind"] [data-kind="chord"]').click();
    await expect(panel.locator('[data-role="teach-set"]')).toHaveValue('major');
    await expect(painted).toHaveCount(4);
    await expect(page.locator('.keyboard [data-midi="52"]')).toHaveClass(/teach-target/);
    await expect(page.locator('.keyboard [data-midi="53"]')).not.toHaveClass(/teach-target/);

    // The panel must not sit over the keyboard it is asking the player to use:
    // this click is a real hit test, so an overlapping panel or a mask would
    // fail it.
    await page.locator('.keyboard [data-midi="48"]').click();
    await expect(page.locator('.teach-panel')).toBeVisible();
  });

  test('scores a correct take high and a wrong take low', async ({ page }) => {
    await start(page);
    const panel = await openPanel(page);

    // The computer keyboard maps a=48, s=50, d=52, f=53, g=55, h=57, j=59, k=60
    // at octave 0 — exactly C major from C3.
    const onScale = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];
    // The black keys of the same octave: every one of them is outside C major.
    const offScale = ['w', 'e', 't', 'y', 'u', 'o', 'w', 'e'];
    const BPM = 90;

    /** Play `keys` on the beat, starting the moment the panel starts recording. */
    const playOnTheBeat = (keys: string[]) =>
      page.evaluate(
        ({ keys: list, beat }) =>
          new Promise<void>((resolve) => {
            const panelEl = document.querySelector('[data-role="teach-panel"]');
            const fire = () => {
              list.forEach((key, index) => {
                const at = index * beat;
                window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })), at);
                window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key })), at + 70);
              });
              window.setTimeout(resolve, (list.length - 1) * beat + 180);
            };
            const watch = window.setInterval(() => {
              if (panelEl?.getAttribute('data-state') === 'recording') {
                window.clearInterval(watch);
                fire();
              }
            }, 2);
          }),
        { keys, beat: 60000 / BPM },
      );

    const run = async (keys: string[]) => {
      // Reset is disabled until there is a take or a result to clear.
      const resetBtn = panel.locator('[data-act="teach-reset"]');
      if (await resetBtn.isEnabled()) await resetBtn.click();
      const performing = playOnTheBeat(keys);
      await panel.locator('[data-act="teach-start"]').click();
      await performing;
      await panel.locator('[data-act="teach-stop"]').click();
      const result = panel.locator('[data-role="teach-result"]');
      await expect(result).toBeVisible();
      await expect(panel).toHaveAttribute('data-state', 'done');
      return {
        score: Number(await result.getAttribute('data-score')),
        hitRate: Number(await result.getAttribute('data-hit-rate')),
        missed: Number(await result.getAttribute('data-missed')),
        extra: Number(await result.getAttribute('data-extra')),
        meanMs: Number(await result.getAttribute('data-mean-ms')),
      };
    };

    const good = await run(onScale);
    // The measured numbers, so the report can quote them from the test output.
    console.log(`teaching e2e · correct take: ${JSON.stringify(good)}`);
    expect(good.hitRate, 'the correct take should hit every note').toBe(1);
    expect(good.missed).toBe(0);
    expect(good.score, 'the correct take should score high').toBeGreaterThanOrEqual(80);

    const bad = await run(offScale);
    console.log(`teaching e2e · wrong take: ${JSON.stringify(bad)}`);
    expect(bad.hitRate, 'no off-scale note should count as a hit').toBe(0);
    expect(bad.score, 'the wrong take should score low').toBeLessThanOrEqual(20);
    expect(good.score - bad.score, 'the two scores must be far apart').toBeGreaterThanOrEqual(40);
  });
});
