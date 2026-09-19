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
 * Since 2026-09-16 the dispatch can also be **self-checking** (see below): the
 * engine must produce the `click` / `dblclick` event on the element, or the
 * gesture is retried to the same deadline. It is on where the defect was
 * measured (WebKit on Darwin) and off elsewhere, because a press on the Linux
 * app page costs seconds and the extra reads do not fit the test budget there.
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
 *
 * **The verbs are self-checking (2026-09-16).** `page.mouse.click` returns when
 * the *input* is delivered, not when the engine has run its click synthesis, and
 * on macOS WebKit (26.6 / Playwright 1.63) a press with no hold time sometimes
 * produces no `click` event at all -- captured on the app page, both
 * `pointerdown` and `pointerup` arrived and the `click` that follows them in
 * every complete gesture never came (`clicks-x3.log` line 22-23), so the handler
 * never ran and the test failed as if the feature were broken. The same steps
 * pass with Playwright's own `locator.click()`. The fix is not a longer sleep
 * and not a relaxed assertion: `watchClickEvent` arms the recorder that lives on
 * `window`, `click` asserts the `click` really arrived **on the element or
 * inside it**, and if it did not the whole gesture is retried until the same
 * deadline `frameFreePoint` uses, where the verb then fails with
 * `no click event reached <selector> in <timeout>ms`.
 * A control the engine never dispatches a click for still fails, at the same
 * deadline it always did. `dblclick` verifies `dblclick` and `tap` verifies the
 * `click` the touch pipeline synthesises (measured, see `tap`). A press delay
 * (`DEFAULT_PRESS_DELAY_MS`) makes the press a real press rather than an
 * instantaneous one -- the same property the `ba25496` `dblclick` fix found
 * WebKit needs -- and it, like the check itself, is applied only when the check
 * is on: passing it to every press was measured to break `responsive.spec.ts`
 * 5 of 6 on Linux headless WebKit (see `click`).
 *
 * **The check is gated** (`selfCheckEnabled`, `GS1_E2E_FRAME_FREE_SELFCHECK`):
 * with it off the module is the pre-change one, press for press and read for
 * read.
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

/**
 * The press hold time a `click` uses when the caller names no `delay`.
 *
 * A press that is functionally instantaneous is what the `ba25496` `dblclick`
 * fix found WebKit ignores (0 ms produced no `dblclick`; 60 ms did). 30 ms is
 * the smallest value that keeps a click a press while staying cheap: measured on
 * this host (12 dispatches per setting, 2026-09-16), `page.mouse.click` takes
 * 25-44 ms at `delay: 0` and 44-81 ms at `delay: 30` on Chromium/WebKit, i.e.
 * it costs roughly 20-40 ms per click, against the 39-57 ms the frame-free path
 * already saves per click. **It is not proven sufficient on macOS WebKit**: the
 * defect does not reproduce on Linux, so the self-check above -- not this
 * number -- is what makes the verb correct there. A caller-supplied `delay`
 * (including `0`) is used verbatim.
 */
export const DEFAULT_PRESS_DELAY_MS = 30;

/**
 * Whether the gesture is **self-checked and retried**, and the one thing the
 * Linux WebKit suite needs to stay affordable.
 *
 * The check costs one extra `locator.evaluate` (arm the recorder) plus one
 * `page.evaluate` (read it) per press, and on this host a single app-page press
 * under headless WebKit already takes seconds (measured 2026-09-16: 30.0 s for
 * `page.mouse.click`, 30.2 s for move/down/up). Adding the check to every press
 * pushed `player.spec.ts` past its 120 s budget: with it, 3 of 8 WebKit player
 * tests failed (`loops an A/B region`, `MIDI import`, `keyboard shortcuts`); on
 * the same host the pre-change helper passed the same three in 2.9 min. The
 * defect the check exists for is macOS WebKit, where a press costs milliseconds
 * (39-57 ms on the frame-free path), so the check is enabled there and left off
 * on the Linux suite by default.
 *
 * `GS1_E2E_FRAME_FREE_SELFCHECK=1` forces it on, `=0` off; `auto` (the default)
 * is on for WebKit on Darwin. `e2e/fixtures.ts` does not currently pass the
 * engine's platform, so a caller that wants the check elsewhere sets the
 * variable: `GS1_E2E_FRAME_FREE_SELFCHECK=1 npx playwright test …` -- which is
 * also how the macOS replay and this repository's unit tests exercise it.
 */
let selfCheckMode = process.env.GS1_E2E_FRAME_FREE_SELFCHECK ?? 'auto';

