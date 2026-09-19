// @vitest-environment node
/**
 * P13.4 tests for the shared frame-free interaction (`e2e/interact.mjs`).
 *
 * The file moved out of `e2e/fixtures.ts` so that `gs1.ui.click` and the E2E
 * suite click through one implementation. This suite pins the properties that
 * matter for that move, with **no browser**: the verbs are driven against a
 * fake locator that records what was asked of it, because a real one would make
 * "the hit test ran" and "the hit test was skipped" invisible.
 *
 *   1. the normal path is unchanged: visibility, enabled, scroll, box and hit
 *      test all happen, and the click lands on the element's centre;
 *   2. a locator that does not receive pointer events retries and then fails
 *      with the timeout error (it does not hang and does not click anyway);
 *   3. **`force: true` skips the actionability checks** -- the defect that
 *      extraction fixed. `ClickOptions.force` existed in `fixtures.ts` and the
 *      hit-test loop ran unconditionally, so a forced click on an obscured
 *      element spun to the deadline. Without the `if (options.force)` branch in
 *      `frameFreePoint`, test 3 fails (proved by deleting the branch: the fake
 *      locator's `waitFor`/`isEnabled`/hit test are all reachable again);
 *   4. **the gesture is self-checking**: a click the engine never dispatches is
 *      retried and then fails with `no click event reached …`, and a click that
 *      arrives on a *different* target is retried too. `swallow`/`swallowTarget`
 *      reproduce the macOS WebKit defect deterministically (the probe log
 *      `clicks-x3.log` shows pointerdown + pointerup with no click at all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interact, HIT_TEST, READ_BOX, GESTURE_SLOT } from '../../e2e/interact.mjs';

// The self-check only runs when it is enabled (`auto` = macOS WebKit, where the
// defect lives, because on Linux headless WebKit a press costs seconds -- see
// the comment on `selfCheckEnabled`). These tests are about that path, so they
// turn it on; the gate itself is pinned separately below.
beforeEach(() => interact.setSelfCheck('1'));

/** The globals the page-side callbacks of `interact.mjs` resolve by name. */
const PAGE_GLOBALS = ['window', 'document'];

/**
 * A locator that records every interaction. `opts.hits` decides the hit test;
 * `opts.enabled` the enabled check; `opts.box` the geometry.
 *
 * The fake **models the one thing the self-check reads**: the recorder. It is a
 * tiny DOM built from the primitives a real page has -- `window.addEventListener`
 * with a capture flag, `Event.target`, `Element.contains` -- so the closure in
 * `watchClickEvent` is *executed*, not mocked away, and the press emits the
 * events the engine would: `pointerdown`, `pointerup`, then the `click` /
 * `dblclick` unless `opts.swallow` says the engine drops it. `opts.swallowTarget`
 * makes the event land on something that is neither the element nor a descendant
 * (an overlay); `opts.detachOnPress` models an app that acts on the press and
 * removes the node, so `locator.count()` then answers 0.
 */
