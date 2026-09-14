// @vitest-environment node
/**
 * P13.4 tests for the shared frame-free interaction (`e2e/interact.mjs`).
 *
 * The file moved out of `e2e/fixtures.ts` so that `gs1.ui.click` and the E2E
 * suite click through one implementation. This suite pins the three properties
 * that matter for that move, with **no browser**: the verbs are driven against a
 * fake locator that records what was asked of it, because a real one would make
 * "the hit test ran" and "the hit test was skipped" invisible.
 *
 *   1. the normal path is unchanged: visibility, enabled, scroll, box and hit
 *      test all happen, and the click lands on the element's centre;
 *   2. a locator that does not receive pointer events retries and then fails
 *      with the timeout error (it does not hang and does not click anyway);
 *   3. **`force: true` skips the actionability checks** -- the defect this
 *      extraction fixes. `ClickOptions.force` existed in `fixtures.ts` and the
 *      hit-test loop ran unconditionally, so a forced click on an obscured
 *      element spun to the deadline. Without the `if (options.force)` branch in
 *      `frameFreePoint`, test 3 fails (proved by deleting the branch: the fake
 *      locator's `waitFor`/`isEnabled`/hit test are all reachable again).
 */
import { describe, it, expect, vi } from 'vitest';
import { interact, HIT_TEST, READ_BOX } from '../../e2e/interact.mjs';

/**
 * A locator that records every interaction. `opts.hits` decides the hit test;
 * `opts.enabled` the enabled check; `opts.box` the geometry.
 */
function fakeLocator(opts = {}) {
  const calls = [];
  const box = opts.box ?? { x: 100, y: 50, width: 40, height: 20 };
  const page = {
    keyboard: { down: vi.fn(async () => {}), up: vi.fn(async () => {}) },
    mouse: { click: vi.fn(async () => {}), move: vi.fn(async () => {}) },
    touchscreen: { tap: vi.fn(async () => {}) },
  };
  const locator = {
    calls,
    page: () => page,
    waitFor: vi.fn(async (state) => {
      calls.push(['waitFor', state?.state]);
      if (opts.waitForThrows) throw new Error('locator.waitFor: Timeout 30000ms exceeded.');
    }),
    isEnabled: vi.fn(async () => {
      calls.push(['isEnabled']);
      return opts.enabled ?? true;
    }),
    evaluate: vi.fn(async (fn, arg) => {
      if (arg === READ_BOX) {
        calls.push(['box']);
        return box;
      }
      if (arg && typeof arg === 'object' && arg[HIT_TEST]) {
        calls.push(['hitTest']);
        return opts.hits ?? true;
      }
      calls.push(['scroll']);
      return undefined;
    }),
    count: vi.fn(async () => opts.count ?? 1),
    first: vi.fn(() => locator),
    nth: vi.fn(() => locator),
    isChecked: vi.fn(async () => opts.checked ?? false),
  };
  return { locator, page, calls };
}

