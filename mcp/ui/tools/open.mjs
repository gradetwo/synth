/**
 * `gs1.ui.open` — put the built app in front of the agent.
 *
 * Starts (or reuses) this process's own `127.0.0.1` preview of `dist/` and
 * navigates a Chromium page to it. The only URL this tool will open is that
 * preview: `docs/LLM-INTERFACE.md` §7's answer to "letting an agent drive a
 * browser is dangerous" is "it may only reach the local build", so an external
 * host is a structured `E_UI_URL` rejection rather than a request.
 *
 * The returned numbers are the ones a caller needs before trusting anything
 * else: the final URL, the title, the viewport it really got, and **how many
 * console errors the page produced** — an app that throws on boot still renders
 * a title, and a screenshot of it should not be mistaken for a working page.
 */
import { DEFAULT_VIEWPORT } from '../lib/session.mjs';
import { viewportField } from './_common.mjs';

export default {
  name: 'gs1.ui.open',
  description:
    'Open the locally built app in Chromium (own 127.0.0.1 preview of dist/, default viewport 1440x900) and report title, URL, viewport and console errors. External URLs are refused; only this server\'s own preview can be opened.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path on the local preview to open (default "/").',
      },
      url: {
        type: 'string',
        description: 'Absolute URL on this server\'s own loopback preview; any other origin is refused (E_UI_URL).',
      },
      viewport: viewportField,
      waitForMs: {
        type: 'integer',
        minimum: 100,
        maximum: 120_000,
        description: 'How long to wait for the app to mount and its start overlay to clear (default 20000).',
      },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const viewport = args.viewport ?? DEFAULT_VIEWPORT;
    const opened = await ctx.ui.open({
      path: args.path,
      url: args.url,
      viewport,
      timeoutMs: args.waitForMs,
    });
    const baseline = ctx.ui.baseline();
    return {
      ok: true,
      ...opened,
      layer: 'browser',
      note: 'Chromium against this process\'s own vite-less static preview of dist/; service workers are blocked.',
      baseline: baseline
        ? {
            device: baseline.device,
            width: baseline.width,
            height: baseline.height,
            note: baseline.note,
            count: baseline.names.length,
            names: baseline.names.slice(0, 4),
          }
        : null,
    };
  },
};
