import { expect, test } from './fixtures';

async function boot(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.getByRole('button', { name: '信号流' }).click();
  await expect(page.locator('.flow-view')).toBeVisible();
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

    const rows = await page.evaluate(() => {
      const out: { id: string; lit: number }[] = [];
      document.querySelectorAll('.flow-node').forEach((node) => {
        const canvas = node.querySelector('canvas') as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
        }
        out.push({ id: node.getAttribute('data-node') ?? '', lit });
      });
      return out;
    });

    expect(rows.length).toBe(10);
    for (const row of rows) {
      // Even bypassed nodes stay visible; enabled ones are far brighter.
      expect(row.lit, row.id).toBeGreaterThan(50);
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

    // The card fades in with a short scale animation, so poll until it settles.
    await expect
      .poll(
        () =>
          panel.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return Math.max(
              Math.abs(r.x + r.width / 2 - window.innerWidth / 2),
              Math.abs(r.y + r.height / 2 - window.innerHeight / 2),
            );
          }),
        { timeout: 4000 },
      )
      .toBeLessThan(3);

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

    await expect
      .poll(
        () =>
          panel.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return Math.max(
              Math.abs(r.x + r.width / 2 - window.innerWidth / 2),
              Math.abs(r.y + r.height / 2 - window.innerHeight / 2),
            );
          }),
        { timeout: 4000 },
      )
      .toBeLessThan(3);

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
        fill: scale.width / wrap.width,
        zoom: parseInt(document.querySelector('.flow-zoom-val')?.textContent ?? '100', 10),
      };
    });
    expect(m.count).toBe(10);
    expect(m.cols).toBe(2);
    expect(m.horizontal).toBe(true);
    expect(m.fill).toBeGreaterThan(0.85);
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
