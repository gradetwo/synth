import { expect, test, type Page } from '@playwright/test';

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
 * The service worker is blocked on purpose: it caches the *previous* build, so
 * a suite that ran through it would be comparing a fresh baseline against a
 * stale page for one run after every rebuild (observed, with the accent
 * experiment below).
 *
 * The suite carries its own proof that it can fail — see the last test, which
 * paints a change into a live page and expects the comparison to reject it.
 */

const RUN = process.env.GS1_VISUAL === '1';

/** Bumping baselines: a passing `--update-snapshots` means nothing was compared. */
const UPDATING = process.env.GS1_VISUAL_UPDATE === '1';

/** Animated-by-the-driver regions: asserted by their own tests, masked here. */
const ANIMATED = ['.mini-canvas', '.scope-body', '.vu-track'];

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

async function shot(page: Page, locator: string, name: string, masks: string[] = []) {
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
 * The suite proving it can fail. A baseline comparison that cannot report a
 * difference is worse than no comparison, because it is trusted: so paint an
 * obviously wrong colour into a live page, ask for the same comparison the
 * suite just made, and require it to be *rejected*.
 *
 * Skipped while recording: `--update-snapshots` rewrites baselines instead of
 * comparing them, which would overwrite the real one with the perturbation.
 */
test.describe('self-check', () => {
  test.skip(UPDATING, '录制基线时不比较，自证放到普通运行里做');
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });

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
    // nothing about the perturbation that follows.
    await expect(grid).toHaveScreenshot(name, options);

    await page.addStyleTag({
      content: '.modules-grid .module{background:#ff00ff !important}',
    });
    await expect(async () => {
      await expect(grid).toHaveScreenshot(name, { ...options, timeout: 4_000 });
    }).rejects.toThrow(/screenshot|pixels|diff/i);
  });
});
