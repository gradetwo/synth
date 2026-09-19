import { expect, test } from './fixtures';

async function boot(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.getByRole('button', { name: '信号流' }).click();
  await expect(page.locator('.flow-view')).toBeVisible();
}

/**
 * Put the detail card's entrance animation at its final state and report how far
 * the rendered card is from the centre of the *layout* viewport, whether it has
 * reached its natural size, and that nothing is still animating.
 *
 * Why the animation has to be settled first: `.flow-params` is `position: fixed;
 * left: 50%; top: 50%; transform: translate(-50%, -50%)` and `@keyframes fp-in`
 * starts at `translate(-50%, -48%) scale(.97)`. The card is centred only at the
 * animation's *end*; mid-flight its rect centre is `0.02 * card height` lower
 * than the layout centre, plus the scale's own displacement. Headless WebKit
 * under this box's starved compositor never advances the animation at all:
 * measured here, `getAnimations()` reports `fp-in` at `currentTime: 0,
 * progress: 0` immediately after it appears *and still* 1.8 s later, with the
 * computed transform stuck at `matrix(0.97, 0, 0, 0.97, -215, -168.24)` — the
 * `from` keyframe. `document.getAnimations()` therefore does not finish on its
 * own there, and `getBoundingClientRect()` faithfully reports the frozen
 * mid-flight position: 457.00999 for a 900 px viewport (`0.02 * 350.5 = 7.01`
 * lower) and 430.44 on the phone (`0.02 * 422 = 8.44` lower). Chromium and
 * Firefox advance (and finish) the animation normally and read 450 / 422.
 *
 * That made the old assertion measure the engine's animation clock rather than
 * the card's layout, so this helper finishes the animation first — the state a
 * user's browser reaches 0.22 s after the card opens — and then asserts the
 * rendered centre against `documentElement.clientWidth/clientHeight`, the layout
 * viewport a fixed element is positioned in. A regression in `left`/`top`, in
 * `translate(-50%, -50%)`, or a `transform` left at the wrong value all move
 * this number; a card stuck mid-animation fails `settled` instead of being
 * silently accepted, and `settled` also insists the card is back at its natural
 * size (the animation's `scale(.97)`) and wholly inside the layout viewport.
 */
function settleCard(el: Element) {
  const box = el as HTMLElement;
  const animations = box.getAnimations();
  animations.forEach((a) => a.finish());
  const doc = document.documentElement;
  const r = box.getBoundingClientRect();
  const scaleSettled =
    Math.abs(r.width - box.offsetWidth) <= 1 && Math.abs(r.height - box.offsetHeight) <= 1;
  return {
    dx: r.x + r.width / 2 - doc.clientWidth / 2,
    dy: r.y + r.height / 2 - doc.clientHeight / 2,
    settled:
      animations.every((a) => a.playState === 'finished') &&
      scaleSettled &&
      r.left >= 0 &&
      r.top >= 0 &&
      r.right <= doc.clientWidth &&
      r.bottom <= doc.clientHeight,
  };
}

/** The `settleCard` numbers, for `expect.poll`. */
async function cardCentring(panel: import('@playwright/test').Locator) {
  return panel.evaluate(settleCard);
}