function fakeLocator(opts = {}) {
  const calls = [];
  const box = opts.box ?? { x: 100, y: 50, width: 40, height: 20 };

  // The element itself, plus an unrelated node that is *not* inside it.
  const element = Object.assign(Object.create(null), { name: 'element', parentElement: null });
  // A real `contains` answers "is this node the element or inside it"; in this
  // fake the only node inside the element is the element itself.
  element.contains = (node) => node === element;
  const overlay = Object.assign(Object.create(null), { name: 'overlay', parentElement: null, contains: () => false });

  /**
   * The recorder `watchClickEvent` installs, modelled faithfully: a state
   * object with a sequence number and the events the engine delivered, plus
   * `window.addEventListener('...', fn, true)` for the four input types. The
   * `via` closure is executed (not stubbed), so `el.contains(target)` is really
   * evaluated.
   */
  const win = {};
  win.addEventListener = (type, fn) => {
    (win.__listeners || (win.__listeners = [])).push({ type, fn });
  };
  const doc = { addEventListener: () => {} };

  /** One press: the engine emits what `opts` says it emits. */
  let gesture = 0;
  let detached = false;
  const press = (wanted) => {
    gesture += 1;
    const state = win[GESTURE_SLOT] ?? { seq: 0, events: [], armed: false };
    win[GESTURE_SLOT] = state;
    const dropClick = gesture <= (opts.swallow ?? 0);
    const clickTarget = gesture <= (opts.swallowTarget ?? 0) ? overlay : (opts.target ?? element);
    // A real press is pointerdown + pointerup; on the engines that drop the
    // click both of those still arrive.
    for (const type of ['pointerdown', 'pointerup']) {
      state.seq += 1;
      state.events.push({ seq: state.seq, type, targetIsElement: true });
    }
    if (opts.detachOnPress) detached = true;
    if (!dropClick) {
      state.seq += 1;
      state.events.push({ seq: state.seq, type: wanted, targetIsElement: clickTarget === element });
    }
  };

  const hadGlobals = new Map(PAGE_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  /**
   * Run a callback the way a browser would: with `window` and `document`
   * resolvable from inside it. The real helper's callbacks are stringified into
   * the page, so they close over nothing; here they run in Node, where those
   * two names are temporarily installed as globals for the duration of the call.
   * (`Element` is not needed: the recorder duck-types its target.)
   */
  const inPage = (fn) => {
    for (const name of PAGE_GLOBALS) {
      Object.defineProperty(globalThis, name, {
        value: name === 'window' ? win : doc,
        configurable: true,
      });
    }
    try {
      return fn();
    } finally {
      for (const name of PAGE_GLOBALS) {
        const descriptor = hadGlobals.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  };

  const page = {
    keyboard: { down: vi.fn(async () => {}), up: vi.fn(async () => {}) },
    // Playwright's `page.evaluate(fn, arg)`: `arg` is the callback's *first*
    // parameter. (The element-first shape belongs to `locator.evaluate`, just
    // below; getting these two the wrong way round is the bug this fake pins.)
    evaluate: vi.fn(async (fn, arg) => inPage(() => fn(arg))),
    mouse: {
      // The dispatch is `page.mouse.click` / `mouse.dblclick` (Playwright's own
      // press, with a `delay`), exactly as `interact.mjs` sends it; the fake
      // emits what `opts` says the engine delivers in response.
      move: vi.fn(async () => {}),
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
      click: vi.fn(async () => press('click')),
      dblclick: vi.fn(async () => press('dblclick')),
    },
    touchscreen: {
      tap: vi.fn(async () => press('click')),
    },
  };
  const locator = {
    calls,
    page: () => page,
    toString: () => 'locator(".fake")',
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
      if (Array.isArray(arg) && arg[0] === GESTURE_SLOT) {
        calls.push(['watchClick']);
        return inPage(() => fn(element, arg));
      }
      calls.push(['scroll']);
      return undefined;
    }),
    count: vi.fn(async () => (detached ? 0 : opts.count ?? 1)),
    first: vi.fn(() => locator),
    nth: vi.fn(() => locator),
    isChecked: vi.fn(async () => opts.checked ?? false),
  };
  return { locator, page, calls, doc, element, win };
}

describe('interact.frameFreePoint — the normal path', () => {
  it('waits for visibility, checks enabled, scrolls, reads the box and hit-tests before clicking', async () => {
    const { locator, page, calls } = fakeLocator({ hits: true });
    const point = await interact.click(locator, { timeout: 500 });
    expect(calls).toEqual([
      ['waitFor', 'visible'],
      ['isEnabled'],
      ['scroll'],
      ['box'],
      ['hitTest'],
      ['watchClick'],
    ]);
    // The element is at 100,50 with a 40x20 box: the centre is 120,60.
    expect(point).toBeUndefined();
    expect(page.mouse.click).toHaveBeenCalledWith(120, 60, { button: 'left', clickCount: 1, delay: 30 });
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
    // The whole point: no visibility wait, no enabled check, no hit test. The
    // self-check's recorder arming is not an actionability check, so it is
    // still there -- and it is what proves the click actually landed.
    expect(calls).toEqual([['scroll'], ['box'], ['watchClick']]);
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

  it('dblclick is a real double click through the same path', async () => {
    const { locator, page } = fakeLocator({ hits: false });
    await interact.dblclick(locator, { force: true });
    // Two down/up pairs with a non-zero press, *not* one `clickCount: 2` click:
    // measured on WebKit (Playwright 1.63, macOS and Linux headless alike), the
    // latter emits no `dblclick` event at all, so an `onDoubleClick` handler
    // never runs. See the comment on `interact.dblclick`.
    expect(page.mouse.dblclick).toHaveBeenCalledWith(120, 60, { button: 'left', delay: 60 });
  });

  it('dblclick keeps a caller-supplied press delay', async () => {
    const { locator, page } = fakeLocator({ hits: true });
    await interact.dblclick(locator, { timeout: 500, delay: 120 });
    expect(page.mouse.dblclick).toHaveBeenCalledWith(120, 60, { button: 'left', delay: 120 });
  });
});

describe('the self-check — a gesture the engine drops is retried, not accepted', () => {
  it('recovers when the first press produces no click event at all', async () => {
    // Exactly the macOS WebKit shape: pointerdown/pointerup arrived, the click
    // did not. `swallow: 1` drops the event from the first press only.
    const { locator, page } = fakeLocator({ hits: true, swallow: 1 });
    await interact.click(locator, { timeout: 5000 });
    expect(page.mouse.click).toHaveBeenCalledTimes(2);
  });

  it('recovers when the first click landed on an overlay instead of the element', async () => {
    const { locator, page } = fakeLocator({ hits: true, swallowTarget: 1 });
    await interact.click(locator, { timeout: 5000 });
    expect(page.mouse.click).toHaveBeenCalledTimes(2);
  });

  it('fails after the deadline when a completed press never produces a click (the control is not silently clicked)', async () => {
    const { locator, page } = fakeLocator({ hits: true, swallow: 999 });
    await expect(interact.click(locator, { timeout: 4000 })).rejects.toThrow(
      /no click event reached locator\("\.fake"\) in 4000ms/,
    );
    // It really retried (several presses), and it did *not* report success.
    expect(page.mouse.click.mock.calls.length).toBeGreaterThan(1);
  });

  it('accepts a press the app consumed (the node is gone before a window listener could see the click)', async () => {
    // The Linux headless WebKit shape: `pointerdown` and `pointerup` on the
    // element with no observable click, because the app acted on it and
    // detached the node. One press, no retry.
    const { locator, page } = fakeLocator({ hits: true, swallow: 999, detachOnPress: true });
    await interact.click(locator, { timeout: 5000 });
    expect(page.mouse.click).toHaveBeenCalledTimes(1);
  });

  it('does not relax the hit test: a forced click still skips actionability but is self-checked', async () => {
    const { locator, page, calls } = fakeLocator({ hits: false, swallow: 1 });
    await interact.click(locator, { force: true, timeout: 5000 });
    expect(page.mouse.click).toHaveBeenCalledTimes(2);
    expect(calls.some(([name]) => name === 'hitTest')).toBe(false);
    expect(calls.some(([name]) => name === 'isEnabled')).toBe(false);
  });

  it('retries dblclick until a dblclick event with the right target arrives', async () => {
    const { locator, page } = fakeLocator({ hits: true, swallow: 1 });
    await interact.dblclick(locator, { timeout: 5000 });
    expect(page.mouse.dblclick).toHaveBeenCalledTimes(2);
  });

  it('fails a dblclick that never produces the event', async () => {
    const { locator, page } = fakeLocator({ hits: true, swallow: 999 });
    await expect(interact.dblclick(locator, { timeout: 4000 })).rejects.toThrow(
      /no dblclick event reached locator\("\.fake"\) in 4000ms/,
    );
    expect(page.mouse.dblclick.mock.calls.length).toBeGreaterThan(1);
  });

  it('retries a tap until the click the touch pipeline synthesises arrives', async () => {
    // Measured, not assumed: `page.touchscreen.tap` produces pointerdown,
    // touchstart, pointerup, touchend, mousedown, mouseup **and** click, 8/8 on
    // all three engines (`.tmp/probe-tap-*.log`), so the same check is honest.
    const { locator, page } = fakeLocator({ hits: true, swallow: 1 });
    await interact.tap(locator, { timeout: 5000 });
    expect(page.touchscreen.tap).toHaveBeenCalledTimes(2);
  });

  it('leaves `trial` alone: no dispatch, no event, no failure', async () => {
    const { locator, page } = fakeLocator({ hits: true, swallow: 999 });
    await interact.click(locator, { timeout: 200, trial: true });
    await interact.dblclick(locator, { timeout: 200, trial: true });
    await interact.tap(locator, { timeout: 200, trial: true });
    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(page.mouse.dblclick).not.toHaveBeenCalled();
    expect(page.touchscreen.tap).not.toHaveBeenCalled();
  });

  it('keeps a caller-supplied delay (including 0) and passes the other options through', async () => {
    const { locator, page } = fakeLocator({ hits: true });
    await interact.click(locator, {
      timeout: 500,
      delay: 0,
      button: 'right',
      clickCount: 2,
      modifiers: ['Shift'],
    });
    // A caller-supplied `delay` (here 0) is passed through verbatim, and
    // `button` / `clickCount` / `modifiers` still reach the press.
    expect(page.mouse.click).toHaveBeenCalledWith(120, 60, { button: 'right', clickCount: 2, delay: 0 });
    expect(page.keyboard.down).toHaveBeenCalledWith('Shift');
    expect(page.keyboard.up).toHaveBeenCalledWith('Shift');
  });
});

describe('the self-check gate', () => {
  it('can be turned off, and then the press is the pre-change one: sent once, no delay', async () => {
    interact.setSelfCheck('0');
    try {
      expect(interact.selfCheckEnabled()).toBe(false);
      const { locator, page } = fakeLocator({ hits: true, swallow: 999 });
      await interact.click(locator, { timeout: 5000 });
      // Exactly one press, and `delay` stays `undefined` -- the shape that was
      // measured green on Linux headless WebKit. Passing `delay: 30` here is
      // what broke `responsive.spec.ts` 5 of 6 (see `DEFAULT_PRESS_DELAY_MS`).
      expect(page.mouse.click).toHaveBeenCalledTimes(1);
      expect(page.mouse.click).toHaveBeenCalledWith(120, 60, {
        button: 'left',
        clickCount: 1,
        delay: undefined,
      });
    } finally {
      interact.setSelfCheck('1');
    }
  });

  it('adds the press delay only when the check is on', async () => {
    const { locator, page } = fakeLocator({ hits: true });
    await interact.click(locator, { timeout: 5000 });
    expect(page.mouse.click).toHaveBeenCalledWith(120, 60, {
      button: 'left',
      clickCount: 1,
      delay: 30,
    });
  });

  it('is on when explicitly enabled', () => {
    expect(interact.selfCheckEnabled()).toBe(true);
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
