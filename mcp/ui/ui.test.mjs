// @vitest-environment node
/**
 * P13.4 tests for the browser layer's contract: every `gs1.ui.*` tool's
 * published schema, every refusal path, and the shared-implementation claim.
 *
 * No browser is launched here (the real one is `npm run ui:smoke`). What is
 * tested is what the layer promises before a browser exists:
 *
 *   * `gs1.ui.open` refuses external URLs, protocol-relative paths and a
 *     non-string path, and only ever targets its own preview origin;
 *   * `gs1.ui.gate` refuses a spec outside the whitelist and any project but
 *     chromium, and when it does run it uses **its own port** and parses the
 *     Playwright JSON report;
 *   * `gs1.ui.text` / `click` / `screenshot` refuse without an open page, and a
 *     selector that never appears is a structured `E_UI_TIMEOUT`, not a hang;
 *   * `gs1.ui.screenshot` only writes names inside `.tmp/mcp/`;
 *   * the preview refuses the E2E suite's port (4783) and serves only `dist/`;
 *   * the offline registry never contains a `gs1.ui.*` tool, and the browser
 *     layer's tools are exactly the five documented ones.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ERRORS, errorPayload } from '../lib/errors.mjs';
import { validate } from '../lib/validate.mjs';
import { dispatch } from '../protocol.mjs';
import { loadTools } from '../registry.mjs';
import { loadLayer } from './server.mjs';
import { loadUiTools, uiToolFiles } from './registry.mjs';
import { BrowserSession } from './lib/session.mjs';
import { startPreview, previewPort, DEFAULT_PORT, E2E_PORT } from './lib/preview.mjs';
import { baselineFor, DIST_BASELINES } from './lib/baselines.mjs';
import openTool from './tools/open.mjs';
import clickTool from './tools/click.mjs';
import textTool from './tools/text.mjs';
import screenshotTool from './tools/screenshot.mjs';
import gateTool, { SPECS } from './tools/gate.mjs';
import { TMP_DIR, ROOT } from '../lib/data.mjs';

/** Run a handler and return the structured rejection it throws. */
async function rejection(promise) {
  try {
    await promise;
    throw new Error('expected a rejection but the call succeeded');
  } catch (error) {
    return errorPayload(error).error;
  }
}

let uiTools;
beforeAll(async () => {
  uiTools = await loadUiTools();
});

