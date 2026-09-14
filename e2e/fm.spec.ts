import { expect, test, type Page } from './fixtures';

/**
 * FM / phase modulation and ring modulation (P6.1).
 *
 * The DSP side is measured in the Rust tests and in the audio gate; what these
 * end-to-end cases are for is the part only a browser can answer: are the two
 * controls reachable, do they survive a share link and a reload, and can the
 * modulation matrix actually choose them?
 */

async function boot(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /启动音频引擎/ }).click();
  // Wait for the start gate to lift, not just for the click to land. Until it
  // does, `.start-overlay` covers the whole page and eats the pointer: the knob
  // below never sees the drag. On a host where the engine cannot run, the gate
  // is the full two grace waits (~5 s, see `settleWithin` / `e2e/audio-host.ts`);
  // Chromium lifts it in well under the old 300 ms, which is why the race only
  // ever bit Firefox.
  await expect(page.locator('.start-overlay')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

/** Drag a knob by `pixels` upward: the knob's own gesture, not a setter. */
async function turn(page: Page, name: string, pixels: number) {
  const dial = page.getByRole('slider', { name, exact: true }).first();
  await dial.scrollIntoViewIfNeeded();
  const box = (await dial.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - pixels, { steps: 6 });
  await page.mouse.up();
  return Number(await dial.getAttribute('aria-valuenow'));
}

test.describe('FM and ring modulation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('has both controls on OSC 1 and keeps them with the patch', async ({ page, browser }) => {
    await boot(page);
    const osc1 = page.locator('[data-module-id="osc1"]');
    await expect(osc1).toBeVisible();

    const fm = osc1.getByRole('slider', { name: 'FM', exact: true });
    const ring = osc1.getByRole('slider', { name: 'RING', exact: true });
    await expect(fm).toBeVisible();
    await expect(ring).toBeVisible();
    // Off until asked for: an old patch has to sound exactly as it did.
    await expect(fm).toHaveAttribute('aria-valuenow', '0');
    await expect(ring).toHaveAttribute('aria-valuenow', '0');

    const fmValue = await turn(page, 'FM', 60);
    expect(fmValue).toBeGreaterThan(0.1);
    const ringValue = await turn(page, 'RING', 40);
    expect(ringValue).toBeGreaterThan(0.1);

    // A patch carries them: a share link reproduces the sound in a browser that
    // has never seen this one, which the receiver's empty storage proves.
    await page.getByRole('button', { name: '预设库' }).click();
    await page.locator('.preset-drawer button', { hasText: '分享' }).first().click();
    await expect.poll(async () => page.evaluate(() => location.hash)).toContain('gs1.');
    const url = await page.evaluate(() => location.href);

    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const receiver = await other.newPage();
    await receiver.goto(url);
    await receiver.getByRole('button', { name: /启动音频引擎/ }).click();
    await receiver.waitForTimeout(500);
    const shared = receiver
      .locator('[data-module-id="osc1"]')
      .getByRole('slider', { name: 'FM', exact: true });
    await expect(shared).toHaveAttribute('aria-valuenow', String(fmValue));
    await other.close();

    // …and a reload keeps them too: they are ordinary parameters.
    await page.reload();
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    const fmAfter = page
      .locator('[data-module-id="osc1"]')
      .getByRole('slider', { name: 'FM', exact: true });
    await expect(fmAfter).toHaveAttribute('aria-valuenow', String(fmValue));
  });

  test('can be chosen as modulation matrix destinations', async ({ page }) => {
    await boot(page);
    // The matrix lives in the modulation module; every destination is one option
    // in its select, and the two new ones have to be in that list.
    // The row has a source select first and a destination select second; pick
    // the one that carries the destination labels.
    const select = page
      .locator('[data-module-id="matrix"] select')
      .filter({ has: page.locator('option', { hasText: 'CUTOFF' }) })
      .first();
    await select.scrollIntoViewIfNeeded();
    const options = await select.locator('option').allTextContents();
    // Appended at the end of the list, which is where a share code expects them.
    expect(options.slice(-2)).toEqual(['FM', 'RING']);
    // A route can be pointed at FM, which is what makes an FM patch playable
    // from an envelope or the LFO.
    await select.selectOption({ label: 'FM' });
    await expect(select).toHaveValue('6');
    await select.selectOption({ label: 'RING' });
    await expect(select).toHaveValue('7');
  });
});

test.describe('sync, sub and noise', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('are reachable on the oscillators and travel with the patch', async ({ page, browser }) => {
    await boot(page);
    const osc1 = page.locator('[data-module-id="osc1"]');
    // Hard sync is a switch on OSC 1, next to FM and RING.
    const sync = osc1.locator('[role="group"][aria-label="SYNC"]');
    await sync.getByRole('button', { name: 'ON' }).click();
    // The sub oscillator has a segment and a level on each oscillator.
    const sub = osc1.locator('[role="group"][aria-label="SUB"]');
    await sub.getByRole('button', { name: '-1' }).click();
    const subLevel = await turn(page, 'SUB LVL', 40);
    expect(subLevel).toBeGreaterThan(0.4);
    const noise = await turn(page, 'NOISE', 30);
    expect(noise).toBeGreaterThan(0.05);
    await expect(sub.getByRole('button', { name: '-1' })).toHaveAttribute('aria-pressed', 'true');

    // A share link reproduces all three in a browser that has never seen this
    // one, which is what "they are patch parameters" means.
    await page.getByRole('button', { name: '预设库' }).click();
    await page.locator('.preset-drawer button', { hasText: '分享' }).first().click();
    await expect.poll(async () => page.evaluate(() => location.hash)).toContain('gs1.');
    const url = await page.evaluate(() => location.href);
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const receiver = await other.newPage();
    await receiver.goto(url);
    await receiver.getByRole('button', { name: /启动音频引擎/ }).click();
    await receiver.waitForTimeout(500);
    const received = receiver.locator('[data-module-id="osc1"]');
    await expect(
      received.locator('[role="group"][aria-label="SYNC"]').getByRole('button', { name: 'ON' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      received.locator('[role="group"][aria-label="SUB"]').getByRole('button', { name: '-1' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(received.getByRole('slider', { name: 'SUB LVL', exact: true })).toHaveAttribute(
      'aria-valuenow',
      String(subLevel),
    );
    await other.close();
  });
});
