/**
 * Frame-free interaction: the one implementation both the E2E suite and the MCP
 * browser layer click with.
 *
 * `e2e/fixtures.ts` grew this for headless WebKitGTK, which produces ~0
 * animation frames for the app page: Playwright's actionability check waits for
 * an element's box to be equal across two consecutive animation frames
 * ("stable"), so every `locator.click()` crawls to its timeout there (measured
 * 8-30 s per click). A page init script cannot fix it, because Playwright
 * evaluates its checks in the isolated utility world.
 *
 * The replacement keeps every check that is not *defined* in terms of animation
 * frames: timer-based visibility (`locator.waitFor`), `isEnabled()`, one DOM
 * scroll call, the box read through `locator.evaluate` (no auto-wait) and a
 * synchronous `elementFromPoint` hit test retried to the deadline -- then a real
 * `page.mouse.click` / `page.touchscreen.tap` at that point. Only "stable"
 * (two frames) and `scrollIntoViewIfNeeded`'s frame-gated wait are dropped.
 *
 * **Why it is a plain module.** P13.4's `gs1.ui.click` has to drive a real page
 * with the *same* semantics the suite's clicks have; a second hit-test/scroll
 * implementation in `mcp/` would drift from this one and make "the browser did
 * the same thing the E2E test does" an assertion nobody can check. So the
 * implementation lives here, `e2e/fixtures.ts` installs it over Playwright's
 * verbs when the frame-free mode is on, and the MCP tools call it directly.
 *
 * `force` is honoured: Playwright defines it as "skip the actionability
 * checks", and the frame-free path used to ignore it, so `click({ force: true })`
 * on an obscured element span until the timeout. A forced dispatch skips the
 * visibility wait, the `isEnabled` check and the hit test, and clicks the
 * element's own box (the behaviour Playwright has).
 */

/** Playwright's default action timeout when nothing sets one (its own default is the test timeout). */
let defaultTimeoutMs = 120_000;

/**
 * The timeout a verb uses when its options do not name one. `e2e/fixtures.ts`
 * points this at `base.info().timeout` so the replacement waits exactly as long
 * as Playwright would.
 */
export function setDefaultTimeout(ms) {
  if (Number.isFinite(ms) && ms > 0) defaultTimeoutMs = ms;
}

/** The current default, exposed for tests and for callers that want to report it. */
export function defaultTimeout() {
  return defaultTimeoutMs;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The marker `boxOf` passes to `locator.evaluate`, so a caller can tell the two reads apart. */
export const READ_BOX = 'gs1:read-box';
/** The marker the hit test passes to `locator.evaluate`. */
export const HIT_TEST = 'gs1:hit-test';

/** Scroll the element into view with a DOM call (no animation frames). */
export async function scrollIntoView(locator) {
  await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    if (rect.top < 0 || rect.bottom > viewportHeight || rect.left < 0 || rect.right > viewportWidth) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    }
  });
}

/** The element's viewport box, read with `locator.evaluate` (no auto-wait). */
export async function boxOf(locator) {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, READ_BOX);
}

/**
 * Resolve a clickable viewport point, re-reading the box on every attempt: an
 * element that is still settling (a panel sliding open) moves between attempts,
 * and a point computed once would then never be over it. Playwright recomputes
 * on every retry for the same reason.
 *
 * With `options.force` the actionability checks are skipped, so one box read is
 * enough -- but the box is still read from the live element, which is what
 * Playwright does when it is forced.
 */
export async function frameFreePoint(locator, options = {}) {
  const timeout = options.timeout ?? defaultTimeout();
  const deadline = Date.now() + timeout;
  if (options.force) {
    await scrollIntoView(locator);
    const box = await boxOf(locator);
    return {
      page: locator.page(),
      x: box.x + (options.position?.x ?? box.width / 2),
      y: box.y + (options.position?.y ?? box.height / 2),
      forced: true,
    };
  }
  await locator.waitFor({ state: 'visible', timeout });
  for (;;) {
    if (!(await locator.isEnabled().catch(() => true))) {
      if (Date.now() >= deadline) {
        throw new Error(`locator: Timeout ${timeout}ms exceeded.\nCall log:\n  - waiting for element to be enabled\n`);
      }
      await sleep(50);
      continue;
    }
    await scrollIntoView(locator);
    const box = await boxOf(locator);
    const x = box.x + (options.position?.x ?? box.width / 2);
    const y = box.y + (options.position?.y ?? box.height / 2);
    // "receives events" without animation frames: a synchronous hit test.
    const hits = await locator
      .evaluate((el, at) => {
        const top = document.elementFromPoint(at.x, at.y);
        return !!top && (top === el || el.contains(top));
      }, { x, y, [HIT_TEST]: true })
      .catch(() => false);
    if (hits) return { page: locator.page(), x, y, forced: false };
    if (Date.now() >= deadline) {
      throw new Error(
        `locator: Timeout ${timeout}ms exceeded.\nCall log:\n  - waiting for element to receive pointer events\n`,
      );
    }
    await sleep(50);
  }
}

/** A real mouse click at the resolved point, with modifiers held when asked. */
export async function click(locator, options = {}) {
  const { page, x, y } = await frameFreePoint(locator, options);
  if (options.trial) return;
  const modifiers = options.modifiers ?? [];
  for (const key of modifiers) await page.keyboard.down(key);
  try {
    await page.mouse.click(x, y, {
      button: options.button ?? 'left',
      clickCount: options.clickCount ?? 1,
      delay: options.delay,
    });
  } finally {
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  }
}

/** A real touchscreen tap (the verb mobile viewports use). */
export async function tap(locator, options = {}) {
  const { page, x, y } = await frameFreePoint(locator, options);
  if (options.trial) return;
  await page.touchscreen.tap(x, y);
}

/** A real mouse move to the resolved point. */
export async function hover(locator, options = {}) {
  const { page, x, y } = await frameFreePoint(locator, options);
  if (options.trial) return;
  await page.mouse.move(x, y);
}

export async function dblclick(locator, options = {}) {
  return click(locator, { ...options, clickCount: 2 });
}

export async function check(locator, options = {}) {
  if (await locator.isChecked()) return;
  return click(locator, options);
}

export async function uncheck(locator, options = {}) {
  if (!(await locator.isChecked())) return;
  return click(locator, options);
}

export async function scrollIntoViewIfNeeded(locator, options = {}) {
  const timeout = options.timeout ?? defaultTimeout();
  await locator.waitFor({ state: 'attached', timeout });
  await scrollIntoView(locator);
}

/** The verbs as one object, for callers that want the whole set. */
export const interact = {
  click,
  dblclick,
  hover,
  tap,
  check,
  uncheck,
  scrollIntoViewIfNeeded,
  frameFreePoint,
  scrollIntoView,
  boxOf,
  setDefaultTimeout,
  defaultTimeout,
};