test.describe('signal flow view', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders nodes, drags, bypasses and adds/removes', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.flow-node')).toHaveCount(10);

    // Drag the filter node.
    const filter = page.locator('.flow-node[data-node="filter"]');
    const before = (await filter.boundingBox())!;
    await page.mouse.move(before.x + 60, before.y + 12);
    await page.mouse.down();
    await page.mouse.move(before.x + 160, before.y + 72, { steps: 8 });
    await page.mouse.up();
    const after = (await filter.boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x + 50);
    expect(after.y).toBeGreaterThan(before.y + 20);

    // Bypass OSC 1.
    const osc1 = page.locator('.flow-node[data-node="osc1"]');
    await osc1.locator('.flow-icon').first().click();
    await expect(osc1).toHaveClass(/off/);
    await expect(osc1.locator('.flow-bypass')).toBeVisible();

    // Remove LFO 2: the restore chip appears in the toolbar, never over the
    // canvas, and the reset button sits with the zoom controls.
    const lfo2 = page.locator('.flow-node[data-node="lfo2"]');
    await lfo2.locator('.flow-icon').last().click();
    await expect(page.locator('.flow-node[data-node="lfo2"]')).toHaveCount(0);
    const bar = (await page.locator('.flow-bar').boundingBox())!;
    const chip = (await page.locator('.flow-chip', { hasText: 'LFO 2' }).boundingBox())!;
    expect(chip.y).toBeGreaterThanOrEqual(bar.y - 1);
    expect(chip.y + chip.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
    await page.locator('.flow-chip', { hasText: 'LFO 2' }).click();
    await expect(page.locator('.flow-node[data-node="lfo2"]')).toHaveCount(1);

    // Removing a node and hitting the toolbar reset brings the default back.
    await lfo2.locator('.flow-icon').last().click();
    await expect(page.locator('.flow-node[data-node="lfo2"]')).toHaveCount(0);
    await page.locator('.flow-reset').click();
    await expect(page.locator('.flow-node')).toHaveCount(10);

    // Expand the filter parameters.
    await filter.locator('.flow-icon', { hasText: '⤢' }).click();
    await expect(page.locator('.flow-params')).toBeVisible();
    await expect(page.locator('.flow-params')).toContainText('CUTOFF');
  });

  test('performance bar plays a track and stays concise', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.flow-select')).toBeVisible();
    // Zoom and reset live on the canvas board, not in the performance bar, and
    // export/open-player actions live in the player panel.
    await expect(page.locator('.flow-bar > .flow-bar-btn')).toHaveCount(0);
    await expect(page.locator('.flow-hud .flow-reset')).toHaveCount(1);
    await expect(page.locator('.flow-hud .flow-zoom .flow-bar-btn')).toHaveCount(3);
    const hud = (await page.locator('.flow-hud').boundingBox())!;
    const board = (await page.locator('.flow-canvas-wrap').boundingBox())!;
    expect(hud.x).toBeGreaterThanOrEqual(board.x - 1);
    expect(hud.y).toBeGreaterThanOrEqual(board.y - 1);
    expect(hud.x + hud.width).toBeLessThan(board.x + board.width / 2);
    const play = page.locator('.flow-bar .player-play');
    await play.click();
    await expect(play).toHaveClass(/\bon\b/);
  });
});

test.describe('flow view keyboard on phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('canvas HUD owns zoom/reset and the bar stays a clean transport', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).tap();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '信号流' }).tap();
    await page.waitForTimeout(900);

    const geo = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) };
      };
      return {
        hud: r('.flow-hud'),
        board: r('.flow-canvas-wrap'),
        firstNode: r('.flow-node'),
        time: r('.player-time'),
        reset: r('.flow-reset'),
        select: r('.flow-select'),
        transport: r('.flow-bar .player-transport'),
      };
    });
    // HUD pinned to the board's top-left corner…
    expect(geo.hud!.x - geo.board!.x).toBeLessThan(20);
    expect(geo.hud!.y - geo.board!.y).toBeLessThan(20);
    // …and the graph starts below it, so nothing hides underneath.
    expect(geo.firstNode!.y).toBeGreaterThanOrEqual(geo.hud!.bottom - 1);
    // The reset no longer sits on top of the elapsed time.
    expect(geo.reset!.right).toBeLessThan(geo.time!.x);
    // Two clean rows: track select, then the transport beneath it.
    expect(geo.transport!.y).toBeGreaterThanOrEqual(geo.select!.bottom - 2);
  });

  test('auto-hides the dock but the keyboard toggle brings it back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).tap();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '信号流' }).tap();
    await page.waitForTimeout(700);

    // Flow view starts without the piano so the graph gets the screen.
    await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
    await expect(page.locator('.dock-show')).toBeVisible();

    // The show-keyboard pill still works and the canvas makes room for it.
    await page.locator('.dock-show').tap();
    await expect(page.locator('.kbd-dock.open')).toBeVisible();
    const geo = await page.evaluate(() => {
      const wrap = document.querySelector('.flow-canvas-wrap')!.getBoundingClientRect();
      const spacer = document.querySelector('.dock-spacer')!.getBoundingClientRect();
      return { bottom: Math.round(wrap.bottom), spacerTop: Math.round(spacer.top), vh: window.innerHeight };
    });
    expect(geo.bottom).toBeLessThanOrEqual(geo.spacerTop + 2);
    expect(geo.spacerTop).toBeLessThan(geo.vh);
  });
});