describe('interact.frameFreePoint — the normal path', () => {
  it('waits for visibility, checks enabled, scrolls, reads the box and hit-tests before clicking', async () => {
    const { locator, page, calls } = fakeLocator({ hits: true });
    const point = await interact.click(locator, { timeout: 500 });
    expect(calls).toEqual([['waitFor', 'visible'], ['isEnabled'], ['scroll'], ['box'], ['hitTest']]);
    // The element is at 100,50 with a 40x20 box: the centre is 120,60.
    expect(point).toBeUndefined();
    expect(page.mouse.click).toHaveBeenCalledWith(120, 60, { button: 'left', clickCount: 1, delay: undefined });
  });

  it('honours `position` as an offset inside the box', async () => {
    const { locator, page } = fakeLocator({ hits: true });
    await interact.click(locator, { timeout: 500, position: { x: 3, y: 4 } });
    expect(page.mouse.click).toHaveBeenCalledWith(103, 54, expect.anything());
  });

  it('tries again when the element does not receive pointer events, then fails with the timeout', async () => {
    const { locator, calls } = fakeLocator({ hits: false });
    await expect(interact.click(locator, { timeout: 120 })).rejects.toThrow(
      /waiting for element to receive pointer events/,
    );
    // It retried (more than one hit test) instead of clicking anyway.
    expect(calls.filter(([name]) => name === 'hitTest').length).toBeGreaterThan(1);
    expect(locator.page().mouse.click).not.toHaveBeenCalled();
  });

  it('waits for a disabled element instead of clicking it', async () => {
    const { locator, calls } = fakeLocator({ enabled: false });
    await expect(interact.click(locator, { timeout: 120 })).rejects.toThrow(/waiting for element to be enabled/);
    expect(calls.some(([name]) => name === 'hitTest')).toBe(false);
    expect(calls.filter(([name]) => name === 'isEnabled').length).toBeGreaterThan(1);
  });

  it('a plain click after the deadline does not fabricate a hit', async () => {
    const { locator, page } = fakeLocator({ hits: true });
    await interact.click(locator, { timeout: 500, trial: true });
    expect(page.mouse.click).not.toHaveBeenCalled();
  });
});

describe('interact.frameFreePoint — force skips the actionability checks (the P13.4 defect)', () => {
  it('clicks an element that never receives pointer events when force is set', async () => {
    const { locator, page, calls } = fakeLocator({ hits: false });
    await interact.click(locator, { force: true, timeout: 5000 });
    expect(page.mouse.click).toHaveBeenCalledTimes(1);
    // The whole point: no visibility wait, no enabled check, no hit test.
    expect(calls).toEqual([['scroll'], ['box']]);
    expect(calls.some(([name]) => name === 'waitFor')).toBe(false);
    expect(calls.some(([name]) => name === 'isEnabled')).toBe(false);
    expect(calls.some(([name]) => name === 'hitTest')).toBe(false);
    expect(page.mouse.click).toHaveBeenCalledWith(120, 60, expect.anything());
  });

  it('clicks a disabled element when force is set (Playwright\'s semantics)', async () => {
    const { locator, page, calls } = fakeLocator({ enabled: false });
    await interact.click(locator, { force: true, timeout: 5000 });
    expect(page.mouse.click).toHaveBeenCalledTimes(1);
    expect(calls.some(([name]) => name === 'isEnabled')).toBe(false);
  });

  it('reports `forced: true` from frameFreePoint, so the caller can tell', async () => {
    const { locator } = fakeLocator({ hits: false });
    const point = await interact.frameFreePoint(locator, { force: true });
    expect(point.forced).toBe(true);
    expect(point.x).toBe(120);
    expect(point.y).toBe(60);
  });

  it('still dispatches a touch tap and a hover with force', async () => {
    const tapped = fakeLocator({ hits: false });
    await interact.tap(tapped.locator, { force: true });
    expect(tapped.page.touchscreen.tap).toHaveBeenCalledWith(120, 60);
    const hovered = fakeLocator({ hits: false });
    await interact.hover(hovered.locator, { force: true });
    expect(hovered.page.mouse.move).toHaveBeenCalledWith(120, 60);
  });

  it('dblclick is two clicks through the same path', async () => {
    const { locator, page } = fakeLocator({ hits: false });
    await interact.dblclick(locator, { force: true });
    expect(page.mouse.click).toHaveBeenCalledWith(120, 60, expect.objectContaining({ clickCount: 2 }));
  });
});

describe('interact defaults', () => {
  it('setDefaultTimeout feeds the verb that has no explicit timeout', async () => {
    interact.setDefaultTimeout(1234);
    expect(interact.defaultTimeout()).toBe(1234);
    interact.setDefaultTimeout(120_000);
    expect(interact.defaultTimeout()).toBe(120_000);
  });

  it('refuses a nonsense default and keeps the previous one', () => {
    interact.setDefaultTimeout(500);
    interact.setDefaultTimeout(Number.NaN);
    expect(interact.defaultTimeout()).toBe(500);
    interact.setDefaultTimeout(120_000);
  });
});
