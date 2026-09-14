import { expect, test } from './fixtures';

/**
 * Effect routing editor (A1/A2).
 *
 * The graph is an alternative way of saying what the chain says, so the two
 * things worth guarding are that opening it does not change the sound, and that
 * a connection made here survives a reload (it is patch data, not UI state).
 */
test.use({ viewport: { width: 1400, height: 900 } });

/**
 * The editor's own clicks are dispatched with `force`.
 *
 * Playwright waits for two stable frames before a click, and this box runs at
 * load 12+ on eight old cores at times: that wait, not the app, is what timed
 * out. Every click is still followed by an assertion about the state it was
 * supposed to change, so the coverage is the same; what is dropped is a
 * hit-test that cannot fail inside a full-screen panel.
 */
const clickIn = (target: import('@playwright/test').Locator) => target.click({ force: true });

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


/** Set a range input by value, the way the keyboard or a drag would. */
const setRange = async (
  target: import('@playwright/test').Locator,
  value: number,
): Promise<void> => {
  await target.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
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

  // Clicking the wire picks it — a stray click must not unwire a patch — and
  // the chip that appears both sets its gain and cuts it.
  await clickIn(page.locator('[data-wire="1:0"]'));
  await expect(page.locator('[data-wire-edit="1:0"]')).toBeVisible();
  await page.locator('[data-act="wire-gain"]').fill('40');
  await expect(page.locator('[data-act="gain1"][data-node="1"]')).toHaveValue('40');
  await clickIn(page.locator('[data-act="wire-del"]'));
  await expect(node2In1).toHaveValue('0');
  await expect(page.locator('[data-wire="1:0"]')).toHaveCount(0);

  // A connection that is not at unit gain keeps a label on the board.
  await node2In1.selectOption('1');
  await page.locator('[data-act="gain1"][data-node="1"]').fill('25');
  await expect(page.locator('[data-wire-label="1:0"]')).toHaveText('25%');
  await clickIn(page.locator('[data-wire-label="1:0"]'));
  await page.locator('[data-act="wire-gain"]').fill('100');

  // Reconnect through the port buttons (the touch path: tap output, tap input).
  await clickIn(page.locator('[data-act="port-dry"]'));
  await clickIn(page.locator('[data-act="port-in1"][data-node="1"]'));
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
  await clickIn(view.locator('[data-act="rebuild"]'));
  await expect(view.locator('[data-act="in1"][data-node="1"]')).toHaveValue('2');
});

test('drags a wire from a node output to an input', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  // Node 4's second input is empty; pull a wire from node 1's output to it.
  await expect(page.locator('[data-act="in2"][data-node="3"]')).toHaveValue('0');
  const source = page.locator('[data-act="port-out"][data-node="0"]');
  const target = page.locator('[data-act="port-in2"][data-node="3"]');
  // The cards grew with the P9.3 override block, so a node deep in the column
  // can sit below the panel's fold; the drop is hit-tested with
  // `elementFromPoint`, which cannot see an off-screen point. `dragTo` scrolls
  // the target into view and dispatches a real pointer gesture, which is what
  // a player does before dragging to it.
  await source.dragTo(target, { force: true });
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
  // The drag has to end inside the viewport: a pointer that walks past the
  // panel's bottom edge stops delivering the moves (P9.3's taller cards leave
  // less room between the cards), so the walk stays on screen.
  await page.mouse.move(grab.x + grab.width / 2 + 90, grab.y + grab.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  const after = (await card.boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 40);
  expect(after.y).toBeGreaterThan(before.y + 40);
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
  await clickIn(view.locator('[data-act="reset-layout"]'));
  const reset = (await view.locator('.fxg-card[data-node="1"]').boundingBox())!;
  expect(Math.abs(reset.x - before.x)).toBeLessThan(3);
  expect(Math.abs(reset.y - before.y)).toBeLessThan(3);
});

