import { expect, test } from '@playwright/test';

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
    // The only direct bar button is the canvas reset; export/open-player
    // actions live in the player panel, not duplicated here.
    await expect(page.locator('.flow-bar > .flow-bar-btn')).toHaveCount(1);
    await expect(page.locator('.flow-bar > .flow-reset')).toHaveCount(1);
    await expect(page.locator('.flow-bar .flow-zoom .flow-bar-btn')).toHaveCount(3);
    const play = page.locator('.flow-bar .player-play');
    await play.click();
    await expect(play).toHaveClass(/\bon\b/);
  });
});

test.describe('flow view keyboard on phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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

  test('tapping a node toggles the card; empty canvas closes it', async ({ page }) => {
    await boot(page);
    const filter = page.locator('.flow-node[data-node="filter"]');
    const panel = page.locator('.flow-params');

    await filter.click({ position: { x: 70, y: 46 } });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('FILTER');

    // Tap the same node again collapses the card.
    await filter.click({ position: { x: 70, y: 46 } });
    await expect(panel).toHaveCount(0);

    // Open again, then click empty canvas.
    await filter.click({ position: { x: 70, y: 46 } });
    await expect(panel).toBeVisible();
    await page.locator('.flow-stage').click({ position: { x: 620, y: 370 } });
    await expect(panel).toHaveCount(0);
  });
});

test.describe('flow detail card on phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('opens as a bottom sheet at the screen edge (no dock in flow view)', async ({ page }) => {
    await boot(page);
    await page.locator('.flow-node[data-node="filter"]').tap({ position: { x: 60, y: 46 } });
    const panel = page.locator('.flow-params');
    await expect(panel).toBeVisible();
    await expect(page.locator('.fp-grip')).toBeVisible();
    // Flow view hands the screen to the graph, so the piano dock starts
    // tucked away and the sheet docks to the bottom of the viewport.
    await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
    await page.waitForTimeout(350); // let the sheet slide-up animation settle

    const m = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), bottom: Math.round(r.bottom), vw: window.innerWidth, vh: window.innerHeight };
    });
    expect(m.w).toBeGreaterThanOrEqual(m.vw - 2);
    expect(m.bottom).toBeLessThanOrEqual(m.vh + 1);
    expect(m.bottom).toBeGreaterThan(m.vh - 24);
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

test.describe('flow sheet swipe on phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('swiping the sheet down closes it', async ({ page }) => {
    await boot(page);
    await page.locator('.flow-node[data-node="filter"]').tap({ position: { x: 60, y: 46 } });
    const panel = page.locator('.flow-params');
    await expect(panel).toBeVisible();

    const grip = await page.locator('.fp-grip').boundingBox();
    expect(grip).not.toBeNull();
    const x = grip!.x + grip!.width / 2;
    const y = grip!.y + grip!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 120, { steps: 8 });
    await page.mouse.up();
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
