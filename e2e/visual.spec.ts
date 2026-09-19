import { expect, test, type Page } from './fixtures';

/**
 * Visual regression: the five surfaces a user actually looks at, in both
 * colour schemes, on a phone and on a desktop. Twenty baselines, compared with
 * a tolerance rather than pixel for pixel, and every mismatch leaves the
 * `-expected`/`-actual`/`-diff` triple in `test-results/` for the reader.
 *
 * Two deliberate choices, both about honesty rather than convenience:
 *
 * 1. **Opt-in** (`npm run test:visual`). Text rasterisation is a property of
 *    the host's font stack, not of this repository: a baseline recorded on this
 *    workstation (CachyOS) has no business being a verdict on an Ubuntu runner,
 *    and a red CI that means "different freetype" trains people to ignore red.
 *    Recording is `npm run test:visual:update`; a mismatch prints the diff path.
 * 2. **Only the *pixels the app draws*, not the pixels a driver animates.**
 *    Canvases that redraw while the engine runs (LFO previews, the scope, the
 *    meters) are masked out. Their content is asserted elsewhere by tests that
 *    read the numbers behind them; here they would only add noise.
 *
 * There is a third mode, for the nightly's WebKit/Firefox coverage
 * (`GS1_VISUAL_SMOKE=1`, set by `scripts/nightly-e2e.mjs`): **render every
 * surface, compare nothing.** The baselines are named for the engine and the
 * host — Playwright's template is `{arg}{-projectName}{-snapshotSuffix}` with
 * `snapshotSuffix` = the platform — so WebKit would look for
 * `*-webkit-linux.png` and Firefox for `*-firefox-linux.png`, and neither
 * exists or should: they would encode this box's font stack and software
 * rendering, and the point of the nightly is "do the surfaces draw on that
 * engine at all". A missing baseline is not a skip either — with the default
 * `updateSnapshots: "missing"` Playwright *writes* one and reports the test
 * failed — so the smoke takes the screenshots, asserts each is a real raster of
 * a plausible size, and deliberately does not touch the thresholds or the
 * baselines. The comparison itself stays covered by Chromium.
 *
 * The service worker is blocked on purpose: it caches the *previous* build, so
 * a suite that ran through it would be comparing a fresh baseline against a
 * stale page for one run after every rebuild (observed, with the accent
 * experiment below).
 *
 * The suite carries its own proof that it can fail — see the last test, which
 * paints a change into a live page and expects the comparison to reject it.
 */

const RUN = process.env.GS1_VISUAL === '1' || process.env.GS1_VISUAL_SMOKE === '1';

/** Bumping baselines: a passing `--update-snapshots` means nothing was compared. */
const UPDATING = process.env.GS1_VISUAL_UPDATE === '1';

/** Render-only (WebKit/Firefox nightly): no baseline is read or written. */
const SMOKE = process.env.GS1_VISUAL_SMOKE === '1';

if (SMOKE && UPDATING) {
  throw new Error('GS1_VISUAL_SMOKE and GS1_VISUAL_UPDATE are mutually exclusive: the smoke records nothing');
}

/** Animated-by-the-driver regions: asserted by their own tests, masked here. */
const ANIMATED = [
  '.mini-canvas',
  '.scope-body',
  '.vu-track',
  // The spectrum had been left out, and it is drawn on rAF like the scope: the
  // light desktop splash flaked on a first-draw timing race (0.4 % of pixels,
  // all inside this box) until it was masked. The compact strip carries the
  // same two canvases on a wide phone or a tablet.
  '.spec-body',
  '.strip-scope',
  '.strip-spec',
];

const SHOT = {
  animations: 'disabled',
  caret: 'hide',
  scale: 'css',
  // Same host, same Chromium, deterministic rendering: antialiasing does not
  // wander, so 1 % of pixels and a 5 % per-pixel colour distance is already
  // generous. Measured calibration in `docs/notes/visual-regression.md`: a
  // 16/255 accent shift was caught at this setting but slipped through 0.25.
  maxDiffPixelRatio: 0.01,
  threshold: 0.05,
} as const;