describe('A. the browser layer is its own set of files', () => {
  it('registers exactly the five documented tools', () => {
    expect([...uiTools.keys()].sort()).toEqual([
      'gs1.ui.click',
      'gs1.ui.gate',
      'gs1.ui.open',
      'gs1.ui.screenshot',
      'gs1.ui.text',
    ]);
  });

  it('every UI tool publishes a name, a description and an object schema', () => {
    for (const tool of uiTools.values()) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('the offline registry never sees a gs1.ui.* tool (npm run mcp stays browser-free)', async () => {
    const offline = await loadTools();
    expect([...offline.keys()].filter((name) => name.startsWith('gs1.ui.'))).toEqual([]);
  });

  it('the UI helpers are not registered as tools', () => {
    expect(uiToolFiles()).not.toContain('_common.mjs');
    expect(uiToolFiles().every((file) => file.endsWith('.mjs'))).toBe(true);
  });

  it('the tool files name the shared interaction module, not a second copy of the hit test', () => {
    const click = readFileSync(resolve(ROOT, 'mcp/ui/tools/click.mjs'), 'utf8');
    // `../../../e2e/interact.mjs` from mcp/ui/tools/ is the repository's e2e/.
    expect(click).toContain('../../../e2e/interact.mjs');
    // No scroll/hit-test arithmetic of its own: no page.evaluate, no
    // elementFromPoint (the word may appear in a comment about the shared
    // implementation; the call must not).
    expect(click).not.toMatch(/elementFromPoint\s*\(/);
    expect(click).not.toMatch(/\.evaluate\s*\(/);
    // And the module it imports is the one the fixtures install.
    const fixtures = readFileSync(resolve(ROOT, 'e2e/fixtures.ts'), 'utf8');
    expect(fixtures).toContain("from './interact.mjs'");
    expect(fixtures).toContain('interact.click');
  });
});

describe('B. gs1.ui.open — only this server\'s own preview', () => {
  const session = new BrowserSession();
  const call = (args) => openTool.handler(args, { ui: session });

  it('refuses an external URL before any socket is opened', async () => {
    const error = await rejection(call({ url: 'https://example.com/' }));
    expect(error.code).toBe(ERRORS.UI_URL);
    expect(error.allowedOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(session.server).toBe(null);
    expect(session.browser).toBe(null);
  });

  it('refuses a localhost URL on someone else\'s port', async () => {
    const error = await rejection(call({ url: `http://127.0.0.1:${E2E_PORT}/` }));
    expect(error.code).toBe(ERRORS.UI_URL);
  });

  it('refuses a protocol-relative path and a path that is not a path', async () => {
    expect((await rejection(call({ path: '//example.com/x' }))).code).toBe(ERRORS.UI_URL);
    expect((await rejection(call({ path: 'https://example.com' }))).code).toBe(ERRORS.UI_URL);
    expect((await rejection(call({ path: 7 }))).code).toBe(ERRORS.UI_URL);
  });

  it('refuses a non-string url', async () => {
    expect((await rejection(call({ url: 7 }))).code).toBe(ERRORS.SCHEMA);
  });

  it('validates the published schema itself (unknown fields are rejected)', () => {
    expect(() => validate(openTool.inputSchema, { nope: 1 })).toThrow(/unknown field/);
    expect(() => validate(openTool.inputSchema, { viewport: { width: 10, height: 900 } })).toThrow(/below the minimum/);
    expect(() => validate(openTool.inputSchema, { viewport: { width: 1440 } })).toThrow(/missing required field "height"/);
  });

  it('reports the 1440x900 baseline for its default viewport', () => {
    const baseline = baselineFor(DIST_BASELINES[0]);
    expect(baseline.names.length).toBeGreaterThan(0);
    expect(baseline.width).toBe(1440);
    expect(baseline.height).toBe(900);
  });
});

describe('C. verbs that need a page refuse without one', () => {
  const empty = { ui: new BrowserSession() };
  it('gs1.ui.click', async () => {
    expect((await rejection(clickTool.handler({ selector: 'body' }, empty))).code).toBe(ERRORS.UI_SESSION);
  });
  it('gs1.ui.text', async () => {
    expect((await rejection(textTool.handler({}, empty))).code).toBe(ERRORS.UI_SESSION);
  });
  it('gs1.ui.screenshot', async () => {
    expect((await rejection(screenshotTool.handler({ name: 'x.png' }, empty))).code).toBe(ERRORS.UI_SESSION);
  });
});

/**
 * A fake `BrowserSession`: a page whose locator never becomes visible, which is
 * the "element is not there" case -- it must come back as a structured
 * `E_UI_TIMEOUT` (the real Playwright message) rather than hang.
 */
function fakeContext() {
  const makeLocator = () => ({
    waitFor: async () => {
      throw new Error('locator.waitFor: Timeout 100ms exceeded.\nCall log:\n  - waiting for locator(\'.nope\').first()');
    },
    count: async () => 0,
    first() {
      return this;
    },
    nth() {
      return this;
    },
    evaluate: async () => null,
  });
  const page = {
    locator: () => makeLocator(),
  };
  return {
    ui: {
      requirePage: () => page,
      baseline: () => null,
      viewport: { width: 1440, height: 900 },
      consoleErrorCount: () => 0,
    },
  };
}

describe('D. a missing element is a structured timeout', () => {
  it('gs1.ui.click returns E_UI_TIMEOUT, not a hang or an internal error', async () => {
    const error = await rejection(clickTool.handler({ selector: '.nope', timeoutMs: 100 }, fakeContext()));
    expect(error.code).toBe(ERRORS.UI_TIMEOUT);
    expect(error.selector).toBe('.nope');
  });

  it('gs1.ui.text is honest about an empty match instead of failing', async () => {
    const result = await textTool.handler({ selector: '.nope' }, fakeContext());
    expect(result).toMatchObject({ ok: true, count: 0, text: null });
  });

  it('gs1.ui.screenshot refuses an element that is not there', async () => {
    const error = await rejection(screenshotTool.handler({ selector: '.nope' }, fakeContext()));
    expect(error.code).toBe(ERRORS.UI_TIMEOUT);
  });
});

describe('E. gs1.ui.screenshot writes only inside .tmp/mcp/', () => {
  const ctx = fakeContext();
  for (const name of ['../escape.png', 'sub/dir.png', '..png', 'src/x.png']) {
    it(`refuses name ${JSON.stringify(name)}`, async () => {
      const error = await rejection(screenshotTool.handler({ name }, ctx));
      expect(error.code).toBe(ERRORS.PATH);
      expect(error.allowedRoot).toBe('.tmp/mcp/');
    });
  }

  it('validates the published schema (animations enum, unknown fields)', () => {
    expect(() => validate(screenshotTool.inputSchema, { animations: 'sometimes' })).toThrow(/must be one of/);
    expect(() => validate(screenshotTool.inputSchema, { path: '/etc/passwd' })).toThrow(/unknown field/);
  });
});

describe('F. gs1.ui.gate is whitelisted', () => {
  it('publishes exactly the three documented specs', () => {
    expect(Object.keys(SPECS).sort()).toEqual(['param-range', 'performance', 'visual']);
    expect(SPECS.visual.spec).toBe('e2e/visual.spec.ts');
    expect(SPECS.performance.spec).toBe('e2e/performance.spec.ts');
    expect(SPECS.performance.project).toBe('perf');
    expect(SPECS.performance.workers).toBe(1);
    expect(SPECS['param-range'].spec).toBe('e2e/param-range.spec.ts');
  });

  it('the schema refuses any other spec before the handler runs', () => {
    expect(() => validate(gateTool.inputSchema, { spec: '../../evil.spec.ts' })).toThrow(/must be one of/);
    expect(() => validate(gateTool.inputSchema, { spec: 'visual', project: 'webkit' })).toThrow(/must be one of/);
    expect(() => validate(gateTool.inputSchema, { spec: 'visual', args: ['--headed'] })).toThrow(/unknown field/);
  });

  it('the handler refuses an unknown spec and a non-chromium project', async () => {
    expect((await rejection(gateTool.handler({ spec: 'evil' }, {}))).code).toBe(ERRORS.UI_SPEC);
    expect((await rejection(gateTool.handler({ spec: 'visual', project: 'webkit' }, {}))).code).toBe(ERRORS.UI_SPEC);
  });

  it('runs the whitelisted spec on its own port and parses the JSON report', async () => {
    const previous = process.env.GS1_MCP_UI_PORT;
    process.env.GS1_MCP_UI_PORT = '4797';
    const reportFile = resolve(TMP_DIR, 'ui-gate-report.json');
    const spawn = vi.fn((command, args, options) => {
      expect(command).toBe('npx');
      expect(args.slice(0, 2)).toEqual(['playwright', 'test']);
      expect(args).toContain('e2e/visual.spec.ts');
      expect(args).toContain('--project=chromium');
      expect(options.env.GS1_E2E_PORT).toBe('4797');
      expect(options.env.GS1_VISUAL).toBe('1');
      writeFileSync(
        options.env.PLAYWRIGHT_JSON_OUTPUT_FILE,
        JSON.stringify({
          suites: [
            {
              title: 'visual.spec.ts',
              specs: [
                {
                  title: 'splash desktop',
                  tests: [{ projectName: 'chromium', status: 'passed', results: [{ status: 'passed', duration: 12 }] }],
                },
                {
                  title: 'flow phone',
                  tests: [
                    {
                      projectName: 'chromium',
                      expectedStatus: 'passed',
                      results: [{ status: 'failed', error: { message: 'pixel mismatch\nmore' } }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      const handlers = {};
      const child = {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, handler) => {
          handlers[event] = handler;
          if (event === 'close') setTimeout(() => handlers.close(1), 0);
          return child;
        },
      };
      return child;
    });
    try {
      const result = await gateTool.handler({ spec: 'visual' }, { spawn });
      expect(result.port).toBe(4797);
      expect(result.url).toBe('http://127.0.0.1:4797');
      expect(result.exitCode).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.passed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.reportParsed).toBe(true);
      expect(result.tests.map((test) => test.title)).toEqual([
        'visual.spec.ts › splash desktop',
        'visual.spec.ts › flow phone',
      ]);
      expect(result.tests[1].error).toBe('pixel mismatch');
      expect(result.logPath).toBe('.tmp/mcp/ui-gate.log');
      expect(result.reportPath).toBe('.tmp/mcp/ui-gate-report.json');
      expect(existsSync(reportFile)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.GS1_MCP_UI_PORT;
      else process.env.GS1_MCP_UI_PORT = previous;
    }
  });
});

describe('G. the layer speaks the protocol: the five tools are dispatchable', () => {
  beforeAll(() => {
    if (!process.env.GS1_MCP_UI_PORT) process.env.GS1_MCP_UI_PORT = String(DEFAULT_PORT);
  });

  it('registers all 19 tools and refuses a bad argument through `tools/call`', async () => {
    const { tools, ctx, offline, ui } = await loadLayer({ log: false });
    try {
      expect(offline.size).toBe(14);
      expect(ui.size).toBe(5);
      expect(tools.size).toBe(19);

      const call = (name, args) =>
        dispatch(tools, ctx, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { log: false });

      // A tool rejection is a *successful* JSON-RPC response with isError.
      const external = await call('gs1.ui.open', { url: 'https://example.com/' });
      expect(external.error).toBeUndefined();
      expect(external.result.isError).toBe(true);
      expect(external.result.structuredContent.error.code).toBe(ERRORS.UI_URL);

      // A malformed argument never reaches the handler.
      const badSpec = await call('gs1.ui.gate', { spec: 'nope' });
      expect(badSpec.result.isError).toBe(true);
      expect(badSpec.result.structuredContent.error.code).toBe(ERRORS.SCHEMA);

      // A verb that needs a page says so, without a browser existing.
      const noPage = await call('gs1.ui.text', {});
      expect(noPage.result.isError).toBe(true);
      expect(noPage.result.structuredContent.error.code).toBe(ERRORS.UI_SESSION);

      // Nothing started a browser or a server along the way.
      expect(ctx.ui.server).toBe(null);
      expect(ctx.ui.browser).toBe(null);
    } finally {
      await ctx.ui.close();
    }
  }, 60_000);

  it('refuses to start when GS1_MCP_UI_PORT points at the E2E suite', async () => {
    const previous = process.env.GS1_MCP_UI_PORT;
    process.env.GS1_MCP_UI_PORT = String(E2E_PORT);
    try {
      const error = await rejection(loadLayer({ log: false }));
      expect(error.code).toBe(ERRORS.RANGE);
      expect(error.e2ePort).toBe(E2E_PORT);
    } finally {
      process.env.GS1_MCP_UI_PORT = previous ?? String(DEFAULT_PORT);
    }
  }, 60_000);
});

describe('G. the preview server is loopback-only and refuses the E2E port', () => {
  let fixture;
  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'gs1-ui-preview-'));
    mkdirSync(join(fixture, 'assets'), { recursive: true });
    writeFileSync(join(fixture, 'index.html'), '<title>fixture</title>');
    writeFileSync(join(fixture, 'assets', 'app.js'), 'console.log(1)');
  });
  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it('the default port is 4796 and 4783 is refused', () => {
    const previous = process.env.GS1_MCP_UI_PORT;
    delete process.env.GS1_MCP_UI_PORT;
    expect(previewPort()).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).not.toBe(E2E_PORT);
    expect(E2E_PORT).toBe(4783);
    process.env.GS1_MCP_UI_PORT = '4783';
    let error;
    try {
      previewPort();
    } catch (thrown) {
      error = errorPayload(thrown).error;
    }
    expect(error.code).toBe(ERRORS.RANGE);
    expect(error.e2ePort).toBe(4783);
    process.env.GS1_MCP_UI_PORT = 'not-a-port';
    expect(() => previewPort()).toThrow(/must be 1\.\.65535/);
    if (previous === undefined) delete process.env.GS1_MCP_UI_PORT;
    else process.env.GS1_MCP_UI_PORT = previous;
  });

  it('serves dist/ on 127.0.0.1 and falls back to index.html for a route', async () => {
    const server = await startPreview({ port: 0, distDir: fixture });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const root = await fetch(server.url);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain('fixture');
      const asset = await fetch(`${server.url}/assets/app.js`);
      expect(asset.headers.get('content-type')).toContain('text/javascript');
      // A deep link is the SPA's route, not a 404.
      const route = await fetch(`${server.url}/deep/link`);
      expect(await route.text()).toContain('fixture');
      // A path that climbs out of dist/ is the fallback, never the file.
      const escape = await fetch(`${server.url}/../../etc/passwd`);
      expect(await escape.text()).toContain('fixture');
    } finally {
      await server.close();
    }
  });

  it('refuses to start with no built application', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gs1-ui-empty-'));
    try {
      const error = await rejection(startPreview({ port: 0, distDir: empty }));
      expect(error.code).toBe(ERRORS.PATH);
      expect(error.distDir).toContain('gs1-ui-empty-');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
