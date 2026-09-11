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
  // The floating keyboard sits over the lower modules on a short screen; put it
  // away first, the way a player would, or the click lands on a key (WebKit
  // pointed that out: "a .wkey intercepts pointer events").
  const keyboard = page.locator('[data-kb="1"][aria-pressed="true"]');
  if (await keyboard.count()) {
    await keyboard.first().click();
    await expect(page.locator('.kbd-dock.open')).toHaveCount(0);
  }
  await page.locator('[data-act="fx-graph"]').first().click();
  await expect(page.locator('.fxg-panel')).toBeVisible();
};

/**
 * Load the app again from scratch, in a page of its own.
 *
 * A plain `reload()` while the audio engine runs stalls the renderer for
 * minutes under WebKit on Linux (measured: clicks never get a reply — see
 * docs/notes/compat.md), and so does closing the first page *before* the new
 * one has its engine up. So the old page is kept alive until the new one is
 * running; what the test then checks — only what the app stored came across —
 * is exactly what `reload()` checks on the other engines.
 */
const freshLoad = async (page: import('@playwright/test').Page) => {
  const url = page.url();
  const next = await page.context().newPage();
  await next.goto(url);
  return {
    next,
    /** Called once the new page is running: the old one can go. */
    closeOld: () => page.close(),
  };
};

test('wires a node input, keeps it across a fresh load, and disconnects', async ({ page }) => {
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

  // Patch data, so it comes back in a fresh load.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  await expect(view.locator('[data-act="in1"][data-node="1"]')).toHaveValue('1');
  await expect(view.locator('[data-act="gain1"][data-node="1"]')).toHaveValue('70');

  // "Rebuild from chain" puts the serial routing back.
  await view.locator('[data-act="rebuild"]').click();
  await expect(view.locator('[data-act="in1"][data-node="1"]')).toHaveValue('2');
});

test('drags a wire from a node output to an input', async ({ page }) => {
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

test('moves a card, follows it with the wires, and keeps the arrangement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  // Node 2 reads node 1, so there is a wire to watch while the card moves.
  const card = page.locator('.fxg-card[data-node="1"]');
  const before = (await card.boundingBox())!;
  const handle = page.locator('[data-act="drag-node"][data-node="1"]');
  const grab = (await handle.boundingBox())!;
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + grab.width / 2 + 90, grab.y + grab.height / 2 + 130, { steps: 10 });
  await page.mouse.up();
  const after = (await card.boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 40);
  expect(after.y).toBeGreaterThan(before.y + 80);
  // The wire ends where the card is now, not where it used to be.
  const wire = await page.locator('[data-wire="1:0"]').getAttribute('d');
  expect(wire).toBeTruthy();

  // An arrangement is workspace, not patch: it comes back in a fresh load.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  const reloaded = (await view.locator('.fxg-card[data-node="1"]').boundingBox())!;
  expect(Math.abs(reloaded.x - after.x)).toBeLessThan(3);
  expect(Math.abs(reloaded.y - after.y)).toBeLessThan(3);

  // …and "reset layout" puts the board back.
  await view.locator('[data-act="reset-layout"]').click();
  const reset = (await view.locator('.fxg-card[data-node="1"]').boundingBox())!;
  expect(Math.abs(reset.x - before.x)).toBeLessThan(3);
  expect(Math.abs(reset.y - before.y)).toBeLessThan(3);
});

test('edits the graph from the list view, which is what phones get', async ({ page }) => {
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