test.skip(!RUN, '视觉回归是可选套件：npm run test:visual');

test.describe.configure({ mode: 'serial' });

type Device = 'desktop' | 'phone';

/** IHDR width/height, or null when the buffer is not a PNG. */
function pngSize(png: Buffer): { width: number; height: number } | null {
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Prime Chromium's raster cache before a comparison of a tall element.
 *
 * `.modules-grid` is 1440 px tall in a 900 px viewport, so Playwright serves it
 * through `Page.captureScreenshot({ captureBeyondViewport: true })`, which
 * re-rasterises the below-the-fold tiles on every capture. The *first* such
 * capture can come back before those tiles are painted. Measured on this box at
 * host load 17-25 (ten busy cores on eight), with the page provably settled
 * (60 samples over 7.5 s: every module box and `documentElement.scrollHeight`
 * unchanged) and the masks in place:
 *
 *   capture #1: 3595 ms, `0.1694` of pixels away from the baseline
 *   capture #2: 3250 ms, `0.0000` away (pixel-identical)
 *
 * and the missing pixels were the unpainted OSC / FILTER / ENV / MOD MATRIX /
 * REVERB / DELAY bodies, not a different state: the magenta mask rectangles sit
 * at the same coordinates in both, i.e. the layout never moved.
 *
 * Playwright cannot tell that apart from a real regression. It reads the
 * unpainted capture as `274404 pixels (ratio 0.15 of all image pixels) are
 * different`, needs a second capture to re-establish stability, and on a loaded
 * host that second capture does not land inside the 15 s expectation -- the run
 * dies with `Failed to take two consecutive stable screenshots`. That is how
 * this suite's own self-check went red while all 48 baselines were fine.
 *
 * So: take one throwaway capture first and let the real comparison judge the
 * next one, which is the painted raster. No threshold is touched -- same
 * baseline, same `maxDiffPixelRatio` / `threshold` -- and a genuinely different
 * page is still reported, which the self-check at the bottom of this file
 * proves by painting one in.
 */
async function prime(page: Page, locator: string, masks: string[] = []) {
  const target = page.locator(locator);
  const viewport = page.viewportSize();
  const box = await target.boundingBox();
  // Short elements are captured straight from the viewport, with no
  // beyond-the-fold tiles to paint late; they never showed this race.
  if (!box || !viewport || (box.width <= viewport.width && box.height <= viewport.height)) return;
  await target.screenshot({
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    mask: [...ANIMATED, ...masks].map((selector) => page.locator(selector)),
  });
}

async function shot(page: Page, locator: string, name: string, masks: string[] = []) {
  if (SMOKE) {
    // The smoke's verdict is "this surface rasterised on this engine", not
    // "it looks like Chromium's": see the file header for why the baselines
    // are not comparable here. A degenerate raster still fails — 8×8 is below
    // every real surface (the smallest is the oversampling toggle cell, 40×17)
    // and above "an element that did not render".
    const target = page.locator(locator);
    await expect(target).toBeVisible();
    const size = pngSize(await target.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }));
    const got = size ? `${size.width}×${size.height}` : 'not a PNG';
    expect(size, `${name}: ${got}`).not.toBeNull();
    expect(size!.width, `${name}: rasterised to ${got}`).toBeGreaterThanOrEqual(8);
    expect(size!.height, `${name}: rasterised to ${got}`).toBeGreaterThanOrEqual(8);
    return;
  }
  await prime(page, locator, masks);
  await expect(page.locator(locator)).toHaveScreenshot(name, {
    ...SHOT,
    mask: [...ANIMATED, ...masks].map((selector) => page.locator(selector)),
  });
}

