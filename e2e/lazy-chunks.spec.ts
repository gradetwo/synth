import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from './fixtures';

/**
 * The two content chunks stay out of the first screen (P9.26).
 *
 * `state/presets.ts` (45 KB raw / 10.2 KB gzip) and `midi/songs.ts` (32 KB /
 * 9.0 KB) used to be imported eagerly by `state/store.ts` and `midi/library.ts`,
 * which put both in the entry chunk the `initialJs` budget line measures. They
 * are dynamic imports now, and this is the test that says so from the outside:
 *
 *   * the first screen (before the start gesture, so before any idle warm-up)
 *     must not have *requested* either chunk;
 *   * opening the drawer / the player must request them and then really show
 *     the content — a panel that renders an empty list is not "lazy", it is
 *     broken.
 *
 * The chunks are found by *content*, not by file name: a rollup rename, a merge
 * with another lazy module or a hashed name all still work, and a regression
 * that puts the table back in the entry chunk makes this fail on the entry chunk
 * itself. `performance.getEntriesByType('resource')` is the page's own list, so
 * the service worker's background precache (which the brief accepts: it is not
 * on the critical path and it is what makes the drawer work offline) is not
 * counted here — see `docs/notes/bundle-budget.md`.
 */

const DIST = resolve(process.cwd(), 'dist');
const PRESET_SENTINEL = 'Acid 303';
const SONG_SENTINEL = 'Londonderry Air';

/** Every built asset whose text contains `needle`, by base name. */
function chunksWith(needle: string): string[] {
  const assets = join(DIST, 'assets');
  return readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => readFileSync(join(assets, name), 'utf8').includes(needle));
}

/** The page's own resource list, as the brief asks for it. */
async function requested(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
}

const basename = (url: string) => url.split('/').pop() ?? url;

/** The built assets (sentinel-bearing) that this resource list actually pulled. */
const pulled = (names: string[], resources: string[]) =>
  names.filter((name) => resources.some((url) => basename(url) === name));

test.describe('lazy content chunks', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the first screen requests neither the preset table nor the song list', async ({ page }) => {
    const presetChunks = chunksWith(PRESET_SENTINEL);
    const songChunks = chunksWith(SONG_SENTINEL);
    // If the build no longer carries these strings the assertion below would be
    // vacuous, so that is a failure in its own right.
    expect(presetChunks.length, `${PRESET_SENTINEL} in dist/assets`).toBeGreaterThan(0);
    expect(songChunks.length, `${SONG_SENTINEL} in dist/assets`).toBeGreaterThan(0);

    // The page-level request log, printed so a failure shows exactly what the
    // first visit asked for.
    const pageRequests: string[] = [];
    page.on('request', (request) => pageRequests.push(request.url()));

    await page.goto('/', { waitUntil: 'load' });
    // Long enough for the entry chunk's own dynamic imports to have happened if
    // any were fired on the boot path.
    await page.waitForTimeout(2500);
    const resources = await requested(page);
    console.log('[lazy-chunks] first-screen resources:', JSON.stringify(resources, null, 2));
    console.log('[lazy-chunks] preset chunk(s):', presetChunks, 'song chunk(s):', songChunks);
    console.log('[lazy-chunks] sw-visible requests:', JSON.stringify([...new Set(pageRequests)], null, 2));

    expect(pulled(presetChunks, resources), 'factory presets requested on the first screen').toEqual([]);
    expect(pulled(songChunks, resources), 'built-in songs requested on the first screen').toEqual([]);
    // The app really did load: otherwise "nothing was requested" would be trivially
    // true of a blank page.
    await expect(page.locator('.start-overlay')).toHaveCount(1);
  });

  test('opening the preset drawer fetches the table and shows the presets', async ({ page }) => {
    const presetChunks = chunksWith(PRESET_SENTINEL);
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '预设库' }).click();

    // The list really arrives — the loading row is replaced by the library.
    await expect(page.locator('.d-list .pcard').first()).toBeVisible();
    await expect.poll(() => page.locator('.d-list .pcard').count()).toBeGreaterThan(20);
    await expect(page.locator('.d-status[role="status"]')).toHaveCount(0);

    // …and it is the lazy chunk that brought it.
    const resources = await requested(page);
    expect(pulled(presetChunks, resources), 'factory presets fetched by the drawer').toEqual(presetChunks);
  });

  test('opening the player fetches the song list and shows the demos', async ({ page }) => {
    const songChunks = chunksWith(SONG_SENTINEL);
    await page.goto('/');
    await page.getByRole('button', { name: /启动音频引擎/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.player-open').click();
    await expect(page.locator('.player.open')).toBeVisible();

    // The demos are there, with their titles, not just the user's own tracks.
    await expect(page.locator('.player-track', { hasText: '致爱丽丝', hasNotText: '八位机' })).toHaveCount(1);
    await expect.poll(() => page.locator('.player-track').count()).toBeGreaterThanOrEqual(16);
    await expect(page.locator('.player-status[role="status"]')).toHaveCount(0);

    const resources = await requested(page);
    expect(pulled(songChunks, resources), 'built-in songs fetched by the player').toEqual(songChunks);
  });

  /**
   * The offline half of the same change.
   *
   * `scripts/gen-sw.mjs` precaches everything but the scalar WASM core, so both
   * new chunks are in the worker's list: a visitor who *does* open the drawer or
   * the player can do it offline, and a visitor who does not still never has the
   * page ask for them (the two tests above). This pins both facts so dropping
   * them from the precache has to be a deliberate edit here too, and records
   * where they sit in the generated list.
   */
  test('the generated worker precaches both chunks for offline use', async ({ page }) => {
    const presetChunks = chunksWith(PRESET_SENTINEL);
    const songChunks = chunksWith(SONG_SENTINEL);
    const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
    const list = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map((match) => match[1]);
    for (const name of [...presetChunks, ...songChunks]) {
      const at = list.findIndex((entry) => entry.endsWith(name));
      console.log(`[lazy-chunks] precache #${at} of ${list.length}: ${name}`);
      expect(at, `${name} in the precache list`).toBeGreaterThanOrEqual(0);
    }

    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });
    for (const name of [...presetChunks, ...songChunks]) {
      expect(cached.some((url) => url.endsWith(name)), `${name} in the worker cache`).toBe(true);
    }
  });
});
