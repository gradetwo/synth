import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).tap();
  await expect(page.locator('.kbd-dock.open')).toBeVisible();
}

test.describe('multi-touch chords', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('three fingers hold a triad at once', async ({ page }) => {
    await boot(page);
    const keys = page.locator('.wkey');
    // C, E, G.
    const picks = [0, 2, 4];
    const boxes = [];
    for (const i of picks) {
      const box = await keys.nth(i).boundingBox();
      expect(box).not.toBeNull();
      boxes.push(box!);
    }

    for (let n = 0; n < picks.length; n++) {
      const box = boxes[n];
      await keys.nth(picks[n]).dispatchEvent('pointerdown', {
        pointerId: 10 + n,
        pointerType: 'touch',
        isPrimary: n === 0,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height - 6,
      });
    }

    await expect(page.locator('.wkey.down')).toHaveCount(3);
    await expect(page.locator('.nd-sub')).toContainText('3 VOICES');

    for (let n = 0; n < picks.length; n++) {
      const box = boxes[n];
      await keys.nth(picks[n]).dispatchEvent('pointerup', {
        pointerId: 10 + n,
        pointerType: 'touch',
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height - 6,
      });
    }
    await expect(page.locator('.wkey.down')).toHaveCount(0);
  });
});

test.describe('envelope handle dragging on touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a near-miss grab still moves the point', async ({ page }) => {
    await boot(page);
    const svg = page.locator('.adsr-svg').first();
    const handle = svg.locator('.adsr-handle').first(); // attack
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();

    const attackCell = page.locator('.adsr-cell').first().locator('input');
    const before = await attackCell.inputValue();

    // Grab ~20px below the tiny handle: outside the circle but inside the
    // generous touch grab radius.
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2 + 20;
    const opts = { pointerId: 3, pointerType: 'touch', isPrimary: true };
    await svg.dispatchEvent('pointerdown', { ...opts, clientX: startX, clientY: startY });
    await svg.dispatchEvent('pointermove', { ...opts, clientX: startX + 50, clientY: startY });
    await svg.dispatchEvent('pointerup', { ...opts, clientX: startX + 50, clientY: startY });

    const after = await attackCell.inputValue();
    expect(after).not.toBe(before);
  });
});

/**
 * The interface has to stay out of the browser's way.
 *
 * Everything on this page used to repaint every animation frame whether or not
 * anything had changed — the scope, the spectrum (36 gradients a frame), the
 * mini canvases, the meter readout — and the full-screen overlays blurred the
 * whole viewport behind them. On a software-rendered page that cost more than
 * the audio: measured 7.5 fps idle in headless Chromium against 60 fps once the
 * work was made demand-driven. This guards the regression, not the exact number.
 */
test.describe('interface frame cost', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const frames = (page: Page, ms: number) =>
    page.evaluate(
      (window_ms) =>
        new Promise<number>((resolve) => {
          let n = 0;
          const start = performance.now();
          const tick = () => {
            n += 1;
            if (performance.now() - start > window_ms) resolve(n);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          setTimeout(() => resolve(n), window_ms + 1500);
        }),
      ms,
    );

  test('the page keeps its frame rate while the engine runs', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await expect(page.locator('.kbd-dock.open')).toBeVisible();
    await page.waitForTimeout(500);
    const fps = (await frames(page, 1500)) / 1.5;
    // Generous on purpose: the point is to catch a return to per-frame
    // repainting (which measured 7 fps here), not to police a machine.
    expect(fps, `interface ran at ${fps.toFixed(1)} fps`).toBeGreaterThan(20);
  });
});
