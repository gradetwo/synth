/**
 * E2E-only `requestAnimationFrame` fallback.
 *
 * WHY THIS EXISTS
 * ---------------
 * Headless WebKitGTK on Linux still fires rAF -- on a blank page it reaches
 * ~55 fps here. What it cannot do is produce frames for a page whose paint work
 * is expensive, because headless WebKitGTK is software-rasterised: measured on
 * this machine, a trivial page with one `filter: blur(4px)` box gets a single
 * frame in 5.6 s, and `backdrop-filter`/`box-shadow` are nearly as bad. The app
 * page (7 canvases, thousands of nodes) therefore produces ~0 frames per second
 * in headless WebKit, while the main thread stays healthy (setTimeout still runs
 * ~50x/s).
 *
 * Playwright's auto-waiting is rAF-driven: before every `locator.click()` it
 * waits for the element's box to be identical across two consecutive animation
 * frames ("stable"). With ~0 frames that wait never finishes, so every click
 * crawls to the test timeout and the suite takes hours instead of minutes.
 *
 * WHAT THIS DOES
 * --------------
 * Keeps the real `requestAnimationFrame`, and adds a watchdog: if a real frame
 * does not arrive within STALL_MS, the queued callbacks are serviced from a
 * timer instead, at ~FALLBACK_MS cadence. A real frame always wins and clears
 * the watchdog, so on an engine whose compositor is healthy this is a no-op --
 * it never invokes a callback twice and never fires while real frames flow.
 *
 * Semantics kept: registration order, one timestamp argument, ids returned by
 * rAF and accepted by cancelAnimationFrame (cancelling a callback before it has
 * run works; the shared underlying frame request is not cancelled because other
 * callbacks may still be waiting on it).
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not make the app paint. DOM/state assertions (and layout reads, which
 * is all Playwright's stability check does) are exact; pixel output under
 * headless WebKit stays as slow as the software rasteriser makes it, so
 * screenshot comparisons still cannot be trusted there. See docs/notes/compat.md.
 *
 * Injected by `e2e/fixtures.ts` for WebKit only (or for any engine with
 * GS1_E2E_RAF_FALLBACK=1). It is never part of the product bundle.
 */
(() => {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.__gs1RafFallback && window.__gs1RafFallback.installed) return; // idempotent
  const nativeRaf = window.requestAnimationFrame;
  if (typeof nativeRaf !== 'function') return; // nothing to fall back from
  const nativeRafBound = nativeRaf.bind(window);

  // A real frame slower than this counts as stalled; once stalled we drive the
  // queue ourselves at roughly 40 fps, which is enough for two-frame checks
  // (Playwright's stability wait) to finish in ~50 ms.
  const STALL_MS = 100;
  const FALLBACK_MS = 24;

  const pending = new Map();
  let nextId = 1;
  let realHandle = null;
  let timerHandle = null;
  let starved = false;

  const reportError = (error) => {
    setTimeout(() => {
      throw error;
    }, 0);
  };

  const drain = (timestamp) => {
    // Copy the keys first: a callback may register or cancel while we run.
    for (const id of [...pending.keys()]) {
      const callback = pending.get(id);
      if (typeof callback !== 'function') continue;
      pending.delete(id);
      try {
        callback(timestamp);
      } catch (error) {
        reportError(error);
      }
    }
  };

  function arm() {
    if (realHandle === null) realHandle = nativeRafBound(onRealFrame);
    if (timerHandle === null) timerHandle = setTimeout(onWatchdog, starved ? FALLBACK_MS : STALL_MS);
  }

  function onRealFrame(timestamp) {
    realHandle = null;
    if (timerHandle !== null) {
      clearTimeout(timerHandle);
      timerHandle = null;
    }
    starved = false; // the compositor is producing frames again
    drain(typeof timestamp === 'number' ? timestamp : performance.now());
    if (pending.size > 0) arm();
  }

  function onWatchdog() {
    timerHandle = null;
    if (pending.size === 0) return;
    starved = true;
    drain(performance.now());
    if (pending.size > 0) arm();
  }

  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Failed to execute requestAnimationFrame: callback is not a function');
    }
    const id = nextId++;
    pending.set(id, callback);
    arm();
    return id;
  };

  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    pending.delete(id);
  };

  window.__gs1RafFallback = {
    installed: true,
    stats: () => ({ starved, pending: pending.size }),
  };
})();
