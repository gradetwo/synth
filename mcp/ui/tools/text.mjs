/**
 * `gs1.ui.text` — let the agent read the interface.
 *
 * Returns rendered text (`innerText`, falling back to `textContent`), from one
 * element or from all matches, plus an optional attribute. The whole document is
 * the default so "what is on the screen" needs no selector; `all` says whether
 * the caller wants one element's text or the list of matches.
 *
 * An empty match is `ok: true` with `count: 0` and empty text, not an error:
 * "this control is not on screen" is a fact the agent needs, and a rejection
 * would push it into guessing why.
 */
import { MAX_TEXT, READ_ATTRIBUTE, READ_TEXT, normaliseText, uiError } from './_common.mjs';

async function readOne(locator, attribute) {
  if (attribute) return locator.evaluate(READ_ATTRIBUTE, attribute);
  return locator.evaluate(READ_TEXT);
}

export default {
  name: 'gs1.ui.text',
  description:
    'Read visible text (or one attribute) from the open page: the whole body by default, one element by selector, or every match with all:true. Reports counts and truncation, never fails on an empty match.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', minLength: 1, description: 'CSS/text/role selector; defaults to the document body.' },
      all: { type: 'boolean', description: 'Return every match as a list instead of the first one\'s text.' },
      attribute: { type: 'string', minLength: 1, description: 'Read this attribute instead of the text, e.g. "value" or "aria-pressed".' },
      maxLength: { type: 'integer', minimum: 1, maximum: 20_000, description: 'Truncate the text at this many characters (default 20000).' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const page = ctx.ui.requirePage();
    const locator = args.selector ? page.locator(args.selector) : page.locator('body');
    const limit = args.maxLength ?? MAX_TEXT;
    try {
      const count = await locator.count();
      if (args.all) {
        const values = [];
        for (let index = 0; index < Math.min(count, 200); index += 1) {
          const raw = await readOne(locator.nth(index), args.attribute);
          values.push(args.attribute ? raw : normaliseText(raw));
        }
        return {
          ok: true,
          selector: args.selector ?? 'body',
          count,
          returned: values.length,
          attribute: args.attribute ?? null,
          values,
        };
      }
      if (count === 0) {
        return { ok: true, selector: args.selector ?? 'body', count: 0, text: null, truncated: false, attribute: args.attribute ?? null };
      }
      const raw = await readOne(locator.first(), args.attribute);
      const text = args.attribute ? (raw ?? null) : normaliseText(raw);
      const body = typeof text === 'string' ? text : '';
      return {
        ok: true,
        selector: args.selector ?? 'body',
        count,
        attribute: args.attribute ?? null,
        text: body.length > limit ? body.slice(0, limit) : body,
        length: body.length,
        truncated: body.length > limit,
      };
    } catch (error) {
      throw uiError(error, { field: 'selector', selector: args.selector ?? 'body' });
    }
  },
};
