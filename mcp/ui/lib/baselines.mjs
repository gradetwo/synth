/**
 * The visual baselines this layer compares its screenshots against.
 *
 * `e2e/visual.spec.ts` records its two viewports by name — the Playwright
 * template is `{arg}{-projectName}{-snapshotSuffix}`, so the desktop baselines
 * are `*-desktop-chromium-linux.png` at **1440x900** and the phone ones are
 * `*-phone-chromium-linux.png` at **390x844**. `gs1.ui.screenshot` reports the
 * size of every file it writes; when the page is at one of the baseline
 * viewports and the shot is the whole viewport, it also reports which baselines
 * that size corresponds to, and whether they match exactly. "The screenshot is
 * the same size as the visual baseline" is then a fact in the result rather than
 * a claim in a document.
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `e2e/visual.spec.ts-snapshots/`, resolved from this file (mcp/ui/lib). */
export const BASELINE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../e2e/visual.spec.ts-snapshots',
);

/** The two viewports the visual suite uses, with the reason each one is what it is. */
export const DIST_BASELINES = [
  { device: 'desktop', width: 1440, height: 900, note: 'visual.spec.ts `desktop 1440×900` describe block' },
  { device: 'phone', width: 390, height: 844, note: 'visual.spec.ts phone describe block (iPhone 12 viewport)' },
];

/** The baseline family a viewport corresponds to, or null when it is not one of them. */
export function baselineFor(viewport) {
  const match = DIST_BASELINES.find(
    (entry) => entry.width === viewport.width && entry.height === viewport.height,
  );
  if (!match) return null;
  return { ...match, names: baselineNames(match.device) };
}

/** The baseline files recorded for one device, sorted; `[]` when the directory is missing. */
export function baselineNames(device) {
  try {
    return readdirSync(BASELINE_DIR)
      .filter((file) => file.includes(`-${device}-chromium-linux.png`))
      .sort();
  } catch {
    return [];
  }
}