test.describe('signal flow animation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('nodes redraw and wires flow while a note sounds', async ({ page }) => {
    await boot(page);
    const key = page.locator('.wkey').first();
    const box = (await key.boundingBox())!;
    await key.dispatchEvent('pointerdown', {
      pointerId: 31,
      pointerType: 'touch',
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height - 6,
    });

    const snap = (id: string) =>
      page
        .locator(`.flow-node[data-node="${id}"] canvas`)
        .evaluate((el) => (el as HTMLCanvasElement).toDataURL());

    await page.waitForTimeout(350);
    const first = await snap('osc1');
    await page.waitForTimeout(300);
    const second = await snap('osc1');
    expect(first).not.toBe(second);

    // The wire/glow "active" state follows the analyser level.
    await expect(page.locator('.flow-stage')).toHaveClass(/active/);
    const wire = page.locator('.flow-wire.flow').first();
    await expect(wire).toHaveCSS('animation-name', 'flow-dash');

    await key.dispatchEvent('pointerup', { pointerId: 31, pointerType: 'touch' });
  });
});

test.describe('signal flow live content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('wires track the node during the drag, not only on release', async ({ page }) => {
    await boot(page);
    const filter = page.locator('.flow-node[data-node="filter"]');
    const wire = page.locator('.flow-edge[data-edge="filter"] .flow-wire.base'); // filter -> env
    const before = await wire.getAttribute('d');
    const box = (await filter.boundingBox())!;

    await page.mouse.move(box.x + 60, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 90, { steps: 6 });
    const during = await wire.getAttribute('d');
    expect(during).not.toBe(before);
    await page.mouse.up();
  });

  test('every node canvas draws visible content, not a black box', async ({ page }) => {
    await boot(page);
    const key = page.locator('.wkey').first();
    const box = (await key.boundingBox())!;
    await key.dispatchEvent('pointerdown', {
      pointerId: 41,
      pointerType: 'touch',
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height - 6,
    });
    await page.waitForTimeout(600);

    // One frame is not a measurement here: these mini-visuals animate, and
    // `fx2` draws ten short echo strokes whose length follows the animation
    // phase. A single arbitrary frame of it covers between ~50 and ~100 pixels
    // (measured on headless WebKit in this harness: 94, 94, 92, 100, 90, then 56
    // three seconds in; the baseline run recorded exactly 50), which is exactly
    // how this test went flaky against its `> 50` line -- the failing run read
    // 50 and the retry passed. So union the lit pixels of several frames
    // spanning more than one pulse period: the quantity becomes "which pixels
    // does this node light up at any point in its animation", which is what
    // "draws visible content" means and which no single sampling instant can
    // race.
    const rows = await page.evaluate(async () => {
      const nodes = [...document.querySelectorAll('.flow-node')];
      const canvases = nodes.map((n) => n.querySelector('canvas') as HTMLCanvasElement);
      // Each draw starts with `clearRect`, so the canvas' background is
      // transparent black: a pixel with alpha is ink, and R+G+B says how bright
      // that ink is against that background.
      const lit = canvases.map((c) => new Uint8Array(c.width * c.height));
      const peak = canvases.map(() => 0);
      const sample = () => {
        canvases.forEach((canvas, i) => {
          const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let p = 0, k = 0; k < data.length; k += 4, p++) {
            const sum = data[k] + data[k + 1] + data[k + 2];
            if (data[k + 3] > 0 && sum > 60) lit[i][p] = 1;
            if (sum > peak[i]) peak[i] = sum;
          }
        });
      };
      sample();
      // 12 x 200 ms: the fastest pulse here cycles in ~1.3 s and the slowest
      // idle breath in ~5 s, so this window always sees each node drawn at more
      // than one phase.
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        sample();
      }
      return nodes.map((node, i) => ({
        id: node.getAttribute('data-node') ?? '',
        lit: lit[i].reduce((a, b) => a + b, 0),
        peak: peak[i],
      }));
    });

    expect(rows.length).toBe(10);
    for (const row of rows) {
      // Even bypassed nodes stay visible; enabled ones are far brighter.
      // Measured with the note held, over the window above and on three engines:
      // the thinnest node is always `fx2` at 90 (Firefox) / 92 (WebKit) / 96
      // (Chromium), then `fx` at 1540-1806 and `lfo2` at ~2640, and every other
      // node is above 3000 -- so the threshold stays where it was and now sits
      // 1.8x below the weakest reading instead of inside the pulse. A "black
      // box" (a canvas that is never drawn, or one filled with a dark colour)
      // lights nothing at all, and `peak` catches the second case
      // independently: the dimmest ink the palette can draw is the bypass grey
      // `#8a93a7` (R+G+B = 452), so a canvas whose brightest pixel is below 200
      // is not drawing its visual.
      expect(row.lit, `${row.id}: visible pixels`).toBeGreaterThan(50);
      expect(row.peak, `${row.id}: ink contrast against the canvas`).toBeGreaterThan(200);
    }
    await key.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'touch' });
  });
});