/** Fresh context, so the theme follows the emulated system preference. */
async function gotoApp(page: Page, theme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/');
  await expect(page.locator('.start-overlay')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function startEngine(page: Page, phone: boolean) {
  const start = page.locator('.start-btn');
  if (phone) await start.tap();
  else await start.click();
  await expect(page.locator('.start-overlay')).toHaveCount(0);
  await expect(page.locator('.kbd-dock.open')).toBeVisible();
}

async function openFlow(page: Page, phone: boolean) {
  if (phone) {
    // Compact chrome keeps the modules/signal-flow switch on its own row.
    await page.locator('.view-row .vt-btn', { hasText: '信号流' }).tap();
  } else {
    await page.getByRole('button', { name: '信号流' }).click();
  }
  await expect(page.locator('.flow-view')).toBeVisible();
}

async function openRoll(page: Page, phone: boolean) {
  if (phone) {
    await page.locator('.top-more > .tbtn.icon').first().tap();
    await page.locator('.top-menu .tbtn', { hasText: '钢琴卷帘' }).tap();
  } else {
    await page.locator('.top-actions .tbtn', { hasText: '钢琴卷帘' }).click();
  }
  await expect(page.locator('.roll')).toBeVisible();
}

/**
 * The five surfaces of one (theme × device) combination, in an order that
 * never has two overlays up at once.
 */
async function capture(page: Page, device: Device, theme: 'dark' | 'light') {
  const phone = device === 'phone';
  const suffix = `${theme}-${device}`;
  const tap = async (locator: string) => {
    if (phone) await page.locator(locator).tap();
    else await page.locator(locator).click();
  };

  await gotoApp(page, theme);
  // The version line changes every release; it is the one thing in the splash
  // that is *supposed* to move, so mask it instead of re-recording for it.
  await shot(page, '.start-overlay', `splash-${suffix}.png`, ['.start-sub']);

  await startEngine(page, phone);
  await page.waitForTimeout(400);
  // The module grid: knobs, labels and the (masked) previews, top to bottom.
  await shot(page, '.modules-grid', `modules-${suffix}.png`);

  await tap('.player-open');
  await expect(page.locator('.player.open')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '.player', `player-${suffix}.png`);
  await tap('.player-head .d-close');
  await expect(page.locator('.player.open')).toHaveCount(0);

  await openFlow(page, phone);
  await page.waitForTimeout(700);
  await shot(page, '.flow-canvas-wrap', `flow-${suffix}.png`);

  await openRoll(page, phone);
  await page.waitForTimeout(700);
  await shot(page, '.roll', `roll-${suffix}.png`);
}

test.describe('desktop 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });

  test('dark', async ({ page }) => {
    await capture(page, 'desktop', 'dark');
  });

  test('light', async ({ page }) => {
    await capture(page, 'desktop', 'light');
  });
});

test.describe('iPhone 390×844', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });

  test('dark', async ({ page }) => {
    await capture(page, 'phone', 'dark');
  });

  test('light', async ({ page }) => {
    await capture(page, 'phone', 'light');
  });
});

/**
 * P11.3: the surfaces that were only guarded by geometry assertions.
 *
 * Each one is a state a player reaches, not a default screen, so each needs its
 * own setup — a waiting worker for the update banner, a second filter stage, a
 * recorded take, a lit oversampling LED, an applied template, a pulled
 * modulation wire. They live in their own tests rather than inside `capture()`
 * because every one of them changes the patch: recording a take puts notes in
 * the roll, applying a template rewires the graph, and the surfaces above are
 * baselines for the *default* screen. Reusing a page would quietly rewrite
 * those baselines as a side effect, which is exactly what a visual baseline is
 * supposed to prevent.
 */

/**
 * Fake a service worker that is already waiting, before the app boots. Copied
 * from `e2e/update-banner.spec.ts`: this is the only state in which the banner
 * renders, and it lasts one release per visitor in real life.
 */
async function withWaitingWorker(page: Page) {
  await page.addInitScript(() => {
    const registration = {
      waiting: { state: 'installed', postMessage() {} },
      installing: null,
      active: { state: 'activated' },
      scope: `${location.origin}/`,
      update: async () => {},
      addEventListener() {},
      removeEventListener() {},
      unregister: async () => true,
    };
    const container = {
      controller: {},
      ready: Promise.resolve(registration),
      register: async () => registration,
      getRegistration: async () => registration,
      getRegistrations: async () => [registration],
      addEventListener() {},
      removeEventListener() {},
      startMessages() {},
    };
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  });
}