/** True when the press should be verified and retried instead of sent once. */
export function selfCheckEnabled() {
  if (selfCheckMode === '1') return true;
  if (selfCheckMode === '0') return false;
  return process.platform === 'darwin';
}

/**
 * Override the gate at runtime. `e2e/fixtures.ts` does not use it (the variable
 * it reads for its own two switches is enough); it exists so the unit tests can
 * exercise both paths without depending on when a module reads the environment.
 */
export function setSelfCheck(mode) {
  selfCheckMode = mode;
}

/** How long a retry waits before re-dispatching, and the post-dispatch poll step. */
const RETRY_DELAY_MS = 25;

/** How long a dispatched gesture is given to produce its event before a retry. */
const EVENT_POLL_MS = 250;

/**
 * The single always-on capture-phase recorder, and the marker key the options
 * array carries so the stub in `mcp/ui/interact.test.mjs` can tell "arm the
 * recorder" apart from the box read and the hit test. `HIT_TEST` / `READ_BOX`
 * are plain strings, kept separate on purpose: an element can legitimately *be*
 * a string.
 *
 * **Why one always-on listener instead of one per attempt.** The first version
 * installed a fresh one-shot listener in the same tick as the press. On Linux
 * headless WebKit (2026-09-16) the app page's own press then took the whole test
 * budget, while the same page was fine when only the resolution and the press
 * ran. With one recorder installed once per document, an attempt only has to
 * remember its sequence number, dispatch, and read the events above it -- no DOM
 * work between resolving the point and pressing, which is also what the
 * one-shot-per-attempt version did on every retry.
 *
 * `via` uses `el.contains(target)`, the exact "the element or a descendant" rule
 * `frameFreePoint`'s hit test uses, and reads the event that really arrived
 * rather than `elementFromPoint` -- compat §8 (the dashed-stroke defect) is the
 * reason that distinction matters.
 */
export const GESTURE_SLOT = '__gs1GestureRecorder__';
export const WATCH_EVENT = 'gs1:watch-click';

/**
 * Arm the recorder for `el` and return its current sequence number. Installing
 * is idempotent: the listeners live on `window` and survive the app replacing
 * the element, so re-arming with a new element only updates the containment
 * rule. Returns `null` when the page could not be reached.
 */
export async function watchClickEvent(locator) {
  return locator
    .evaluate(
      (el, options) => {
        const slot = options[0];
        const win = window;
        const state = win[slot] || (win[slot] = { seq: 0, events: [], armed: false, listeners: false });
        if (!state.listeners) {
          state.listeners = true;
          const via = (node) => {
            // Duck-typed rather than `instanceof Element`: this also runs under
            // the Node test stub, which has no DOM classes.
            const element = node && typeof node.contains === 'function' ? node : (node && node.parentElement);
            return !!element && (element === el || el.contains(element));
          };
          for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) {
            win.addEventListener(
              type,
              (event) => {
                state.seq += 1;
                state.events.push({ seq: state.seq, type, targetIsElement: via(event.target) });
              },
              true,
            );
          }
        }
        state.armed = true;
        return state.seq;
      },
      [GESTURE_SLOT, { [WATCH_EVENT]: true }],
    )
    .catch(() => null);
}

/**
 * Read the recorder: every event above `mark`, so the caller can see what the
 * engine really delivered -- not only the event it asked for.
 */
async function readRecorder(page, mark) {
  return page
    .evaluate(
      // `page.evaluate(fn, arg)` passes `arg` as the *first* parameter (the
      // element-first shape belongs to `locator.evaluate`), so the slot and the
      // mark arrive together as one array.
      (at) => {
        const state = window[at[0]];
        const result = { events: [], armed: false };
        if (!state) return result;
        result.armed = state.armed === true;
        for (const event of state.events) {
          if (event.seq > at[1]) result.events.push(event);
        }
        return result;
      },
      [GESTURE_SLOT, mark || 0],
    )
    .catch(() => null);
}

/**
 * Poll the recorder until either the wanted event arrives on the element or the
 * budget is out. The poll exists because `mouse.down`/`up` resolve when the
 * *input* is delivered, which is not necessarily after the engine has run its
 * event synthesis.
 */
async function pollRecorder(page, type, budget, mark) {
  const deadline = Date.now() + budget;
  let state;
  for (;;) {
    state = await readRecorder(page, mark);
    if (state && state.events.some((event) => event.type === type && event.targetIsElement === true)) {
      return state;
    }
    if (Date.now() >= deadline) return state;
    await sleep(RETRY_DELAY_MS);
  }
}

