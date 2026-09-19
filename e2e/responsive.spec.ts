import { expect, test, type Page } from './fixtures';

/**
 * iPhone and iPad, both orientations.
 *
 * The layout switches on the short side of the viewport (`<620` phone, `<900`
 * tablet), so portrait and landscape exercise different code paths, and the
 * compact top bar puts entries behind a menu. These tests boot the app at real
 * device sizes and check the things a wrong breakpoint breaks: the start gate
 * fitting on screen, no sideways scrolling, the settings entry reachable, the
 * drawer fitting, and the keyboard being there.
 */
const DEVICES = [
  { name: 'iPhone portrait', width: 393, height: 852, touch: true },
  { name: 'iPhone landscape', width: 852, height: 393, touch: true },
  { name: 'iPad portrait', width: 820, height: 1180, touch: true },
  { name: 'iPad landscape', width: 1180, height: 820, touch: true },
  { name: 'iPad mini portrait', width: 768, height: 1024, touch: true },
  { name: 'iPad mini landscape', width: 1024, height: 768, touch: true },
];

/** Horizontal overflow is the classic breakpoint failure. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

for (const device of DEVICES) {
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.touch,
      isMobile: device.touch,
    });

    test('boots, fits, and opens the settings', async ({ page, browserName }) => {
      test.setTimeout(90_000);
      await page.goto('/');

      // The start gate has to fit the screen it is offered on.
      const start = page.locator('.start-btn');
      await expect(start).toBeVisible();
      const startBox = (await start.boundingBox())!;
      expect(startBox.x).toBeGreaterThanOrEqual(0);
      expect(startBox.y).toBeGreaterThanOrEqual(0);
      expect(startBox.x + startBox.width).toBeLessThanOrEqual(device.width + 1);
      expect(startBox.y + startBox.height).toBeLessThanOrEqual(device.height + 1);

      await start.click();
      await page.waitForTimeout(500);
      expect(await overflow(page), 'no sideways scrolling after start').toBeLessThanOrEqual(1);

      // The settings are their own entry at this size too: inline where the bar
      // has room, behind the overflow menu on phones and portrait tablets.
      const entry = page.locator('[data-act="settings"]').first();
      if (!(await entry.isVisible())) {
        await page.locator('.top-more > .tbtn.icon').first().click();
      }
      await expect(entry).toBeVisible();
      await entry.click();
      const panel = page.locator('.settings-drawer.open');
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(device.width + 1);
      // Every section is there, and nothing inside pushes the drawer sideways.
      await expect(panel.locator('.settings-section')).toHaveCount(5);
      expect(await overflow(page), 'no sideways scrolling with the drawer open').toBeLessThanOrEqual(1);

      // Touch targets: everything a finger has to hit is at least 40px, and the
      // 1/2 instance switch is a real button rather than a 26px sliver.
      //
      // Every rule behind that lives in `@media (pointer: coarse)` in
      // `src/styles/gs1.css` (min-height/min-width 44px on the settings rows,
      // the selects and the segmented switches), so the assertion can only
      // observe it on an engine whose emulated device reports a coarse pointer
      // at all. Playwright's WebKit does on Linux headless -- measured here:
      // `(pointer: coarse)` and `(any-pointer: coarse)` both true under
      // `hasTouch` + `isMobile`, 44px targets, nothing cramped.
      //
      // macOS WebKit also reports `(pointer: coarse)` **true** for these six
      // profiles -- that was measured on the macOS box; an earlier note here
      // claiming it reports false was wrong. What fails there is the box, not
      // the media query: WebKit draws a select with the default (native)
      // appearance from the platform control's own metrics and ignores
      // `min-height`/`padding` on it, so four selects in these rows measured
      // 82x19, 95x19, 152x19 and 53x19 while every button beside them measured
      // 44x44. `appearance:none` would fix the box but drops the native
      // dropdown arrow, so the product wraps each select in a
      // `.select-target` label whose 44px `min-height` is the coarse-pointer
      // target; the control keeps its own look and place inside it.
      //
      // That makes the wrapper the thing a finger hits, so it is measured
      // below -- and a select that has a wrapper is *not* measured on its own,
      // because its remaining 19px box is exactly what the wrapper exists to
      // cover. The activation is the label's native forwarding (a tap on the
      // wrapper reaches the control; probe-verified on Linux Chromium and
      // Linux WebKit, where an edge tap produces the same click/focus signature
      // as a tap on the control itself). No `showPicker()` is used: Safari does
      // not implement it (BCD: "preview", behind a flag), so a fallback there
      // would focus without opening the picker.
      //
      // The Linux stand-in for "no coarse pointer", measured by turning
      // `hasTouch` off, reads 16 x 28/30 px targets -- not the same numbers as
      // macOS, which is exactly why this guard keys on the media feature rather
      // than on a device list.
      //
      // So on WebKit-without-a-coarse-pointer the reading is printed, the
      // assertion is named-skipped (the `e2e/audio-host.ts` pattern -- reason on
      // the terminal and an annotation in the report) and everything else in
      // this test still runs: five sections, drawer width, no sideways
      // scrolling, the phone chrome row and the on-screen keyboard. Chromium
      // and Firefox do report a coarse pointer for these profiles (measured on
      // Linux: true on both), so there the assertion runs for real; if that
      // stops being true the `expect` below fails instead of the coverage
      // quietly disappearing.
      const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
      if (!coarse) {
        const reason =
          `the emulated device does not report (pointer: coarse), so the @media (pointer: coarse) block ` +
          `that sizes these targets cannot apply and the 40px rule is not observable here. ` +
          `Chromium/Linux-WebKit carry this assertion.`;
        expect(
          coarse || browserName === 'webkit',
          `${browserName} reports (pointer: coarse) under hasTouch/isMobile`,
        ).toBe(true);
        test
          .info()
          .annotations.push({ type: 'skip-touch-targets', description: reason });
        console.log(`[touch-targets] ${browserName}: skip -- ${reason}`);
      } else {
        const cramped = await panel
          .locator('.settings-section button, .settings-section select, .settings-section .select-target')
          .evaluateAll((els) =>
            els
              // The wrapper is the target now; a select inside one is the 19px
              // control it covers. See the comment above.
              .filter((el) => !(el.tagName === 'SELECT' && el.closest('.select-target')))
              .map((el) => el.getBoundingClientRect())
              .filter((box) => box.width > 0 && box.height > 0 && (box.height < 40 || box.width < 40))
              .map((box) => `${Math.round(box.width)}x${Math.round(box.height)}`),
          );
        expect(cramped).toEqual([]);
      }

      await panel.locator('.d-close').click();
      await expect(panel).not.toBeVisible();

      // Phone portrait: the patch name has its own row and reads in full, and
      // the view switch moved to the row below instead of squeezing it.
      if (device.width <= 430) {
        const chrome = await page.evaluate(() => {
          const name = document.querySelector('.preset-name') as HTMLElement;
          const preset = document.querySelector('.preset-ctrl') as HTMLElement;
          const view = document.querySelector('.view-row') as HTMLElement;
          return {
            truncated: name.scrollWidth > name.clientWidth + 1,
            viewBelow: Math.round(view.getBoundingClientRect().top) >=
              Math.round(preset.getBoundingClientRect().bottom) - 4,
          };
        });
        expect(chrome.truncated).toBe(false);
        expect(chrome.viewBelow).toBe(true);
      }

      // The keyboard is the one control that must never be off screen.
      const keyboard = page.locator('.keyboard, .kbd-dock').first();
      await expect(keyboard).toBeVisible();
      const keys = (await keyboard.boundingBox())!;
      expect(keys.y + keys.height).toBeLessThanOrEqual(device.height + 1);
    });
  });
}
