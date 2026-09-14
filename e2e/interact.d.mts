/**
 * Types for `interact.mjs`.
 *
 * The module is plain JavaScript on purpose (both `e2e/fixtures.ts` and the MCP
 * browser layer import it, and `mcp/` is `.mjs` throughout), so its public shape
 * is declared here rather than inferred across the JS/TS boundary.
 */
import type { Locator, Page } from '@playwright/test';

export type InteractOptions = {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  force?: boolean;
  modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>;
  noWaitAfter?: boolean;
  position?: { x: number; y: number };
  timeout?: number;
  trial?: boolean;
};

export type FrameFreePoint = { page: Page; x: number; y: number; forced: boolean };

export const READ_BOX: string;
export const HIT_TEST: string;

export function setDefaultTimeout(ms: number): void;
export function defaultTimeout(): number;
export function scrollIntoView(locator: Locator): Promise<void>;
export function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }>;
export function frameFreePoint(locator: Locator, options?: InteractOptions): Promise<FrameFreePoint>;
export function click(locator: Locator, options?: InteractOptions): Promise<void>;
export function tap(locator: Locator, options?: InteractOptions): Promise<void>;
export function hover(locator: Locator, options?: InteractOptions): Promise<void>;
export function dblclick(locator: Locator, options?: InteractOptions): Promise<void>;
export function check(locator: Locator, options?: InteractOptions): Promise<void>;
export function uncheck(locator: Locator, options?: InteractOptions): Promise<void>;
export function scrollIntoViewIfNeeded(locator: Locator, options?: { timeout?: number }): Promise<void>;

export const interact: {
  click: typeof click;
  dblclick: typeof dblclick;
  hover: typeof hover;
  tap: typeof tap;
  check: typeof check;
  uncheck: typeof uncheck;
  scrollIntoViewIfNeeded: typeof scrollIntoViewIfNeeded;
  frameFreePoint: typeof frameFreePoint;
  scrollIntoView: typeof scrollIntoView;
  boxOf: typeof boxOf;
  setDefaultTimeout: typeof setDefaultTimeout;
  defaultTimeout: typeof defaultTimeout;
};