/**
 * Dispatch and then read what the engine produced. `mark` is the recorder's
 * sequence number *before* the dispatch -- `watchClickEvent` returns it, so no
 * extra round trip is spent between resolving the point and pressing (one extra
 * `evaluate` there was enough to push the app page's own press past the test
 * budget on Linux headless WebKit, where a single press already costs seconds).
 */
export async function dispatchGesture(page, type, dispatch, budget = EVENT_POLL_MS, mark = 0) {
  await dispatch();
  return pollRecorder(page, type, budget, mark);
}

/** A short, selector-shaped name for the failure message. */
function selectorName(locator) {
  try {
    const value = String(locator);
    return value === '[object Object]' ? '<the selector>' : value;
  } catch {
    return '<the selector>';
  }
}

/**
 * The error a gesture that never arrived -- or arrived on something else -- gets.
 * It names what was missing instead of pretending the element was never
 * actionable, because those are different defects.
 */
function gestureTimeout(type, locator, timeout, sawSomethingElse) {
  return new Error(
    `no ${type} event reached ${selectorName(locator)} in ${timeout}ms\n` +
      'Call log:\n' +
      `  - pressed at the resolved point and retried to the deadline; the capture-phase recorder on\n` +
      `    window saw the press complete on this element but no ${type}${sawSomethingElse ? ' (one arrived elsewhere)' : ''}\n`,
  );
}

/**
 * Retry a gesture until the engine produces the event it is supposed to, then
 * fail at the same deadline `frameFreePoint` uses. The gesture itself is never
 * relaxed: this only turns "the engine dropped the click" from a silent success
 * into a bounded retry, and a genuinely dead control still fails.
 *
 * Each retry re-dispatches at the point `frameFreePoint` resolved (that point
 * was confirmed over the element by the hit test, and the listener reads the
 * event that really arrives, so if the element has moved under it the record
 * says `targetIsElement: false` and the retry keeps trying). Re-resolving the
 * point on every retry is not done: it would add the visibility wait and the
 * hit test to every attempt, and on the macOS failure the point was correct --
 * only the `click` was missing.
 */
async function dispatchUntilEvent(locator, options, { type, dispatch }) {
  const timeout = options.timeout ?? defaultTimeout();
  const check = selfCheckEnabled();
  // Without the self-check the verb is the pre-change one: one press, no
  // recorder, no extra round trips (the reason `selfCheckEnabled` exists).
  if (!check) {
    await dispatch();
    return;
  }
  const deadline = Date.now() + timeout;
  let sawSomethingElse = false;
  for (;;) {
    const mark = await watchClickEvent(locator, type);
    const started = Date.now();
    const state = await dispatchGesture(locator.page(), type, dispatch, EVENT_POLL_MS, mark || 0);
    const events = (state && state.events) || [];
    if (events.some((event) => event.type === type && event.targetIsElement === true)) return;
    if (events.length) sawSomethingElse = true;

    // Nothing arrived on the element. Three shapes, and only the last is the
    // defect:
    //
    //  1. the locator no longer matches anything -- the app consumed the press
    //     and took the node away (measured on Linux headless WebKit 2026-09-16:
    //     the boot gate's `onClick` runs and its whole overlay is removed, yet a
    //     window capture listener sees only `pointerdown`, then `pointerup` on
    //     the grid that is topmost by then). Retrying could only press whatever
    //     is below it, so this is accepted;
    //  2. the element never received a *complete* press (no `pointerdown` **and**
    //     `pointerup` on it) -- the same re-render under the pointer, so there is
    //     no dropped click to retry either;
    //  3. a complete press on the element with no `click` event -- the defect
    //     (`clicks-x3.log` line 22-23: `pointerdown` + `pointerup` on
    //     `button.d-close`, no `click`, and the drawer stayed open). This one is
    //     retried, but only while another whole press fits in the deadline: on
    //     this host one app-page press costs ~30 s, so retrying there would trade
    //     a precise failure for a test-budget timeout, while on the engine that
    //     exposed the defect presses are milliseconds (macOS WebKit) -- the retry
    //     is affordable exactly where it is needed.
    if ((await locator.count()) === 0) return;
    const completedPress =
      events.some((event) => event.type === 'pointerdown' && event.targetIsElement === true) &&
      events.some((event) => event.type === 'pointerup' && event.targetIsElement === true);
    if (!completedPress) return;
    const spent = Date.now() - started;
    if (deadline - Date.now() < spent) throw gestureTimeout(type, locator, timeout, sawSomethingElse);
    await sleep(RETRY_DELAY_MS);
    await frameFreePoint(locator, options);
  }
}
/** A real mouse click at the resolved point, with modifiers held when asked. */
export async function click(locator, options = {}) {
  const { page, x, y } = await frameFreePoint(locator, options);
  if (options.trial) return;
  const modifiers = options.modifiers ?? [];
  for (const key of modifiers) await page.keyboard.down(key);
  try {
    // The press delay is part of the self-check, not a separate change: with the
    // check off the dispatch is byte-identical to the pre-change
    // `page.mouse.click(x, y, { …, delay: options.delay })` (measured on Linux
    // headless WebKit 2026-09-16: passing `delay: 30` unconditionally broke
    // `responsive.spec.ts` 5 of 6 -- every failure stuck at
    // `expect(locator('.settings-drawer.open')).toBeVisible()` -- while the same
    // file is green with `delay: undefined`), and the hold only exists where the
    // check that needs it runs.
    await dispatchUntilEvent(locator, options, {
      type: 'click',
      dispatch: () =>
        page.mouse.click(x, y, {
          button: options.button ?? 'left',
          clickCount: options.clickCount ?? 1,
          delay: options.delay ?? (selfCheckEnabled() ? DEFAULT_PRESS_DELAY_MS : undefined),
        }),
    });
  } finally {
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  }
}