/** The six P11.3 surfaces of one (theme × device) combination. */
async function captureSurfaces(page: Page, device: Device, theme: 'dark' | 'light') {
  const phone = device === 'phone';
  const suffix = `${theme}-${device}`;
  const tap = async (locator: import('@playwright/test').Locator) => {
    if (phone) await locator.tap();
    else await locator.click();
  };

  // 1. The update banner. The waiting worker has to exist before the app boots,
  //    and the banner is an overlay, so it is dismissed before anything else is
  //    captured.
  await withWaitingWorker(page);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/');
  const banner = page.locator('.update-banner');
  await expect(banner).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  // `.update-what` is the one line that is *defined* to differ every release:
  // `App.tsx` renders `v{newest.version} · {headline}` from the build's
  // `CHANGELOG_HEAD`, so a baseline that includes it goes red on every version
  // bump — a false alarm, and one that only teaches people to ignore a red
  // visual suite. It is masked instead, and the *layout* it sits in is pinned by
  // `e2e/update-banner.spec.ts` on both viewports (banner height <= 64/120 px,
  // `.update-copy` height <= 36 px, the one-line ellipsis, and both action
  // buttons exactly 32 px). What this baseline guards is the shell: background,
  // radius, spacing, the two fixed actions.
  await shot(page, '.update-banner', `banner-${suffix}.png`, ['.update-what']);
  await tap(banner.locator('.update-x'));
  await expect(banner).toHaveCount(0);

  // Dismissing the banner *is* a gesture, and any gesture starts the engine
  // (`App.tsx` listens for pointerdown/touchend on the window), so the start
  // gate is usually gone by now. The fallback keeps this honest if that ever
  // stops being true, and either way the engine has to be running before the
  // rest of the surfaces exist.
  //
  // The fallback asks whether the *button* is clickable, not whether it exists:
  // between the engine starting and React removing the gate, `.start-btn` is
  // still in the DOM for a frame or two and already `disabled`, and clicking it
  // then waits out the whole test timeout (observed, light desktop surfaces).
  // `toBeEnabled` waits that frame out; the click after it always lands.
  const start = page.locator('.start-btn');
  if ((await start.count()) && (await start.isEnabled())) await startEngine(page, phone);
  else {
    await expect(page.locator('.start-overlay')).toHaveCount(0);
    await expect(page.locator('.kbd-dock.open')).toBeVisible();
  }
  await page.waitForTimeout(400);

  // 2. The second filter stage, series then parallel, and the 2x LED lit. The
  //    stage is put back to OFF afterwards so a state this spec only borrowed
  //    does not travel into the next capture.
  const filter = page.locator('[data-module-id="filter"]');
  const routing = (label: string) => filter.getByRole('button', { name: label, exact: true });
  await filter.scrollIntoViewIfNeeded();
  await tap(routing('SER'));
  await expect(filter.getByRole('slider', { name: 'CUTOFF 2', exact: true })).toBeVisible();
  await filter.scrollIntoViewIfNeeded();
  await shot(page, '[data-module-id="filter"]', `filter-ser-${suffix}.png`);

  await tap(routing('PAR'));
  await expect(filter.getByRole('slider', { name: 'BLEND', exact: true })).toBeVisible();
  await filter.scrollIntoViewIfNeeded();
  await shot(page, '[data-module-id="filter"]', `filter-par-${suffix}.png`);

  const led = filter.locator('button[aria-label*="过采样"]');
  await tap(led);
  await expect(led).toHaveAttribute('aria-pressed', 'true');
  await filter.scrollIntoViewIfNeeded();
  await shot(
    page,
    '[data-module-id="filter"] .toggle-cell:has(button[aria-label*="过采样"])',
    `oversample-${suffix}.png`,
  );
  await tap(led);
  await expect(led).toHaveAttribute('aria-pressed', 'false');
  await tap(routing('OFF'));
  await expect(filter.getByRole('slider', { name: 'CUTOFF 2', exact: true })).toHaveCount(0);

  // 3. The effect graph: the template picker, and a modulation wire on the
  //    canvas. The edge is made from the strip selects (the path a phone gets)
  //    rather than a drag, so the same setup works on both devices.
  const keyboard = page.locator('[data-kb="1"][aria-pressed="true"]');
  if (await keyboard.count()) await keyboard.first().click();
  // A collapsed module does not render its body, and a phone starts with FX
  // folded, so the button only exists once the module is opened.
  const fxModule = page.locator('[data-module-id="fx"]');
  await fxModule.scrollIntoViewIfNeeded();
  const collapse = fxModule.locator('.module-collapse');
  if ((await collapse.getAttribute('aria-expanded')) === 'false') await tap(collapse);
  const graph = page.locator('[data-act="fx-graph"]');
  await expect(graph).toHaveCount(1);
  await graph.scrollIntoViewIfNeeded();
  await tap(graph);
  const panel = page.locator('.fxg-panel');
  await expect(panel).toBeVisible();

  await page.locator('[data-act="template"]').selectOption('fxg:dual-delay');
  await shot(page, '.fxg-tpl', `template-${suffix}.png`);

  await page.locator('[data-act="mod-src"][data-mod-row="0"]').selectOption('1');
  await page.locator('[data-act="mod-dst"][data-mod-row="0"]').selectOption('3');
  // A wire is only drawn while its depth is non-zero, so the strip has to give
  // it one; a drag sets this itself, a select does not.
  await page.locator('[data-act="mod-depth"][data-mod-row="0"]').fill('50');
  // A phone opens on the list view; the wire is drawn on the canvas. Two
  // locators, because the same edge has two honest presentations: the desktop
  // scroll window shows the wire itself, while on a 390-wide phone the strip
  // rows plus the per-node override rows fill the dialog and leave the scroll
  // window 33 px tall (measured), so the phone baseline is the modulation
  // strip that carries the edge. `.fxg-canvas` is never shot directly: it is
  // eight cards tall, and an element larger than its scroll container makes
  // Playwright capture beyond the viewport instead of the wire.
  await tap(page.locator('[data-act="view-canvas"]'));
  await expect(page.locator('[data-modwire="0"]')).toHaveCount(1);
  await shot(page, phone ? '.fxg-mod[data-view="mod"]' : '.fxg-scroll', `modwire-${suffix}.png`);
  await tap(page.locator('[data-act="close"]'));
  await expect(panel).toHaveCount(0);

  // 4. The player's take row, with two real passes in it. Recording is what the
  //    row is for, so an empty row would not be a baseline of anything. The
  //    keys come back first: the step above folded them away.
  const keyboardToggle = page.locator('[data-kb="1"]');
  if ((await keyboardToggle.getAttribute('aria-pressed')) === 'false') await tap(keyboardToggle);
  await expect(page.locator('.kbd-dock.open')).toBeVisible();
  await tap(page.locator('.player-open'));
  await expect(page.locator('.player.open')).toBeVisible();
  const record = page.locator('.player .player-transport button[aria-label="录制"]');
  const stopRecord = page.locator('.player .player-transport button[aria-label="停止录制"]');
  // Both notes are inside the phone keyboard's single octave (48–60); a desktop
  // keyboard spans two, but the baseline has to be the same surface on both.
  for (const midi of [55, 60]) {
    await tap(record);
    const key = page.locator(`[data-midi="${midi}"]`).first();
    await key.dispatchEvent('pointerdown', { pointerId: midi });
    await page.waitForTimeout(140);
    await key.dispatchEvent('pointerup', { pointerId: midi });
    await page.waitForTimeout(60);
    await tap(stopRecord);
  }
  await expect(page.locator('.take-tools [data-act="take"]')).toHaveCount(2);
  // Auditioning a chip starts the transport; stop it so the row is not showing
  // a moving playhead.
  await tap(page.locator('.player .player-transport button[aria-label="停止"]'));
  await page.waitForTimeout(300);
  await shot(page, '.take-tools', `takes-${suffix}.png`);
}

