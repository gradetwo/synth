/**
 * The browser session behind `gs1.ui.*`.
 *
 * One process owns at most one preview server, one Chromium and one page. The
 * page is what `gs1.ui.click` / `text` / `screenshot` act on; `gs1.ui.open`
 * (re)creates it and is the only tool that navigates. Nothing here touches the
 * caller's filesystem except through `resolveOutputPath` (`.tmp/mcp/` only), and
 * nothing here opens a socket to anywhere but this machine's own preview.
 *
 * Browser: **Chromium only**, with the same autoplay flag the E2E suite's
 * chromium project uses (`--autoplay-policy=user-gesture-required`), because a
 * page whose audio context is silently suspended cannot show the agent what the
 * app does. The default viewport is **1440x900** — the desktop viewport
 * `e2e/visual.spec.ts` records its baselines at, so `gs1.ui.screenshot` on a
 * fresh page is the same size as `splash-*-desktop-chromium-linux.png`
 * (1440x900). Service workers are blocked: the built app registers one, and a
 * cached shell is the last thing a tool that claims to show "the current build"
 * should be looking at.
 */
import { relative } from 'node:path';
import { DIST_BASELINES, baselineFor } from './baselines.mjs';
import { previewPort, startPreview } from './preview.mjs';
import { ROOT } from '../../lib/data.mjs';
import { ERRORS, fail } from '../../lib/errors.mjs';

/** The desktop viewport the visual baselines are recorded at. */
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/** Chromium's autoplay flag, copied from `playwright.config.ts`'s chromium project. */
const LAUNCH_ARGS = ['--autoplay-policy=user-gesture-required'];

/**
 * Everything the UI tools share.
 *
 * `preview()` starts the static server on first use and reuses it after that:
 * the server is the expensive-to-restart part, the page is not.
 */
export class BrowserSession {
  constructor() {
    this.server = null;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.consoleErrors = [];
    this.lastOpenedAt = null;
    this.viewport = null;
  }

  get isOpen() {
    return Boolean(this.page && !this.page.isClosed());
  }

  /** The current page, or a structured refusal for the verbs that need one. */
  requirePage() {
    if (!this.isOpen) {
      throw fail(ERRORS.UI_SESSION, 'no page is open — call gs1.ui.open first', {
        hint: 'gs1.ui.click / text / screenshot need the page gs1.ui.open created',
      });
    }
    return this.page;
  }

  async ensureServer() {
    if (!this.server) this.server = await startPreview();
    return this.server;
  }

  async ensureBrowser() {
    if (!this.browser) {
      let chromium;
      try {
        ({ chromium } = await import('playwright'));
      } catch (error) {
        throw fail(ERRORS.UI_BROWSER, `playwright is not installed: ${error?.message ?? error}`, {
          hint: 'npm install',
        });
      }
      try {
        this.browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
      } catch (error) {
        throw fail(ERRORS.UI_BROWSER, `chromium did not launch: ${error?.message ?? error}`, {
          hint: 'npx playwright install chromium',
        });
      }
    }
    return this.browser;
  }

  /**
   * Point a page at `path` on this process's own preview server.
   *
   * @returns {Promise<{ url: string, requestedUrl: string, title: string, status: number|null,
   *                     viewport: {width:number,height:number}, consoleErrors: number,
   *                     consoleMessages: string[], startedInMs: number, navigationMs: number,
   *                     distDir: string, previewPort: number }>}
   */
  async open({ path = '/', url, viewport = DEFAULT_VIEWPORT, timeoutMs = 20_000 } = {}) {
    const started = Date.now();
    // Validate the target *before* starting a server or a browser: a refusal
    // should cost the caller nothing, and an external URL must not get as far as
    // a socket.
    this.resolveTarget({ path, url, server: null });
    const server = await this.ensureServer();
    const target = this.resolveTarget({ path, url, server });

    const browser = await this.ensureBrowser();
    if (this.context && this.viewport
      && (this.viewport.width !== viewport.width || this.viewport.height !== viewport.height)) {
      // A different viewport needs a different context: a page cannot change it
      // retroactively, and a half-resized page is worse than a fresh one.
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (!this.context) {
      this.context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        serviceWorkers: 'block',
      });
      this.viewport = { width: viewport.width, height: viewport.height };
    }