test.describe('flow detail card', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('tapping a node opens the card; the mask closes it', async ({ page }) => {
    await boot(page);
    const filter = page.locator('.flow-node[data-node="filter"]');
    const panel = page.locator('.flow-params');

    await filter.click({ position: { x: 70, y: 46 } });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('FILTER');

    // The centred card is modal, so the backdrop dismisses it.
    await page.locator('.flow-params-mask').click({ position: { x: 20, y: 20 } });
    await expect(panel).toHaveCount(0);

    // Opening it again still works.
    await filter.click({ position: { x: 70, y: 46 } });
    await expect(panel).toBeVisible();
  });
});

test.describe('flow detail card layout', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('is the real module card, centred on screen', async ({ page }) => {
    await boot(page);
    await page.locator('.flow-node[data-node="filter"]').click({ position: { x: 60, y: 46 } });
    const panel = page.locator('.flow-params');
    await expect(panel).toBeVisible();
    await page.waitForTimeout(300);

    // The card fades in with a short scale animation, so poll until it settles,
    // then read the centre in the layout viewport's coordinates -- the frame a
    // `position: fixed` card is positioned in.
    await expect
      .poll(async () => (await cardCentring(panel)).settled, { timeout: 4000 })
      .toBe(true);
    const centre = await cardCentring(panel);
    expect(Math.abs(centre.dx)).toBeLessThan(3);
    expect(Math.abs(centre.dy)).toBeLessThan(3);

    const m = await panel.evaluate((el) => ({
      hasHead: !!el.querySelector('.module-head'),
      grip: el.querySelectorAll('.module-grip').length,
      collapse: el.querySelectorAll('.module-collapse').length,
    }));
    // It really is the module card: frame + head, no grid-only chrome.
    expect(m.hasHead).toBe(true);
    expect(m.grip).toBe(0);
    expect(m.collapse).toBe(0);
    await expect(panel).toContainText('CUTOFF');
  });
});

test.describe('flow detail card on phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('opens centred and closes from the mask', async ({ page }) => {
    await boot(page);
    await page.locator('.flow-node[data-node="filter"]').tap({ position: { x: 60, y: 46 } });
    const panel = page.locator('.flow-params');
    await expect(panel).toBeVisible();
    // Flow view hands the screen to the graph, so the piano dock starts away.
    await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
    await page.waitForTimeout(300);

    // Settle the entrance animation, then measure against the layout viewport.
    await expect
      .poll(async () => (await cardCentring(panel)).settled, { timeout: 4000 })
      .toBe(true);
    const centre = await cardCentring(panel);
    expect(Math.abs(centre.dx)).toBeLessThan(3);
    expect(Math.abs(centre.dy)).toBeLessThan(3);

    await page.locator('.flow-params-mask').tap({ position: { x: 8, y: 8 } });
    await expect(panel).toHaveCount(0);
  });
});

test.describe('flow keyboard and sheet gestures', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('nodes are focusable, open with Enter and move with arrows', async ({ page }) => {
    await boot(page);
    const filter = page.locator('.flow-node[data-node="filter"]');
    await filter.focus();
    await expect(filter).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('.flow-params')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.flow-params')).toHaveCount(0);

    const left = () => filter.evaluate((el) => parseFloat((el as HTMLElement).style.left));
    const top = () => filter.evaluate((el) => parseFloat((el as HTMLElement).style.top));
    const x0 = await left();
    const y0 = await top();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await left()).toBeGreaterThan(x0);
    expect(await top()).toBeGreaterThan(y0);
  });
});