test.describe('desktop 1440×900 · P11.3 surfaces', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });

  test('dark', async ({ page }) => {
    await captureSurfaces(page, 'desktop', 'dark');
  });

  test('light', async ({ page }) => {
    await captureSurfaces(page, 'desktop', 'light');
  });
});

test.describe('iPhone 390×844 · P11.3 surfaces', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });

  test('dark', async ({ page }) => {
    await captureSurfaces(page, 'phone', 'dark');
  });

  test('light', async ({ page }) => {
    await captureSurfaces(page, 'phone', 'light');
  });
});

/**
 * The suite proving it can fail. A baseline comparison that cannot report a
 * difference is worse than no comparison, because it is trusted: so paint an
 * obviously wrong colour into a live page, ask for the same comparison the
 * suite just made, and require it to be *rejected*.
 *
 * Skipped while recording (`--update-snapshots` rewrites baselines instead of
 * comparing them) and in smoke mode (nothing is compared there to prove).
 */
test.describe('self-check', () => {
  test.skip(UPDATING || SMOKE, '录制基线时不比较；冒烟模式不比基线，自证的是比对机制本身');
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });

  /**
   * The banner baseline has to survive a release, or it is a false alarm every
   * version. This is the proof of the mechanism rather than a promise: the same
   * screenshot is taken twice, with two different version lines (a longer one
   * standing in for the next release's), and both must match the *one* recorded
   * baseline — because `.update-what` is masked (see `captureSurfaces`).
   *
   * The second half reuses the painted-style trick: a change to the banner's
   * *shell* must still be caught, so the mask is not covering the whole surface.
   */
  test('the banner baseline does not depend on the release line', async ({ page }) => {
    await withWaitingWorker(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const banner = page.locator('.update-banner');
    await expect(banner).toBeVisible();
    const options = {
      ...SHOT,
      mask: [...ANIMATED, '.update-what'].map((selector) => page.locator(selector)),
    };
    await expect(banner).toHaveScreenshot('banner-dark-desktop.png', options);

    // A different release: another version number, another headline, and one
    // long enough to change what the line would draw if it were not masked.
    await page.locator('.update-what').evaluate((el) => {
      el.textContent = 'v9.99.9 · a much longer headline than this release has, written to change the line';
    });
    await expect(banner).toHaveScreenshot('banner-dark-desktop.png', options);

    // …and the shell is still guarded: a painted banner must be rejected.
    await page.addStyleTag({ content: '.update-banner{background:#ff00ff !important}' });
    await expect(async () => {
      await expect(banner).toHaveScreenshot('banner-dark-desktop.png', { ...options, timeout: 4_000 });
    }).rejects.toThrow(/screenshot|pixels|diff/i);
  });

  test('a painted style change is reported as a diff', async ({ page }) => {
    await gotoApp(page, 'dark');
    await startEngine(page, false);
    await page.waitForTimeout(400);

    const grid = page.locator('.modules-grid');
    const name = 'modules-dark-desktop.png';
    const options = {
      ...SHOT,
      mask: ANIMATED.map((selector) => page.locator(selector)),
    };
    // First, the unmodified page has to match — otherwise this test proves
    // nothing about the perturbation that follows. It starts from a primed
    // raster for the reason `prime()` documents: the red this test reported in
    // a full-suite run was an unpainted first capture of the 1440 px grid, not
    // a dirty starting state (the page is box-stable here and the same red came
    // back when the test ran *alone* on a loaded host).
    await prime(page, '.modules-grid');
    await expect(grid).toHaveScreenshot(name, options);

    await page.addStyleTag({
      content: '.modules-grid .module{background:#ff00ff !important}',
    });
    // Primed again, for the same reason plus one more: without it the
    // *rejection* below could be caused by an unpainted capture instead of by
    // the painted modules, which would make this self-check pass for the wrong
    // reason.
    await prime(page, '.modules-grid');
    await expect(async () => {
      await expect(grid).toHaveScreenshot(name, { ...options, timeout: 4_000 });
    }).rejects.toThrow(/screenshot|pixels|diff/i);
  });
});
