import { test as base, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { interact, setDefaultTimeout } from './interact.mjs';

/**
 * The specs import `test` from here instead of from '@playwright/test' (that is
 * the only way to get a fixture applied to all of them), so the types they used
 * to import from there have to be re-exported next to it.
 */
export type { Page, Locator } from '@playwright/test';

/**
 * WebKit-on-Linux test fixtures. Two changes, both test-side only, both off for
 * every other engine:
 *
 * 1. `frameFree` interaction. Headless WebKitGTK does not produce animation
 *    frames for a page it cannot rasterise cheaply: measured on this machine the
 *    app page gets ~0 frames/s (a blank page gets ~55, `#root { display: none }`
 *    gets ~55). The main thread is healthy (setTimeout still runs ~50x/s), but
 *    Playwright's actionability check waits for the element's box to be equal
 *    across two consecutive animation frames ("stable"), and
 *    `scrollIntoViewIfNeeded()` waits on the same machinery -- so every
 *    `locator.click()` in headless WebKit crawls to its timeout (measured 8-30 s
 *    per click; `boot.spec.ts` took 2.4 min for 4 clicks).
 *
 *    A page init script cannot fix this: Playwright evaluates its checks in the
 *    `__playwright_utility_world__` isolated world, which a `page.addInitScript`
 *    cannot reach (verified: the element *is* stable across two main-world
 *    frames, and the click still reports "waiting for element to be visible,
 *    enabled and stable" for ever).
 *
 *    So for WebKit the frame-gated verbs (`click`, `dblclick`, `hover`, `tap`,
 *    `check`, `uncheck`, `scrollIntoViewIfNeeded`) are redirected through a
 *    frame-free implementation: wait for visibility with Playwright's own
 *    timer-based `waitFor` (19 ms), check `isEnabled()` (12 ms), scroll with one
 *    DOM call, read the box with `locator.evaluate` (33 ms, no auto-wait) and
 *    dispatch a real mouse/touch event at that point. Visibility, enabled state
 *    and "does the element actually receive pointer events" (an
 *    `elementFromPoint` hit test, retried to the deadline) are all still
 *    enforced -- only the two checks that are *defined* in terms of animation
 *    frames are dropped. Assertions are untouched.
 *
 *    **P13.4 moved that implementation to `e2e/interact.mjs`**, which is a plain
 *    module: `e2e/fixtures.ts` still installs it over Playwright's verbs exactly
 *    as before, and `mcp/ui/tools/click.mjs` (`gs1.ui.click`) calls the same
 *    functions, so the MCP browser layer and the E2E suite share one
 *    hit-test/scroll/dispatch implementation instead of two that can drift. The
 *    only behaviour change in the move is the one Playwright defines and this
 *    code used to miss: `options.force` is now honoured (it skips the
 *    actionability checks instead of looping to the timeout).
 *
 *    Measured: the same clicks take 39-57 ms this way, and `boot.spec.ts` goes
 *    from 2.4 min to 1.2 min (its first test: 56.3 s -> 6.6 s).
 *
 * 2. The rAF fallback in `raf-fallback.init.js`, which keeps the *app's* own
 *    `requestAnimationFrame` loops alive (the player, the metronome, the shared
 *    canvas bus) while the compositor is starved. It does not affect
 *    Playwright's actionability -- see above, it cannot -- but app behaviour
 *    that is driven by rAF needs frames from somewhere.
 *
 * `GS1_E2E_FRAME_FREE_CLICKS=1` forces both on, `=0` turns both off; the default
 * is WebKit only. Chromium/Firefox runs are byte-identical: the prototype patch
 * is installed once per worker process, so it also re-checks a per-test flag and
 * defers to Playwright whenever the running project is not WebKit.
 */
const RAF_FALLBACK_PATH = fileURLToPath(new URL('./raf-fallback.init.js', import.meta.url));

const MODE = process.env.GS1_E2E_FRAME_FREE_CLICKS ?? 'auto';
/** The rAF fallback is separable: it is not needed for interaction, only for app loops. */
const RAF_FALLBACK_MODE = process.env.GS1_E2E_RAF_FALLBACK ?? 'auto';
const MARK = Symbol.for('gs1.webkitFrameFree');

const wantsFrameFree = (browserName: string): boolean =>
  MODE === '1' ? true : MODE === '0' ? false : browserName === 'webkit';

const wantsRafFallback = (browserName: string): boolean =>
  RAF_FALLBACK_MODE === '1' ? true : RAF_FALLBACK_MODE === '0' ? false : browserName === 'webkit';

/** Per-test switch: a worker process can run several projects in sequence. */
let frameFreeActive = false;
const isFrameFree = () => frameFreeActive;

/**
 * Playwright's own action timeout defaults to the *test* timeout (nothing sets
 * `actionTimeout` here), so the replacement must default the same way instead of
 * inventing a shorter cap that would fail a legitimately slow wait. The default
 * itself lives in `interact.mjs` now (the MCP layer needs one too); this is the
 * per-test value it is pointed at.
 */
let frameFreeTimeout = 120_000;
const defaultTimeout = () => frameFreeTimeout;

type ClickOptions = {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  force?: boolean;
  modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>;
  noWaitAfter?: boolean;
  position?: { x: number; y: number };
  timeout?: number;
  trial?: boolean;
};

type LocatorLike = Locator & { [MARK]?: boolean };

function install(page: Page): void {
  const proto = Object.getPrototypeOf(page.locator('body')) as LocatorLike & Record<string, unknown>;
  if (proto[MARK]) return;
  proto[MARK] = true;

  const originalClick = proto.click as (this: Locator, options?: ClickOptions) => Promise<void>;
  const originalDblclick = proto.dblclick as (this: Locator, options?: ClickOptions) => Promise<void>;
  const originalHover = proto.hover as (this: Locator, options?: ClickOptions) => Promise<void>;
  const originalTap = proto.tap as (this: Locator, options?: ClickOptions) => Promise<void>;
  const originalCheck = proto.check as (this: Locator, options?: ClickOptions) => Promise<void>;
  const originalUncheck = proto.uncheck as (this: Locator, options?: ClickOptions) => Promise<void>;
  const originalScroll = proto.scrollIntoViewIfNeeded as (this: Locator, options?: { timeout?: number }) => Promise<void>;

  proto.click = async function click(this: Locator, options: ClickOptions = {}) {
    if (!isFrameFree()) return originalClick.call(this, options);
    return interact.click(this, options);
  };

  proto.dblclick = async function dblclick(this: Locator, options: ClickOptions = {}) {
    if (!isFrameFree()) return originalDblclick.call(this, options);
    return interact.dblclick(this, options);
  };

  proto.hover = async function hover(this: Locator, options: ClickOptions = {}) {
    if (!isFrameFree()) return originalHover.call(this, options);
    return interact.hover(this, options);
  };

  proto.tap = async function tap(this: Locator, options: ClickOptions = {}) {
    if (!isFrameFree()) return originalTap.call(this, options);
    return interact.tap(this, options);
  };

  proto.check = async function check(this: Locator, options: ClickOptions = {}) {
    if (!isFrameFree()) return originalCheck.call(this, options);
    return interact.check(this, options);
  };

  proto.uncheck = async function uncheck(this: Locator, options: ClickOptions = {}) {
    if (!isFrameFree()) return originalUncheck.call(this, options);
    return interact.uncheck(this, options);
  };

  proto.scrollIntoViewIfNeeded = async function scrollIntoViewIfNeeded(
    this: Locator,
    options: { timeout?: number } = {},
  ) {
    if (!isFrameFree()) return originalScroll.call(this, options);
    return interact.scrollIntoViewIfNeeded(this, options);
  };
}

export const test = base.extend<{ frameFree: void }>({  frameFree: [
    async ({ page, browserName }, use) => {
      const wanted = wantsFrameFree(browserName);
      try {
        frameFreeTimeout = base.info().timeout;
      } catch {
        // outside a test context: keep the module default
      }
      setDefaultTimeout(frameFreeTimeout);
      if (wanted) install(page);
      if (wantsRafFallback(browserName)) await page.addInitScript({ path: RAF_FALLBACK_PATH });
      frameFreeActive = wanted;
      try {
        await use();
      } finally {
        frameFreeActive = false;
      }
    },
    { auto: true },
  ],
});

export { expect };
