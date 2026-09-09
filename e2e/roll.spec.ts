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

    // Zoom out so the whole clip and the empty area past it stay on screen.
    await page.locator('.roll-btn', { hasText: '−' }).first().click();
    await page.locator('.roll-btn', { hasText: '−' }).first().click();
    await page.waitForTimeout(200);
    // Draw a note in the empty area to the right of the clip. Coordinates come
    // from the scroll container, since the grid itself can be scrolled.
    const view = (await page.locator('.roll-scroll').boundingBox())!;
    // The top rows are padding above the highest note, so they are always free.
    await page.mouse.click(view.x + view.width - 120, view.y + 40);
    await expect(notes).toHaveCount(before + 1);

    // Drag the fresh note by its body: two beats left and two semitones up.
    const added = page.locator('.roll-note.sel');
    const from = (await added.boundingBox())!;
    const labelBefore = await added.getAttribute('aria-label');
    await page.mouse.move(from.x + 3, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 3 - 112, from.y + from.height / 2 - 40, { steps: 8 });
    await page.mouse.up();
    const to = (await added.boundingBox())!;
    expect(Math.round(to.x)).toBeLessThan(Math.round(from.x) - 60);
    // Pitch and position are both recorded in the accessible label; moving the
    // top note up extends the pitch window, so compare the label, not the y.
    expect(await added.getAttribute('aria-label')).not.toBe(labelBefore);

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
    // The written note has a real length and the playhead stepped past it.
    const length = Number(
      await page.locator('.roll-inspector .roll-field').nth(1).locator('input').inputValue(),
    );
    expect(length).toBeGreaterThan(0);
    const pos = await page.locator('.roll-pos').textContent();
    expect(pos).not.toContain('0.00 /');
  });

  test('note length follows the held key and stays editable', async ({ page }) => {
    await boot(page);
    await openRollFromBar(page);
    const notes = page.locator('.roll-note');
    const before = await notes.count();

    // Hold the first on-screen key for ~600 ms; the arpeggio runs at 100 BPM,
    // so the written note should be around one beat long.
    const key = page.locator('.roll-kbd .wkey').first();
    const box = (await key.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await expect(notes).toHaveCount(before + 1);

    const length = page.locator('.roll-inspector .roll-field').nth(1).locator('input');
    const played = Number(await length.inputValue());
    // ~600 ms at 100 BPM ≈ 1 beat; allow slack for a loaded CI worker.
    expect(played).toBeGreaterThan(0.4);
    expect(played).toBeLessThan(2.5);
    // Crucially it is not the fixed grid length a naive step input would write.
    expect(played).not.toBe(0.25);

    // The inspector edits the length and velocity of the selected note.
    await length.fill('2');
    await length.dispatchEvent('change');
    const width = await page.locator('.roll-note.sel').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(120);
    await page.locator('.roll-inspector input[type="range"]').fill('0.2');
    const opacity = await page
      .locator('.roll-note.sel')
      .evaluate((el) => Number((el as HTMLElement).style.opacity));
    expect(opacity).toBeLessThan(0.65);

    // Dragging the right edge lengthens the note further.
    const noteBox = (await page.locator('.roll-note.sel').boundingBox())!;
    await page.mouse.move(noteBox.x + noteBox.width - 3, noteBox.y + noteBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(noteBox.x + noteBox.width - 3 + 88, noteBox.y + noteBox.height / 2, { steps: 6 });
    await page.mouse.up();
    const wider = await page.locator('.roll-note.sel').evaluate((el) => el.getBoundingClientRect().width);
    expect(wider).toBeGreaterThan(width + 50);
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
