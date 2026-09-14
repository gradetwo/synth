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
 * First-interactive budget (P8.5).
 *
 * What is measured, and from where:
 *   * The clock is the page's own `performance.now()`, whose zero is
 *     `performance.timeOrigin` — the navigation start — so no timestamp crosses
 *     a CDP round trip and there is nothing to align by hand.
 *   * The observable is `.start-btn`, the gate's "启动音频引擎" button: the same
 *     element every other spec's `boot()` taps. "Interactive" is the moment the
 *     paint observer reports a first-contentful-paint while that button is in
 *     the DOM and enabled (`disabled` is only ever true while a start is
 *     already in flight); if the button turns up *after* that paint, the next
 *     animation frame resolves it. Paint is part of the definition on purpose:
 *     this box measures the button in the DOM at ~190 ms but the first paint of
 *     it at ~1 250 ms, so a DOM-only number would report a moment when the user
 *     still sees an empty screen.
 *   * `addInitScript` installs the poller before a single app byte runs, and a
 *     `PerformanceObserver` on `paint` supplies the FCP gate; engines without
 *     paint timing fall back to the first frame that shows an enabled button.
 *
 * Measured here (headless Chromium, software rendering, `vite preview`, dist
 * build — which is why the numbers are in the seconds, not the tens of ms):
 *   before P8.5 (1711.7 KB dist): 1 561 / 1 815 / 1 870 / 2 132 / 2 264 ms
 *   after  P8.5 (1662.8 KB dist): 1 595 / 1 872 / 1 878 / 1 971 / 1 973 / 2 096 ms
 *   in the full parallel `test:e2e` run: 2 450 ms (other workers booting too)
 * The icons change is off the critical path, so the before/after sides overlap:
 * boot time did not move. The budget is the slowest run seen under the real
 * suite (2 450 ms) plus ~30 %: it catches a boot that has actually regressed (an
 * extra round trip, a chunk that stopped being lazy, a blocking main-thread
 * task) without policing a busy host by a frame. `npm run verify` does not run
 * E2E; `npm run test:e2e` does.
 *
 * Since v1.111.0 this file is not in the parallel suite any more: the `perf`
 * project runs it alone with `--workers=1`, where boot measures roughly 0.6-1.4 s
 * rather than 2.4 s, so the 3200 ms line now has far more headroom than it was
 * set for. It is deliberately **not** tightened to the isolated number: the
 * budget's job is to catch a regression, and a machine with its own recorded
 * baseline can pin it with `GS1_BOOT_BUDGET_MS`.
 */
const BOOT_BUDGET_MS = Number(process.env.GS1_BOOT_BUDGET_MS ?? 3200);
/**
 * Attempts, not one sample.
 *
 * This measurement used to be taken while the whole parallel suite booted several
 * Chromium workers, so one navigation could land behind a scheduler stall and
 * read hundreds of milliseconds high. The project is isolated now (v1.111.0),
 * but the host can still be busy for reasons that are none of the app's
 * business. The fastest of a few attempts is the
 * closest thing to the app's own boot cost, because host load can only ever
 * make a run slower — the same rule `scripts/bench.mjs` uses for its machine
 * probe. It was measured that this is contention and not the app: with the host
 * busy, the build *before* P9.1b read 3 785 ms against this budget while the
 * band-limited one read 3 621 ms, so a single sample said "boot regressed"
 * about a change that only touched the wasm. `GS1_BOOT_BUDGET_MS` pins the
 * budget for a machine with its own recorded baseline.
 */
const BOOT_ATTEMPTS = 3;