    const page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page = page;
    this.consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') this.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => this.consoleErrors.push(`${error.name}: ${error.message}`));

    const navStart = Date.now();
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const navigationMs = Date.now() - navStart;
    // `domcontentloaded` is not "the app is up": React mounts after it, and a
    // tool that reports an empty `#root` as a working page is worse than one
    // that says it waited and the app did not appear. The anchor is the
    // toolbar's browse button (`.tbtn.primary`, `src/panels/layout.tsx`): it is
    // there only once the shell has rendered, which is when a click can hope to
    // land. The boot gate is still a modal over the shell, so `ready` says
    // whether it is gone -- clearing it needs a real audio context, which is the
    // app's business and deliberately not something this tool forces.
    const bootStart = Date.now();
    let mounted = false;
    let gateCleared = false;
    try {
      await page.waitForFunction(
        () => {
          const root = document.getElementById('root');
          return Boolean(root && root.children.length);
        },
        undefined,
        { timeout: timeoutMs },
      );
      mounted = true;
      await page.locator('.tbtn.primary').first().waitFor({ state: 'attached', timeout: timeoutMs });
      gateCleared = (await page.locator('.start-overlay').count()) === 0;
    } catch {
      // Reported below; the caller decides whether the page is usable.
    }
    const bootMs = Date.now() - bootStart;
    this.lastOpenedAt = new Date().toISOString();
    return {
      url: page.url(),
      requestedUrl: target,
      title: await page.title(),
      status: response ? response.status() : null,
      viewport: { ...this.viewport },
      consoleErrors: this.consoleErrors.length,
      consoleMessages: this.consoleErrors.slice(0, 5),
      mounted,
      gateCleared,
      ready: mounted && this.consoleErrors.length === 0,
      startedInMs: Date.now() - started,
      navigationMs,
      bootMs,
      distDir: relative(ROOT, server.distDir) || '.',
      previewPort: server.port,
    };
  }

  /**
   * Resolve the caller's `path`/`url` into a loopback URL on **this** server.
   *
   * `docs/LLM-INTERFACE.md` says the browser layer may only open the local
   * preview, so anything with a host other than this server's own is refused
   * with `E_UI_URL` rather than fetched.
   */
  resolveTarget({ path, url, server }) {
    const allowedOrigin = server?.url ?? `http://127.0.0.1:${previewPort()}`;
    if (url !== undefined) {
      if (typeof url !== 'string' || !url) {
        throw fail(ERRORS.SCHEMA, '`url` must be a non-empty string', { field: 'url' });
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw fail(ERRORS.UI_URL, '`url` must be an absolute http(s) URL or a local path', {
          field: 'url',
          url,
          allowedOrigin,
        });
      }
      if (parsed.origin !== allowedOrigin) {
        throw fail(ERRORS.UI_URL, 'external URLs are refused: this tool only opens its own 127.0.0.1 preview', {
          field: 'url',
          url,
          allowedOrigin,
        });
      }
      return parsed.href;
    }
    const requested = path ?? '/';
    if (typeof requested !== 'string' || !requested.startsWith('/')) {
      throw fail(ERRORS.UI_URL, '`path` must be a path on the local preview, starting with "/"', {
        field: 'path',
        path: requested ?? null,
      });
    }
    if (requested.startsWith('//')) {
      throw fail(ERRORS.UI_URL, 'protocol-relative paths are refused', { field: 'path', path: requested });
    }
    return new URL(requested, allowedOrigin).href;
  }

  /** Console errors accumulated on the current page (the screenshots report them). */
  consoleErrorCount() {
    return this.consoleErrors.length;
  }

  /** The visual baseline the current viewport corresponds to, if any. */
  baseline() {
    if (!this.viewport) return null;
    return baselineFor(this.viewport);
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    await this.server?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.server = null;
    this.page = null;
  }
}

export { DIST_BASELINES };