test.describe('flow detail card dismissal', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('closes from the ✕ button and from the mask', async ({ page }) => {
    await boot(page);
    const panel = page.locator('.flow-params');
    await page.locator('.flow-node[data-node="filter"]').click({ position: { x: 60, y: 46 } });
    await expect(panel).toBeVisible();
    await page.locator('.flow-params-close').click();
    await expect(panel).toHaveCount(0);

    await page.locator('.flow-node[data-node="filter"]').click({ position: { x: 60, y: 46 } });
    await expect(panel).toBeVisible();
    await page.locator('.flow-params-mask').click({ position: { x: 8, y: 8 } });
    await expect(panel).toHaveCount(0);
  });
});

test.describe('signal flow zoom and phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('phones get two columns and an auto-fit canvas', async ({ page }) => {
    await boot(page);
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.flow-canvas-wrap')!.getBoundingClientRect();
      const scale = document.querySelector('.flow-scale')!.getBoundingClientRect();
      const nodes = [...document.querySelectorAll('.flow-node')].map((n) => n.getBoundingClientRect());
      const xs = [...new Set(nodes.map((n) => Math.round(n.x)))];
      return {
        cols: xs.length,
        count: nodes.length,
        // Fills the width (small symmetric slack), vertical scrolling allowed.
        horizontal: nodes.every((n) => n.x >= wrap.x - 1 && n.right <= wrap.right + 1),
        // How much of the canvas box the fitted graph uses in each dimension;
        // see the assertion below for why both are read.
        fillW: scale.width / wrap.width,
        fillH: scale.height / wrap.height,
        zoom: parseInt(document.querySelector('.flow-zoom-val')?.textContent ?? '100', 10),
      };
    });
    expect(m.count).toBe(10);
    expect(m.cols).toBe(2);
    expect(m.horizontal).toBe(true);
    // Auto-fit, measured in the canvas' limiting dimension. On this 390x844
    // phone the two-column graph is 384x590 while the canvas area is ~530 px
    // tall, so the fit is *height*-limited on purpose: the app lands the graph
    // on one screen (zoom 82 %, scale 313x481) and leaves the width at
    // 313/370 = 84.6 % used. Reading the width alone therefore measured 0.8459
    // on headless Linux WebKit and 0.8607 on Chromium -- a red/green split
    // driven by ~10 px of engine chrome height, i.e. it reported the host, not
    // the layout (the phone class itself is right on both: `data-device` reads
    // `phone`, which is why the column assertion above passes). The fit still
    // has to fill the box, so the check keeps its teeth: a canvas that
    // collapsed towards the app's 0.32 zoom floor fails both dimensions
    // (0.32 / 0.35), and `zoom` below still catches a canvas that never fitted.
    expect(Math.max(m.fillW, m.fillH)).toBeGreaterThan(0.85);
    expect(m.zoom).toBeLessThan(100);
  });
});

test.describe('signal flow zoom controls', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('plus, minus and fit change the zoom', async ({ page }) => {
    await boot(page);
    const label = page.locator('.flow-zoom-val');
    // Fit once so the baseline does not race the initial auto-fit effect.
    await page.getByRole('button', { name: '适应全部节点' }).click();
    await page.waitForTimeout(150);
    const start = parseInt((await label.textContent()) ?? '100', 10);

    await page.getByRole('button', { name: '放大' }).click();
    const zoomedIn = parseInt((await label.textContent()) ?? '100', 10);
    expect(zoomedIn).toBeGreaterThan(start);

    await page.getByRole('button', { name: '缩小' }).click();
    await page.getByRole('button', { name: '缩小' }).click();
    const zoomedOut = parseInt((await label.textContent()) ?? '100', 10);
    expect(zoomedOut).toBeLessThan(start);

    await page.getByRole('button', { name: '适应全部节点' }).click();
    const fitted = parseInt((await label.textContent()) ?? '100', 10);
    expect(Math.abs(fitted - start)).toBeLessThanOrEqual(2);
  });
});