test.describe('first interactive', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the start gate is clickable and painted inside the boot budget', async ({ page }) => {
    await page.addInitScript(() => {
      const boot = { interactive: -1, fcp: -1 };
      (window as unknown as { __gs1Boot: typeof boot }).__gs1Boot = boot;
      let painted = false;
      let done = false;
      const buttonReady = () => {
        const button = document.querySelector<HTMLButtonElement>('.start-btn');
        return Boolean(button && !button.disabled);
      };
      const settle = () => {
        if (done || !painted || !buttonReady()) return;
        done = true;
        boot.interactive = performance.now();
      };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              boot.fcp = entry.startTime;
              painted = true;
              settle();
            }
          }
        }).observe({ type: 'paint', buffered: true });
      } catch {
        // No paint timing anywhere: fall back to "the first frame that shows an
        // enabled button", which is the DOM-only reading this budget replaced.
        painted = true;
      }
      const tick = () => {
        settle();
        if (!done) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const attempts: number[] = [];
    let fcp = -1;
    for (let i = 0; i < BOOT_ATTEMPTS; i++) {
      await page.goto('/', { waitUntil: 'load' });
      await expect(page.locator('.start-btn')).toBeEnabled();
      // The FCP entry is delivered as its own task, so give it a moment; if it
      // never lands the assertion below fails with a readable message.
      await page
        .waitForFunction(
          () => (window as unknown as { __gs1Boot: { interactive: number } }).__gs1Boot.interactive >= 0,
          undefined,
          { timeout: 8_000 },
        )
        .catch(() => {});
      const boot = await page.evaluate(
        () =>
          (window as unknown as { __gs1Boot: { interactive: number; fcp: number } }).__gs1Boot,
      );
      attempts.push(boot.interactive);
      if (fcp < 0 && boot.fcp >= 0) fcp = boot.fcp;
    }
    const best = Math.min(...attempts);
    const all = attempts.map((v) => v.toFixed(0)).join(', ');
    const fcpText = fcp >= 0 ? `${fcp.toFixed(0)} ms` : 'n/a';
    // Two readers of this one line: a human, and `scripts/release.mjs`, which
    // parses `[boot-budget]` out of the captured stdout and re-checks it against
    // `GS1_BOOT_BUDGET_MS`. That is what makes the boot budget part of the
    // release gate without running the browser suite twice — keep the shape
    // stable if this ever changes.
    console.log(
      `[boot-budget] interactive ${best.toFixed(0)} ms of [${all}] · FCP ${fcpText} · budget ${BOOT_BUDGET_MS} ms`,
    );
    expect(best, 'the start button never became clickable').toBeGreaterThan(0);
    expect(
      best,
      `interactive best ${best.toFixed(0)} ms of [${all}], FCP ${fcpText} (budget ${BOOT_BUDGET_MS} ms)`,
    ).toBeLessThanOrEqual(BOOT_BUDGET_MS);
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
 *
 * P11.5 extends it from "the engine runs" to the two loads a player actually
 * spends time in: a song playing (the transport, the playhead, the player's own
 * nine canvases and the engine all at once) and the routing graph being edited
 * (the canvas, the wires, the card drag). Those are the states that used to be
 * the expensive ones, so they are the ones worth pinning to the same floor.
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

  /**
   * Floor for every load below. Generous on purpose: the point is to catch a
   * return to per-frame repainting (which measured 7 fps here), not to police a
   * machine.
   */
  const FPS_FLOOR = 20;

  /**
   * Best of a few windows, not one sample — the same rule the boot budget uses
   * above and `scripts/bench.mjs` uses for its machine probe. Until v1.111.0
   * these tests shared the machine with the rest of the suite, and one window
   * landing behind another worker's boot read 20.0 fps on one window and 40+ on
   * the next; the `perf` project now runs the file alone with one worker, which
   * is what made the windows agree (measured: 37.5-52.5 fps, all above the
   * floor, against 13.8-20.0 inside the parallel run). Best-of-N stays because
   * host load can only ever make a window slower, never faster, so the best
   * window is still the closest thing to the app's own cost. Five short windows
   * rather than three longer ones: a stall is a whole-window event, so more
   * windows is what finds a clean one, and five 800 ms windows cost less than
   * three of 1 200 ms.
   */
  const bestFps = async (page: Page, windowMs: number, tries: number) => {
    const samples: number[] = [];
    for (let i = 0; i < tries; i++) samples.push((await frames(page, windowMs)) / (windowMs / 1000));
    const best = Math.max(...samples);
    return { best, all: samples.map((v) => v.toFixed(1)).join(', ') };
  };

  const startEngine = async (page: Page) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await expect(page.locator('.kbd-dock.open')).toBeVisible();
  };

  test('the page keeps its frame rate while the engine runs', async ({ page }) => {
    test.setTimeout(120_000);
    await startEngine(page);
    await page.waitForTimeout(500);
    const { best, all } = await bestFps(page, 800, 5);
    console.log(`[fps] idle-with-engine best ${best.toFixed(1)} of [${all}] fps`);
    expect(best, `interface ran at ${best.toFixed(1)} fps of [${all}]`).toBeGreaterThan(FPS_FLOOR);
  });

  test('the page keeps its frame rate while a song plays', async ({ page }) => {
    test.setTimeout(180_000);
    await startEngine(page);

    // Open the player and start the first built-in track. The panel is lazily
    // loaded and its own chunk is warmed at idle, so the wait is the panel
    // mounting, not a cold fetch.
    const keyboard = page.locator('[data-kb="1"][aria-pressed="true"]');
    if (await keyboard.count()) {
      await keyboard.first().click();
      await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
    }
    await page.locator('.player-open').first().click({ force: true });
    const play = page.locator('.player-play').first();
    await expect(play).toBeVisible();
    await play.click();
    // The transport has to actually be running, otherwise this measures the
    // idle case a second time.
    await expect(play).toHaveClass(/on/);
    await page.waitForTimeout(700);

    const { best, all } = await bestFps(page, 800, 5);
    console.log(`[fps] playback best ${best.toFixed(1)} of [${all}] fps`);
    expect(best, `playback ran at ${best.toFixed(1)} fps of [${all}]`).toBeGreaterThan(FPS_FLOOR);
  });

  test('the page keeps its frame rate while the graph is edited', async ({ page }) => {
    test.setTimeout(180_000);
    await startEngine(page);

    const keyboard = page.locator('[data-kb="1"][aria-pressed="true"]');
    if (await keyboard.count()) {
      await keyboard.first().click();
      await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
    }
    await page.locator('[data-act="fx-graph"]').first().click({ force: true });
    await expect(page.locator('.fxg-panel')).toBeVisible();

    // Hold a card by its title and walk it around while frames are counted: a
    // static graph would not exercise the wire redraw this guard is for.
    const handle = page.locator('[data-act="drag-node"][data-node="1"]');
    const grab = (await handle.boundingBox())!;
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    const dragged = (async () => {
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(grab.x + grab.width / 2 + (i % 8) * 12, grab.y + grab.height / 2 + (i % 5) * 10);
        await page.waitForTimeout(60);
      }
    })();
    const { best, all } = await bestFps(page, 800, 5);
    await page.mouse.up();
    await dragged;

    console.log(`[fps] graph-edit best ${best.toFixed(1)} of [${all}] fps`);
    expect(best, `graph editing ran at ${best.toFixed(1)} fps of [${all}]`).toBeGreaterThan(FPS_FLOOR);
  });
});