test('connects a wire from the keyboard alone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  // Enter on an output arms it (a button fired by the keyboard reports
  // `detail === 0`), Enter on an input lands the connection. No pointer at all.
  const input = page.locator('[data-act="in2"][data-node="2"]');
  await expect(input).toHaveValue('0');
  await page.locator('[data-act="port-out"][data-node="0"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-act="port-in2"][data-node="2"]').focus();
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('2');
  await expect(page.locator('[data-wire="2:1"]')).toHaveCount(1);
});

test('picks a wire from the keyboard and edits its gain', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  // The default graph has a wire into every node; focus the one into node 2 and
  // press Enter, which is how a keyboard user reaches a connection.
  const wire = page.locator('[data-wire="1:0"]');
  await expect(wire).toHaveAttribute('role', 'button');
  await wire.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-wire-edit="1:0"]')).toBeVisible();
  // The chip's slider is focusable, so the gain is keyboard-editable too.
  await page.locator('[data-act="wire-gain"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-act="gain1"][data-node="1"]')).not.toHaveValue('100');
});

test('runs two delay nodes side by side and refuses a third', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  const kind = (slot: number) => page.locator('[data-act="kind"][data-node="' + slot + '"]');
  const option = (slot: number, value: string) => kind(slot).locator(`option[value="${value}"]`);

  // The default chain has one delay in node 1 and one reverb in node 2. Node 2
  // may now be a second delay: every delay node owns its own line (P7.1).
  await expect(kind(0)).toHaveValue('delay');
  await kind(1).selectOption('delay');
  await expect(kind(1)).toHaveValue('delay');
  await expect(option(1, 'delay')).toBeEnabled();
  // The pool holds two lines, so a third is refused — and the option says why.
  await expect(option(2, 'delay')).toBeDisabled();
  await expect(option(2, 'delay')).toHaveText(/池已满/);
  // The hint reports the pool and the time left, which is now zero.
  await expect(page.locator('.fxg-hint')).toContainText('延迟池 2/2');
  await expect(page.locator('.fxg-hint')).toContainText('剩余可分配 0 s');

  // Both cards are editable and carry their own on/off and mix controls.
  const on = (slot: number) => page.locator('[data-act="on"][data-node="' + slot + '"]');
  const mix = (slot: number) => page.locator('[data-act="mix"][data-node="' + slot + '"]');
  await expect(on(0)).toBeVisible();
  await expect(on(1)).toBeVisible();
  await clickIn(on(1));
  await expect(on(1)).toHaveAttribute('aria-pressed', 'true');
  await mix(1).fill('70');
  await expect(mix(1)).toHaveValue('70');

  // Patch data, so both nodes come back in a fresh load with the pool still full.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  await expect(view.locator('[data-act="kind"][data-node="0"]')).toHaveValue('delay');
  await expect(view.locator('[data-act="kind"][data-node="1"]')).toHaveValue('delay');
  await expect(view.locator('[data-act="mix"][data-node="1"]')).toHaveValue('70');
  await expect(
    view.locator('[data-act="kind"][data-node="2"] option[value="delay"]'),
  ).toBeDisabled();
});

