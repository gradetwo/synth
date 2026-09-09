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

    // Remove LFO 2 and add it back from the palette.
    const lfo2 = page.locator('.flow-node[data-node="lfo2"]');
    await lfo2.locator('.flow-icon').last().click();
    await expect(page.locator('.flow-node[data-node="lfo2"]')).toHaveCount(0);
    await page.locator('.flow-chip', { hasText: 'LFO 2' }).click();
    await expect(page.locator('.flow-node[data-node="lfo2"]')).toHaveCount(1);

    // Expand the filter parameters.
    await filter.locator('.flow-icon', { hasText: '⤢' }).click();
    await expect(page.locator('.flow-params')).toBeVisible();
    await expect(page.locator('.flow-params')).toContainText('CUTOFF');
  });

  test('performance bar plays a track', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.flow-select')).toBeVisible();
    const play = page.locator('.flow-bar .player-play');
    await play.click();
    await expect(play).toHaveClass(/\bon\b/);
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

  test('opens as a bottom sheet above the keyboard', async ({ page }) => {
    await boot(page);
    await page.locator('.flow-node[data-node="filter"]').tap({ position: { x: 60, y: 46 } });
    const panel = page.locator('.flow-params');
    await expect(panel).toBeVisible();
    await expect(page.locator('.fp-grip')).toBeVisible();
    await page.waitForTimeout(350); // let the sheet slide-up animation settle

    const m = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const dock = document.querySelector('.kbd-dock')!.getBoundingClientRect();
      return { w: Math.round(r.width), bottom: Math.round(r.bottom), dockTop: Math.round(dock.top), vw: window.innerWidth };
    });
    expect(m.w).toBeGreaterThanOrEqual(m.vw - 2);
    expect(m.bottom).toBeLessThanOrEqual(m.dockTop + 1);
  });
});
