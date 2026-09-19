/**
 * `gs1.ui.screenshot` — write a real PNG of the page into `.tmp/mcp/`.
 *
 * The file goes through P13.2's `resolveOutputPath`, so the write boundary is
 * the same one every other tool has: `.tmp/mcp/`, or a refusal. The result
 * carries the **width and height read back out of the PNG header** (not out of
 * the request), the sha256 and the byte length, so a caller can verify the file
 * it got.
 *
 * Size versus the visual baselines is reported, not assumed: the default
 * viewport (1440x900) is the one `e2e/visual.spec.ts` records
 * `*-desktop-chromium-linux.png` at, so a fresh page's full-viewport shot is
 * exactly the baseline size, and the result names the baselines it matches.
 */
import { readFileSync } from 'node:fs';
import { resolveOutputPath, repoPath } from '../../lib/paths.mjs';
import { sha256Hex } from '../../lib/wav.mjs';
import { ERRORS, fail } from '../../lib/errors.mjs';
import { describeElement, uiError } from './_common.mjs';

/** PNG: 8-byte signature, then the IHDR chunk's width and height (big-endian u32). */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw fail(ERRORS.UI_BROWSER, 'screenshot is not a PNG', { bytes: buffer.length });
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** A file name inside `.tmp/mcp/`, never a path that could climb out of it. */
function nameFor(requested, fallback) {
  const name = (requested ?? fallback).trim();
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    throw fail(ERRORS.PATH, '`name` must be a plain file name inside .tmp/mcp/', {
      field: 'name',
      requested: requested ?? null,
      allowedRoot: '.tmp/mcp/',
    });
  }
  return name.endsWith('.png') ? name : `${name}.png`;
}

/** How many default-named screenshots this process has written (no clock in a path). */
let shotCounter = 0;

export default {
  name: 'gs1.ui.screenshot',
  description:
    'Screenshot the open page (or one element) to .tmp/mcp/ and report the PNG\'s real width/height, sha256 and byte length, plus which visual baseline size it matches. Default viewport 1440x900 = the desktop baseline size.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'File name inside .tmp/mcp/ (default ui-page-N.png, N counted from 1 per process).' },
      fullPage: { type: 'boolean', description: 'Capture the full scrollable page instead of the viewport.' },
      selector: { type: 'string', minLength: 1, description: 'Screenshot this element instead of the page.' },
      animations: { type: 'string', enum: ['disabled', 'allow'], description: 'Freeze CSS animations before the shot (default "disabled", as the visual baselines do).' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const page = ctx.ui.requirePage();
    shotCounter += 1;
    const name = nameFor(args.name, `ui-page-${shotCounter}.png`);
    const outPath = resolveOutputPath(`.tmp/mcp/${name}`);
    const shotOptions = {
      path: outPath,
      animations: args.animations ?? 'disabled',
      caret: 'hide',
      scale: 'css',
      fullPage: args.fullPage === true,
    };

    let element = null;
    try {
      if (args.selector) {
        element = await describeElement(page.locator(args.selector));
        if (element.count === 0) {
          throw fail(ERRORS.UI_TIMEOUT, `no element matches "${args.selector}"`, {
            field: 'selector',
            selector: args.selector,
          });
        }
        await page.locator(args.selector).first().screenshot(shotOptions);
      } else {
        await page.screenshot(shotOptions);
      }
    } catch (error) {
      throw uiError(error, { field: 'path', name, selector: args.selector ?? null });
    }

    const buffer = readFileSync(outPath);
    const size = pngSize(buffer);
    const baseline = ctx.ui.baseline();
    const matchesBaseline = baseline && !args.selector && !args.fullPage
      ? baseline.width === size.width && baseline.height === size.height
      : null;
    return {
      ok: true,
      screenshotPath: repoPath(outPath),
      width: size.width,
      height: size.height,
      bytes: buffer.length,
      sha256: sha256Hex(buffer),
      fullPage: shotOptions.fullPage,
      selector: args.selector ?? null,
      element: args.selector ? { count: element.count, tag: element.tag, id: element.id } : null,
      viewport: { ...ctx.ui.viewport },
      consoleErrors: ctx.ui.consoleErrorCount(),
      baseline: baseline
        ? {
            device: baseline.device,
            width: baseline.width,
            height: baseline.height,
            names: baseline.names.slice(0, 4),
            count: baseline.names.length,
            matches: matchesBaseline,
          }
        : null,
    };
  },
};