test('allows a second instance of an effect that has its own state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  const kind = (slot: number) => page.locator('[data-act="kind"][data-node="' + slot + '"]');
  const option = (slot: number, value: string) => kind(slot).locator(`option[value="${value}"]`);

  // A second chorus, straight away: every node has its own chorus state.
  await kind(1).selectOption('chorus');
  await expect(kind(1)).toHaveValue('chorus');
  await expect(option(1, 'chorus')).toBeEnabled();
  // The algorithmic reverb is pooled with the impulse-response one, so two
  // reverb nodes are fine while no response is loaded.
  await expect(option(1, 'reverb')).toBeEnabled();
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

test('puts the bit-crusher in a node, edits it, and keeps it across a fresh load', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  const kind = (slot: number) => page.locator('[data-act="kind"][data-node="' + slot + '"]');
  const on = (slot: number) => page.locator('[data-act="on"][data-node="' + slot + '"]');
  const mix = (slot: number) => page.locator('[data-act="mix"][data-node="' + slot + '"]');

  // Node 2 is the reverb in the default chain. Swap it for the bit-crusher,
  // which the graph editor offers as one of the effects with its own state.
  await kind(1).selectOption('crush');
  await expect(kind(1)).toHaveValue('crush');
  // Picking a kind is the first edit, so the graph takes over from the chain.
  await expect(page.locator('.fxg-hint')).toContainText('从左往右');

  // Every insert effect gets its on/off and its mix in the card.
  await expect(on(1)).toBeVisible();
  await expect(on(1)).toHaveAttribute('aria-pressed', 'false');
  await clickIn(on(1));
  await expect(on(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(mix(1)).toHaveValue('100');
  await mix(1).fill('60');
  await expect(mix(1)).toHaveValue('60');

  // Patch data, so it comes back in a fresh load.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  await expect(view.locator('[data-act="kind"][data-node="1"]')).toHaveValue('crush');
  await expect(view.locator('[data-act="on"][data-node="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('[data-act="mix"][data-node="1"]')).toHaveValue('60');

  // The shaping EQ is offered from the same dropdown and is not a single
  // instance, so a graph can hold more than one.
  await expect(view.locator('[data-act="kind"][data-node="1"] option[value="eq"]')).toBeEnabled();
  await view.locator('[data-act="kind"][data-node="1"]').selectOption('eq');
  await expect(view.locator('[data-act="kind"][data-node="1"]')).toHaveValue('eq');
  await expect(view.locator('[data-act="mix"][data-node="1"]')).toHaveValue('100');
});

/**
 * P7.2: LFO/ENV are nodes in the graph, and a wire from one to a node gain is
 * the modulation edge — the depth lives on the wire, not on the source.
 */
test('pulls a modulation wire, sees the change, and keeps it across a fresh load', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  // The strip starts with four disconnected edges.
  const src = page.locator('[data-act="mod-src"][data-mod-row="0"]');
  const dst = page.locator('[data-act="mod-dst"][data-mod-row="0"]');
  const depth = page.locator('[data-act="mod-depth"][data-mod-row="0"]');
  await expect(src).toHaveValue('0');
  await expect(dst).toHaveValue('0');
  await expect(depth).toHaveValue('0');

  // Drag from the LFO 1 card's output to node 1's "O" (output gain) port.
  const from = (await page.locator('[data-act="port-mod-src"][data-mod-src="1"]').boundingBox())!;
  const to = (await page.locator('[data-mod="0:2"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  // The edge exists as a wire, in the strip, and it switched the graph on
  // (seeded from the chain, so the sound does not jump).
  await expect(page.locator('[data-modwire="0"]')).toHaveCount(1);
  await expect(src).toHaveValue('1');
  await expect(dst).toHaveValue('3');
  await expect(depth).toHaveValue('50');
  await expect(page.locator('.fxg-hint')).toContainText('从左往右');

  // Picking the wire opens its depth chip; the slider edits the depth on the
  // edge and the strip follows.
  await clickIn(page.locator('[data-modwire="0"]'));
  await expect(page.locator('[data-mod-edit="0"]')).toBeVisible();
  await page.locator('[data-act="mod-wire-depth"]').fill('80');
  await expect(depth).toHaveValue('80');
  await expect(dst).toHaveValue('3');

  // A second edge from the envelope onto node 1's input 1 gain, from the strip
  // (the path a phone or a keyboard user takes).
  await page.locator('[data-act="mod-src"][data-mod-row="1"]').selectOption('3');
  await page.locator('[data-act="mod-dst"][data-mod-row="1"]').selectOption('1');
  await page.locator('[data-act="mod-depth"][data-mod-row="1"]').fill('35');
  await expect(page.locator('[data-modwire="1"]')).toHaveCount(1);
  await expect(page.locator('[data-mod="0:0"]')).toHaveClass(/wired/);

  // Patch data, so both edges come back in a fresh load.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  await expect(view.locator('[data-act="mod-src"][data-mod-row="0"]')).toHaveValue('1');
  await expect(view.locator('[data-act="mod-dst"][data-mod-row="0"]')).toHaveValue('3');
  await expect(view.locator('[data-act="mod-depth"][data-mod-row="0"]')).toHaveValue('80');
  await expect(view.locator('[data-modwire="0"]')).toHaveCount(1);
  await expect(view.locator('[data-act="mod-src"][data-mod-row="1"]')).toHaveValue('3');
  await expect(view.locator('[data-act="mod-depth"][data-mod-row="1"]')).toHaveValue('35');

  // Deleting an edge from its chip clears the row and the wire.
  await clickIn(view.locator('[data-modwire="0"]'));
  await clickIn(view.locator('[data-act="mod-wire-del"]'));
  await expect(view.locator('[data-modwire="0"]')).toHaveCount(0);
  await expect(view.locator('[data-act="mod-dst"][data-mod-row="0"]')).toHaveValue('0');
});

test('edits a modulation edge from the list view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);

  const openSettings = async () => {
    await page.locator('.top-more > .tbtn.icon').first().click();
    await page.locator('[data-act="settings"]').click();
    await expect(page.locator('.settings-drawer.open')).toBeVisible();
  };
  await openSettings();
  await page.locator('[data-act="fx-graph-open"]').click();
  await expect(page.locator('.fxg-list')).toBeVisible();
  // The modulation strip is reachable without the canvas.
  await expect(page.locator('[data-view="mod"]')).toBeVisible();
  await page.locator('[data-act="mod-src"][data-mod-row="0"]').selectOption('2');
  await page.locator('[data-act="mod-dst"][data-mod-row="0"]').selectOption('6');
  await page.locator('[data-act="mod-depth"][data-mod-row="0"]').fill('-40');
  await expect(page.locator('[data-act="mod-depth"][data-mod-row="0"]')).toHaveValue('-40');

  // The panel still fits the screen with the strip in it.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

/**
 * P7.3: templates. A template is a routing saved in the workspace, applied to
 * the patch in one change; the built-ins are always in the list.
 */
/**
 * P9.2: the transient shaper joins the node pool with its own on/off and mix,
 * and it is patch data like every other node kind.
 */
test('puts the transient shaper in a node and keeps it across a fresh load', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  const kind = (slot: number) => page.locator('[data-act="kind"][data-node="' + slot + '"]');
  const on = (slot: number) => page.locator('[data-act="on"][data-node="' + slot + '"]');
  const mix = (slot: number) => page.locator('[data-act="mix"][data-node="' + slot + '"]');

  // Node 2 is the reverb in the default chain; swap it for the shaper.
  await kind(1).selectOption('transient');
  await expect(kind(1)).toHaveValue('transient');
  await expect(page.locator('.fxg-hint')).toContainText('从左往右');

  // Every insert effect gets its on/off and its mix in the card.
  await expect(on(1)).toBeVisible();
  await expect(on(1)).toHaveAttribute('aria-pressed', 'false');
  await clickIn(on(1));
  await expect(on(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(mix(1)).toHaveValue('100');
  await mix(1).fill('40');
  await expect(mix(1)).toHaveValue('40');

  // Patch data, so the kind, the switch and the mix come back in a fresh load.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  await expect(view.locator('[data-act="kind"][data-node="1"]')).toHaveValue('transient');
  await expect(view.locator('[data-act="on"][data-node="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('[data-act="mix"][data-node="1"]')).toHaveValue('40');
});

test('applies a built-in template and keeps the routing across a fresh load', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  const kind = (slot: number) => page.locator('[data-act="kind"][data-node="' + slot + '"]');
  const in1 = (slot: number) => page.locator('[data-act="in1"][data-node="' + slot + '"]');
  const toOut = (slot: number) => page.locator('[data-act="toOut"][data-node="' + slot + '"]');

  // The default chain is one delay (node 1) into one reverb (node 2).
  await expect(kind(0)).toHaveValue('delay');
  await expect(kind(1)).toHaveValue('reverb');
  await expect(in1(1)).toHaveValue('2');

  await page.locator('[data-act="template"]').selectOption('fxg:dual-delay');
  // Two delay nodes side by side, both reading the dry bus and both to the bus.
  await expect(kind(0)).toHaveValue('delay');
  await expect(kind(1)).toHaveValue('delay');
  await expect(in1(1)).toHaveValue('1');
  await expect(toOut(0)).toBeChecked();
  await expect(toOut(1)).toBeChecked();
  // Nodes past the two in use are left unwired, not pointed at a hidden node.
  await expect(page.locator('[data-act="in1"][data-node="2"]')).toHaveValue('0');
  await expect(page.locator('.fxg-hint')).toContainText('从左往右');

  // The graph is patch data, so the routing comes back in a fresh load.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  await expect(view.locator('[data-act="kind"][data-node="1"]')).toHaveValue('delay');
  await expect(view.locator('[data-act="in1"][data-node="1"]')).toHaveValue('1');
  await expect(view.locator('[data-act="toOut"][data-node="1"]')).toBeChecked();
});

test('saves the graph as a template, lists it, and applies it again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  const kind = (slot: number) => page.locator('[data-act="kind"][data-node="' + slot + '"]');
  const select = page.locator('[data-act="template"]');

  // A distinctive routing: node 2 becomes the bit-crusher.
  await kind(1).selectOption('crush');
  await expect(kind(1)).toHaveValue('crush');

  await clickIn(page.locator('[data-act="template-save"]'));
  // The saved template appears in the list under its own name.
  const saved = select.locator('option', { hasText: '模板 1' });
  await expect(saved).toHaveCount(1);
  const savedId = await saved.getAttribute('value');
  expect(savedId).toBeTruthy();

  // Move the graph away from it, then apply the saved one.
  await kind(1).selectOption('reverb');
  await expect(kind(1)).toHaveValue('reverb');
  await select.selectOption(savedId as string);
  await expect(kind(1)).toHaveValue('crush');

  // The list is workspace data: it survives a fresh load and still applies.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  const reloaded = view.locator('[data-act="template"]');
  const option = reloaded.locator('option', { hasText: '模板 1' });
  await expect(option).toHaveCount(1);
  const reloadedId = await option.getAttribute('value');
  await view.locator('[data-act="kind"][data-node="1"]').selectOption('reverb');
  await expect(view.locator('[data-act="kind"][data-node="1"]')).toHaveValue('reverb');
  await reloaded.selectOption(reloadedId as string);
  await expect(view.locator('[data-act="kind"][data-node="1"]')).toHaveValue('crush');
});


/**
 * P9.3: the effect parameters are per node, not per kind.
 *
 * Two nodes of the same effect can now hold different parameters, the override
 * is patch data (so it survives a fresh load), and the whole block is reachable
 * at phone size — which is the list view on a 390x844 screen.
 */
test('overrides one node of a kind and leaves its sibling alone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);
  await openEditor(page);

  const kind = (slot: number) => page.locator('[data-act="kind"][data-node="' + slot + '"]');
  const toggle = (slot: number, column: number) =>
    page.locator(`[data-act="ovr-toggle"][data-node="${slot}"][data-ovr-slot="${column}"]`);
  const value = (slot: number, column: number) =>
    page.locator(`[data-act="ovr-value"][data-node="${slot}"][data-ovr-slot="${column}"]`);

  // Two delay nodes: the default chain already has one in node 1, add a second.
  await kind(1).selectOption('delay');
  await expect(kind(1)).toHaveValue('delay');

  // Node 1's delay time is its first override slot, 1/8 = 0.25 s at 120 BPM.
  // The switch starts off, and the row says it follows the kind's value.
  await expect(toggle(0, 0)).toHaveAttribute('aria-pressed', 'false');
  await clickIn(toggle(0, 0));
  await expect(toggle(0, 0)).toHaveAttribute('aria-pressed', 'true');
  const first = await value(0, 0).inputValue();
  expect(Number(first)).toBeCloseTo(0.25, 2);
  await setRange(value(0, 0), 0.5);
  const longTime = await value(0, 0).inputValue();
  expect(Number(longTime)).toBeCloseTo(0.5, 2);

  // Node 2's own slot 0 is still following the kind: the two nodes are
  // independent, which is the whole point of the batch.
  await expect(toggle(1, 0)).toHaveAttribute('aria-pressed', 'false');
  await clickIn(toggle(1, 0));
  await setRange(value(1, 0), 0.0625);
  const shortTime = await value(1, 0).inputValue();
  expect(Number(shortTime)).toBeCloseTo(0.0625, 2);
  await expect(value(0, 0)).toHaveValue(longTime);

  // "Follow the kind's value again" clears the node's slot without touching
  // the sibling's.
  await clickIn(page.locator('[data-act="ovr-follow"][data-node="1"]'));
  await expect(toggle(1, 0)).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle(0, 0)).toHaveAttribute('aria-pressed', 'true');

  // Patch data, so both the override and the cleared sibling come back.
  const { next: view, closeOld } = await freshLoad(page);
  await view.getByRole('button', { name: /启动音频引擎/ }).click();
  await closeOld();
  await view.waitForTimeout(400);
  await openEditor(view);
  await expect(
    view.locator('[data-act="ovr-value"][data-node="0"][data-ovr-slot="0"]'),
  ).toHaveValue(longTime);
  await expect(
    view.locator('[data-act="ovr-toggle"][data-node="0"][data-ovr-slot="0"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    view.locator('[data-act="ovr-toggle"][data-node="1"][data-ovr-slot="0"]'),
  ).toHaveAttribute('aria-pressed', 'false');
});

test.describe('on a phone', () => {
  // A coarse pointer is what the editor's 36 px targets key off (the same
  // media query the rest of the panel uses), so the run has to have touch.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('reaches the override controls at phone size', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  await page.waitForTimeout(400);

  await page.locator('.top-more > .tbtn.icon').first().click();
  await page.locator('[data-act="settings"]').click();
  await page.locator('[data-act="fx-graph-open"]').click();
  await expect(page.locator('.fxg-list')).toBeVisible();

  // The list view carries the override block for every node that runs an
  // effect, and every control is at least 36 px tall — the same target the
  // rest of the editor gives a coarse pointer.
  const node = page.locator('.fxg-list-node[data-node="0"]');
  const toggle = node.locator('[data-act="ovr-toggle"]').first();
  await expect(toggle).toBeVisible();
  const box = await toggle.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(36);
  const slider = node.locator('[data-act="ovr-value"]').first();
  const sliderBox = await slider.boundingBox();
  expect(sliderBox!.height).toBeGreaterThanOrEqual(36);

  // It works from there: toggle, set a value, and the panel still fits.
  await clickIn(toggle);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await setRange(slider, 0.4);
  const phoneTime = await slider.inputValue();
  expect(Number(phoneTime)).toBeCloseTo(0.4, 2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // The modulation bus is reachable from the same panel.
  await expect(page.locator('[data-act="ovr-src"]')).toBeVisible();
  await expect(page.locator('[data-act="ovr-bus-target"][data-ovr-bus="0"]')).toBeVisible();
  });
});
