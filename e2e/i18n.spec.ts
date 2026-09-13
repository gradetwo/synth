import { expect, test, type Page } from '@playwright/test';

/**
 * Switching the UI language (P11.2).
 *
 * The i18n table is split: the first-screen core stays inline and the rest
 * (player, piano roll, routing graph, guide, …) is registered from a lazy
 * module. The switch therefore has one thing to get wrong that the old
 * single-table version could not: if the layout commits *before* that module
 * arrives, every panel reads its key instead of its copy for however long the
 * chunk takes, and the user sees the UI flip from `player.title` to
 * `播放器`/`Player`.
 *
 * These tests pin both halves of the fix:
 *   * copy in a panel whose table is lazy is in the new language right after the
 *     switch;
 *   * the switch never paints a frame that shows a raw key name, and never
 *     travels through a third state — the observer below records every text
 *     change the DOM goes through and asserts on the whole transcript.
 */

async function boot(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await expect(page.locator('.kbd-dock.open')).toBeVisible();
}

/** Open the settings drawer, where the language button lives. */
async function openSettings(page: Page) {
  const keyboard = page.locator('[data-kb="1"][aria-pressed="true"]');
  if (await keyboard.count()) {
    await keyboard.first().click();
    await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
  }
  await page.locator('[data-act="settings"]').first().click({ force: true });
  await expect(page.locator('.settings-drawer.open')).toBeVisible();
}

/** The button that toggles the language; its title is written in the *other*. */
const langButton = (page: Page) =>
  page.locator('.settings-drawer .roll-btn[title="Switch to English"], .settings-drawer .roll-btn[title="切换为中文"]').first();

/**
 * Watch every character the page puts on screen until the returned stopper is
 * called, then hand back the transcript. A leaked key shows up here as
 * `player.title` (or `fxg.tpl`, `roll.bpm`, …), so a flash cannot hide behind a
 * fast assertion.
 */
async function recordText(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __gs1Text: string[] }).__gs1Text = seen;
    const record = () => seen.push(document.body.innerText);
    record();
    const observer = new MutationObserver(record);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    (window as unknown as { __gs1Observer: MutationObserver }).__gs1Observer = observer;
  });
}

async function stopRecording(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = window as unknown as { __gs1Observer: MutationObserver; __gs1Text: string[] };
    store.__gs1Observer.disconnect();
    return store.__gs1Text;
  });
}

/** The first dotted i18n key that leaked into a rendered frame, if any. */
function leakedKey(frames: string[]): string | null {
  const shape =
    /\b(?:app|top|panel|module|drawer|player|roll|clip|layer|take|fxg|flow|guide|changelog|settings|scene|inst|cc|midi|audio|wt|smp|ir|tuning|velocity|err)\.[a-zA-Z][a-zA-Z0-9]*/;
  for (const frame of frames) {
    const match = frame.match(shape);
    if (match) return match[0];
  }
  return null;
}

test.describe('language switch', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('updates lazy panels too, without a key-name flash', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);

    // Open the player *before* switching: its copy lives in the lazy table, so
    // the switch has to reach a panel the core does not own.
    // The display row renders two of these (an icon-only copy for narrow
    // screens and a labelled one); pick the labelled one this viewport shows.
    await page.locator('.player-open:not(.icon-only)').first().click({ force: true });
    await expect(page.locator('.player-transport')).toBeVisible();
    await expect(page.locator('.player-quantise')).toContainText('量化');

    // The open player is a modal, so it has to be closed before the settings
    // gear is reachable. It stays mounted (and keeps its strings), which is
    // enough: the assertions below still read a lazy panel's copy.
    await page.locator('.player-head .d-close').click();
    await expect(page.locator('.player-mask.show')).toHaveCount(0);

    await openSettings(page);
    await recordText(page);
    await langButton(page).click();
    // Land in both the eager drawer and the lazy panel before reading back.
    await expect(page.locator('.settings-drawer')).toContainText('Settings');
    await expect(page.locator('.player-quantise')).toContainText('Quantise');

    const frames = await stopRecording(page);
    expect(frames.length, 'the text observer recorded nothing').toBeGreaterThan(1);
    const leaked = leakedKey(frames);
    expect(leaked, `a raw i18n key was painted during the switch: ${leaked}`).toBeNull();
    // The transcript has exactly two states, in order: the switch must not pass
    // through a third one (which is what a mid-load commit would look like).
    expect(frames[0]).toContain('设置');
    expect(frames[0]).not.toContain('Settings');
    expect(frames[frames.length - 1]).toContain('Settings');
  });

  test('is remembered across a reload, first frame included', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);
    await openSettings(page);
    await langButton(page).click();
    await expect(page.locator('.settings-drawer')).toContainText('Settings');

    await page.reload();
    // The core table covers the boot gate and the module grid, so both are in
    // the new language on the first frame — no lazy module involved.
    await expect(page.locator('.start-btn')).toContainText('Start Audio Engine');
    await expect(page.locator('.modules')).toContainText('FILTER');
    await expect(page.locator('.modules')).toContainText('Filter');
  });
});
