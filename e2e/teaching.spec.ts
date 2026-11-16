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
 * The take is played on the recording's own clock: the panel publishes its
 * take anchor as `data-started-at` the moment the clock starts, and the
 * player below schedules every key against that anchor, so the result does
 * not depend on how long a Playwright round trip took on a busy host.
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

    /** Play `keys` on the beat, on the recording's own clock.
     *
     * The panel publishes `data-started-at` — the `performance.now()` anchor
     * of the take — synchronously when its count-in timer fires and the take
     * clock starts. This player waits for that attribute and schedules key i
     * at `anchor + i * beat` on the same `performance.now()` clock, so a key
     * lands on its grid point whatever the host's timer jitter is.
     *
     * The previous player *predicted* the anchor: it observed the `countin`
     * commit, added the nominal count-in and a 200 ms safety offset, and
     * fired from its own timer chain. The prediction error between the two
     * chains is run-varying (measured mean deviations of 109…234 ms on
     * WebKit, against 200.6 on Chromium, where the chains agree and the mean
     * is the offset itself); stacked on the offset it pushed notes past the
     * scorer's 300 ms window — the scheduled CI's WebKit leg failed with
     * hitRate 0.75/0.875 while every pitch was right. Anchoring to
     * `data-state="recording"` instead is not an option either: on WebKit
     * that React commit lands ~1.1 s after the clock starts (measured: take
     * onsets 1.258…5.805 s against targets 0…4.667 s).
     *
     * A value already present when this is called belongs to the previous
     * take (the panel clears it on start, but the read here races that
     * click), so only a *change* counts as the new take's anchor.
     *
     * Waiting for each key is a coarse timer plus a spin on the same clock
     * for the last stretch, because a page timer alone cannot place a key
     * inside the window on WebKit: the app's own main-thread load starves
     * timers once the engine runs (measured in this environment: a blank
     * page's timers are exact, the booted app's average ~140 ms late, up to
     * ~290 ms, and the recorded deviation matches the timer lateness to
     * ~1 ms — the recorder itself adds nothing). The coarse timer carries
     * 400 ms of headroom, more than the worst lateness measured, and the
     * spin covers the rest exactly; the events still travel the real path
     * (window keydown -> Keyboard.tsx -> noteBus -> the panel's recorder). */
    const playOnTheBeat = (keys: string[]) =>
      page.evaluate(
        ({ keys: list, beat }) =>
          new Promise<void>((resolve) => {
            const panelEl = document.querySelector('[data-role="teach-panel"]');
            const stale = panelEl?.getAttribute('data-started-at') ?? null;
            const SPIN_MS = 400;
            const spinUntil = (at: number) => {
              while (performance.now() < at) {
                // Deliberate busy-wait on the recording clock: the last
                // stretch before a key, where a timer callback would land
                // whenever the main thread happens to free up.
              }
            };
            const waitUntil = (at: number) =>
              new Promise<void>((done) => {
                const remaining = at - performance.now();
                if (remaining <= SPIN_MS) {
                  spinUntil(at);
                  done();
                  return;
                }
                window.setTimeout(() => {
                  spinUntil(at);
                  done();
                }, remaining - SPIN_MS);
              });
            const schedule = (anchor: number) => {
              void (async () => {
                for (const [index, key] of list.entries()) {
                  await waitUntil(anchor + index * beat);
                  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
                  window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key })), 70);
                }
                await waitUntil(anchor + (list.length - 1) * beat + 180);
                resolve();
              })();
            };
            const read = () => panelEl?.getAttribute('data-started-at') ?? null;
            const current = read();
            if (current !== null && current !== stale) {
              schedule(Number(current));
              return;
            }
            const observer = new MutationObserver(() => {
              const value = read();
              if (value !== null && value !== stale) {
                observer.disconnect();
                schedule(Number(value));
              }
            });
            if (panelEl) observer.observe(panelEl, { attributes: true, attributeFilter: ['data-started-at'] });
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