/**
 * A real touchscreen tap (the verb mobile viewports use).
 *
 * Touch *does* produce a `click`: measured on all three engines (Playwright
 * 1.63, 2026-09-16, 8 taps each on a plain `data:` page), `touchscreen.tap`
 * dispatches `pointerdown, touchstart, pointerup, touchend, mousedown, mouseup`
 * **and** `click`, and the click reaches the element 8/8 -- so the same
 * self-check applies and the "touch has no click event" worry is disproved for
 * Playwright's touchscreen, which synthesises the compatibility mouse events.
 * There is no press `delay` to add: `page.touchscreen.tap` has no such option.
 */
export async function tap(locator, options = {}) {
  const { page, x, y } = await frameFreePoint(locator, options);
  if (options.trial) return;
  await dispatchUntilEvent(locator, options, {
    type: 'click',
    dispatch: () => page.touchscreen.tap(x, y),
  });
}

/** A real mouse move to the resolved point. */
export async function hover(locator, options = {}) {
  const { page, x, y } = await frameFreePoint(locator, options);
  if (options.trial) return;
  await page.mouse.move(x, y);
}

/**
 * A real double click at the resolved point.
 *
 * It has to be a *real* double click — `mouse.dblclick`, i.e. two down/up pairs —
 * and the press has to last a moment. Measured on Playwright 1.63 / WebKit
 * (macOS 26.6 and Linux headless alike, 2026-09-16): `mouse.click(x, y,
 * { clickCount: 2 })` with the default 0 ms press does **not** produce a
 * `dblclick` event, so an `onDoubleClick` handler never fires and the failure
 * looks like a broken feature; the same click with `delay: 60` does fire it, and
 * `mouse.dblclick` with the same delay fires it too. Chromium synthesises
 * `dblclick` either way, which is why only the WebKit suite saw this.
 *
 * The 60 ms was not enough on macOS: `player-x5.log` shows the `dblclick` on
 * the current track failing 5/5 while the click earlier in the same test passed,
 * so the same self-check retry as `click` verifies the `dblclick` event really
 * arrived. Note the shape of the retry: a gesture whose second press is dropped
 * produces `click, click` and no `dblclick`, so the re-dispatched pair can make
 * the page see three clicks before the successful pair -- a *click* handler is
 * exercised more than once. That is the honest consequence of retrying a gesture
 * the engine dropped, and it only happens on an engine that is already
 * misbehaving (Chromium, Firefox and Linux WebKit emit the `dblclick` on the
 * first pair).
 */
export async function dblclick(locator, options = {}) {
  const { page, x, y } = await frameFreePoint(locator, options);
  if (options.trial) return;
  await dispatchUntilEvent(locator, options, {
    type: 'dblclick',
    dispatch: () =>
      page.mouse.dblclick(x, y, {
        button: options.button ?? 'left',
        delay: options.delay ?? 60,
      }),
  });
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
  watchClickEvent,
  dispatchGesture,
  selfCheckEnabled,
  setSelfCheck,
  setDefaultTimeout,
  defaultTimeout,
};
