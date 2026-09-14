/**
 * `gs1.ui.click` — click an element in the page `gs1.ui.open` opened.
 *
 * The dispatch is `e2e/interact.mjs`: the same frame-free implementation the
 * E2E suite installs over Playwright's verbs for WebKit (timer-based
 * visibility, `isEnabled`, a DOM scroll, a `locator.evaluate` box read, an
 * `elementFromPoint` hit test retried to the deadline, then a real
 * `page.mouse.click`). There is deliberately no second hit-test in `mcp/`.
 *
 * `force` keeps Playwright's meaning — skip the actionability checks — which
 * the frame-free path used to ignore, so a forced click on an obscured element
 * stalled until the timeout. The result reports the point that was clicked and
 * whether the hit test ran, so "forced" is visible in the output instead of
 * having to be inferred.
 */
import { interact } from '../../../e2e/interact.mjs';
import { describeElement, uiError } from './_common.mjs';

export default {
  name: 'gs1.ui.click',
  description:
    'Click an element in the open page with the E2E suite\'s frame-free interaction (visibility + enabled + elementFromPoint hit test, then a real mouse click). force:true skips the actionability checks, as Playwright defines it.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', minLength: 1, description: 'CSS selector, or text=… / role=… as Playwright accepts.' },
      force: { type: 'boolean', description: 'Skip the actionability checks (visibility, enabled, hit test).' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 120_000, description: 'How long to retry the hit test (default 5000).' },
      position: {
        type: 'object',
        required: ['x', 'y'],
        additionalProperties: false,
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        description: 'Offset inside the element to click, in CSS pixels (default: its centre).',
      },
    },
    required: ['selector'],
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const page = ctx.ui.requirePage();
    const locator = page.locator(args.selector);
    const options = {
      force: args.force === true,
      timeout: args.timeoutMs ?? 5000,
      ...(args.position ? { position: args.position } : {}),
    };
    const started = Date.now();
    try {
      const before = await describeElement(locator);
      const point = await interact.frameFreePoint(locator, options);
      const box = await interact.boxOf(locator).catch(() => null);
      await interact.click(locator, options);
      return {
        ok: true,
        selector: args.selector,
        force: options.force,
        hitTested: !options.force,
        clicked: { x: point.x, y: point.y },
        box,
        element: before,
        elapsedMs: Date.now() - started,
        implementation: 'e2e/interact.mjs (shared with e2e/fixtures.ts)',
      };
    } catch (error) {
      throw uiError(error, { field: 'selector', selector: args.selector, force: options.force });
    }
  },
};
