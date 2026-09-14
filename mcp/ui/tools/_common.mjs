/**
 * Schema fragments and small shared helpers for the `gs1.ui.*` tools.
 *
 * Keeping them here means the browser layer publishes one shape per concept,
 * exactly as `mcp/tools/_schemas.mjs` does for the offline tools, and the
 * element-resolution / error-shape rules live in one place instead of five.
 */
import { ERRORS, fail } from '../../lib/errors.mjs';

/** The page's viewport. 1440x900 is the desktop baseline's size (see lib/baselines.mjs). */
export const viewportField = {
  type: 'object',
  required: ['width', 'height'],
  additionalProperties: false,
  properties: {
    width: { type: 'integer', minimum: 320, maximum: 3840, description: 'Viewport width in CSS pixels (default 1440).' },
    height: { type: 'integer', minimum: 240, maximum: 2400, description: 'Viewport height in CSS pixels (default 900).' },
  },
  description: 'Page viewport; the default 1440x900 is the visual baseline\'s desktop size.',
};

/** The maximum slice of an element's text a tool will return. */
export const MAX_TEXT = 20_000;

/** `gs1.ui.*` runs the same page for every verb, so a missing element is a tool failure, not a crash. */
export function uiError(error, context) {
  if (error && error.code) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/Timeout .*exceeded|waiting for/.test(message)) {
    return fail(ERRORS.UI_TIMEOUT, message, context);
  }
  return fail(ERRORS.UI_BROWSER, message, context);
}

/** Collapse the whitespace a DOM read returns; a text report is for reading, not for diffing. */
export function normaliseText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * A DOM-visible slice: what a user (and so an agent) can actually read.
 *
 * `innerText` is the rendered text (it honours `display: none`); `textContent`
 * is the fallback for elements that have no layout box, such as a `<template>`
 * or a detached node. These are real function values on purpose: Playwright's
 * `evaluate` runs a *function* in the page, and a template string is treated as
 * an expression (which silently answered nothing here).
 */
export const READ_TEXT = (el) => {
  const text = el.innerText !== undefined && el.innerText !== null && el.innerText !== ''
    ? el.innerText
    : (el.textContent ?? '');
  return String(text);
};

/** Read one attribute, or null when it is absent. */
export const READ_ATTRIBUTE = (el, name) => el.getAttribute(name);

/**
 * A cheap description of an element for a result the caller has to trust.
 *
 * Reads `locator.first()`: calling `evaluate` on a locator that matches several
 * elements is an error in Playwright, and "which element did it click" is
 * exactly the question this answers. Returns `{ count }` when nothing matched,
 * so the caller can report "not found" instead of a raw strict-mode error.
 */
export async function describeElement(locator) {
  const count = await locator.count().catch(() => 0);
  if (count === 0) return { count: 0 };
  const description = await locator
    .first()
    .evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: (el.className && String(el.className).split(/\s+/).filter(Boolean).slice(0, 6)) || [],
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      text: (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 160),
    }))
    .catch(() => null);
  return { count, ...(description ?? {}) };
}
