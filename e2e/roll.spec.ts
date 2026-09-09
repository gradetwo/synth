import { expect, test, type Page } from '@playwright/test';

/**
 * Piano-roll editor: entry points, drawing/dragging notes, step input from the
 * on-screen keyboard, and saving back to the player.
 */

async function boot(page: Page, touch = false) {
  await page.goto('/');
  const start = page.getByRole('button', { name: /启动音频引擎/ });
  if (touch) await start.tap();
  else await start.click();
  await page.waitForTimeout(250);
}

const openRollFromBar = async (page: Page) => {
  await page.locator('.top-actions .tbtn', { hasText: '钢琴卷帘' }).click();
  await page.waitForTimeout(500);
};

test.describe('piano roll on desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('draws, drags, deletes, undoes and saves notes', async ({ page }) => {
    await boot(page);
    await openRollFromBar(page);
    await expect(page.locator('.roll')).toBeVisible();
    await expect(page.locator('.roll-note').first()).toBeVisible();
    const notes = page.locator('.roll-note');
    const before = await notes.count();

    // Draw a note in the empty area to the right of the clip.
    const grid = (await page.locator('.roll-grid').boundingBox())!;
    await page.mouse.click(grid.x + grid.width - 60, grid.y + grid.height - 40);
    await expect(notes).toHaveCount(before + 1);

    // Drag the fresh note by its body: two beats left and two semitones up.
    const added = page.locator('.roll-note.sel');
    const from = (await added.boundingBox())!;
    await page.mouse.move(from.x + 3, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 3 - 112, from.y + from.height / 2 - 40, { steps: 8 });
    await page.mouse.up();
    const to = (await added.boundingBox())!;
    expect(Math.round(to.x)).toBeLessThan(Math.round(from.x) - 60);
    expect(Math.round(to.y)).toBeLessThan(Math.round(from.y) - 20);

    // Delete the selected note, then bring it back with undo.
    await page.keyboard.press('Delete');
    await expect(notes).toHaveCount(before);
    await page.keyboard.press('Control+z');
    await expect(notes).toHaveCount(before + 1);

    // Save: the built-in becomes a clip and the toast confirms it.
    await page.locator('.roll-btn.primary').click();
    await expect(page.locator('.toast')).toContainText('已保存');

    // Closing restores the app.
    await page.locator('.roll-head .d-close').click();
    await expect(page.locator('.roll.open')).toHaveCount(0);
  });

  test('step-enters notes from the on-screen keyboard', async ({ page }) => {
    await boot(page);
    await openRollFromBar(page);
    const notes = page.locator('.roll-note');
    const before = await notes.count();
    await page.locator('.roll-kbd .wkey').first().click();
    await expect(notes).toHaveCount(before + 1);
    // The playhead advanced by one grid step (1/16 = 0.25 beats).
    await expect(page.locator('.roll-pos')).toContainText('0.25');
  });

  test('opens from the player panel edit button', async ({ page }) => {
    await boot(page);
    await page.locator('.display-row .monitor-actions .demo-btn').click();
    await page.waitForTimeout(400);
    await page.locator('.player-actions .player-btn', { hasText: '编辑' }).click();
    await expect(page.locator('.roll')).toBeVisible();
    await expect(page.locator('.player.open')).toHaveCount(0);
  });
});

test.describe('piano roll on phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('opens from the overflow menu and fills the screen', async ({ page }) => {
    await boot(page, true);
    await page.locator('.top-more .tbtn').tap();
    await page.locator('.top-menu .tbtn', { hasText: '钢琴卷帘' }).tap();
    await page.waitForTimeout(500);

    const geo = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        roll: r('.roll'),
        scroll: r('.roll-scroll'),
        kbd: r('.roll-kbd'),
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    expect(geo.roll).not.toBeNull();
    expect(geo.roll!.w).toBeGreaterThan(geo.vw - 2);
    expect(geo.roll!.h).toBeGreaterThan(geo.vh - 2);
    // Grid and input keyboard both get real space.
    expect(geo.scroll!.h).toBeGreaterThan(320);
    expect(geo.kbd!.h).toBeGreaterThan(90);
    await expect(page.locator('.roll-note').first()).toBeVisible();

    // The toolbar scrolls horizontally on a phone instead of stacking rows,
    // and the save button at the far end stays reachable.
    const tools = await page.locator('.roll-tools').evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth + 4,
      h: Math.round(el.getBoundingClientRect().height),
    }));
    expect(tools.scrollable).toBe(true);
    expect(tools.h).toBeLessThan(90);
    await page.locator('.roll-tools').evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.locator('.roll-btn.primary').tap();
    await expect(page.locator('.toast')).toContainText('已保存');
  });
});
