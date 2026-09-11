import { expect, test } from '@playwright/test';

/**
 * Effect routing editor (A1/A2).
 *
 * The graph is an alternative way of saying what the chain says, so the two
 * things worth guarding are that opening it does not change the sound, and that
 * a connection made here survives a reload (it is patch data, not UI state).
 */
test.use({ viewport: { width: 1400, height: 900 } });

const openEditor = async (page: import('@playwright/test').Page) => {
  await page.locator('[data-act="fx-graph"]').first().click();
  await expect(page.locator('.fxg-panel')).toBeVisible();
};

test('wires a node input, keeps it across a reload, and disconnects', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);

  await openEditor(page);
  // The graph is off until the first edit: the chain is in charge.
  await expect(page.locator('.fxg-hint')).toContainText('信号链');

  // Node 2 input 1 starts on node 1 (the chain). Send it to the dry bus instead
  // and give it a gain, which is a different sound and a different graph.
  const node2In1 = page.locator('[data-act="in1"][data-node="1"]');
  await expect(node2In1).toHaveValue('2');
  await node2In1.selectOption('1');
  await expect(page.locator('.fxg-hint')).toContainText('从左往右');
  await page.locator('[data-act="gain1"][data-node="1"]').fill('50');

  // The wire is drawn from the dry card to that input.
  await expect(page.locator('[data-wire="1:0"]')).toHaveCount(1);

  // Clicking the wire disconnects it, and the input reads "none".
  await page.locator('[data-wire="1:0"]').click({ force: true });
  await expect(node2In1).toHaveValue('0');
  await expect(page.locator('[data-wire="1:0"]')).toHaveCount(0);

  // Reconnect through the port buttons (the touch path: tap output, tap input).
  await page.locator('[data-act="port-dry"]').click();
  await page.locator('[data-act="port-in1"][data-node="1"]').click();
  await expect(node2In1).toHaveValue('1');
  await page.locator('[data-act="gain1"][data-node="1"]').fill('70');

  // Patch data, so it comes back after a reload.
  await page.reload();
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);
  await expect(page.locator('[data-act="in1"][data-node="1"]')).toHaveValue('1');
  await expect(page.locator('[data-act="gain1"][data-node="1"]')).toHaveValue('70');

  // "Rebuild from chain" puts the serial routing back.
  await page.locator('[data-act="rebuild"]').click();
  await expect(page.locator('[data-act="in1"][data-node="1"]')).toHaveValue('2');
});

test('drags a wire from a node output to an input', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  // Node 4's second input is empty; pull a wire from node 1's output to it.
  await expect(page.locator('[data-act="in2"][data-node="3"]')).toHaveValue('0');
  const from = (await page.locator('[data-act="port-out"][data-node="0"]').boundingBox())!;
  const to = (await page.locator('[data-act="port-in2"][data-node="3"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // A ghost wire follows the pointer while the button is held.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator('.fxg-wire.ghost')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('[data-act="in2"][data-node="3"]')).toHaveValue('2');
  await expect(page.locator('[data-wire="3:1"]')).toHaveCount(1);
});

test('edits the graph from the list view, which is what phones get', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);

  // A phone reaches it from the settings drawer (under the overflow menu) and
  // opens on the list rather than on a canvas that needs aiming.
  const openSettings = async () => {
    await page.locator('.top-more > .tbtn.icon').first().click();
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('.settings-drawer.open')).toBeVisible();
  };
  await openSettings();
  await page.locator('[data-act="fx-graph-open"]').click();
  await expect(page.locator('.fxg-panel')).toBeVisible();
  await expect(page.locator('.fxg-list')).toBeVisible();

  // Route node 3's second input from node 1 and turn its output on.
  const src = page.locator('[data-act="in2"][data-node="2"]');
  await src.selectOption('2');
  await page.locator('[data-act="toOut"][data-node="2"]').check();
  await expect(src).toHaveValue('2');

  // The panel fits the screen without a horizontal scrollbar.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Cancel with escape, and the choice is still there when it reopens.
  await page.keyboard.press('Escape');
  await expect(page.locator('.fxg-panel')).toHaveCount(0);
  await openSettings();
  await page.locator('[data-act="fx-graph-open"]').click();
  await expect(page.locator('[data-act="in2"][data-node="2"]')).toHaveValue('2');
});
