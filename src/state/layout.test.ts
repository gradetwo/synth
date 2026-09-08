import { describe, expect, it } from 'vitest';
import { MODULE_IDS, MODULE_META, defaultLayout, moveModule, normalizeLayout } from './layout';

describe('layout model', () => {
  it('ships every module exactly once by default', () => {
    const layout = defaultLayout();
    expect(layout.order).toEqual(MODULE_IDS);
    expect(new Set(layout.order).size).toBe(MODULE_IDS.length);
    expect(layout.keyboardVisible).toBe(true);
    expect(layout.collapsed).toEqual({});
    expect(layout.theme).toBe('dark');
  });

  it('has metadata for every module', () => {
    for (const id of MODULE_IDS) {
      const meta = MODULE_META[id];
      expect(meta.title).toBeTruthy();
      expect(meta.color).toBeTruthy();
      expect([1, 2]).toContain(meta.span);
    }
  });

  it('repairs persisted layouts with unknown, duplicate or missing ids', () => {
    const layout = normalizeLayout({
      order: ['fx', 'nope', 'fx', 'osc1'],
      collapsed: { filter: true, bogus: true, osc1: false },
      keyboardVisible: false,
    });
    expect(layout.order[0]).toBe('fx');
    expect(layout.order[1]).toBe('osc1');
    expect(new Set(layout.order).size).toBe(MODULE_IDS.length);
    expect(layout.order).toHaveLength(MODULE_IDS.length);
    expect(layout.collapsed.filter).toBe(true);
    expect(layout.collapsed.osc1).toBeUndefined();
    expect(layout.keyboardVisible).toBe(false);
    expect(layout.theme).toBe('dark');
  });

  it('validates the theme', () => {
    expect(normalizeLayout({ theme: 'contrast' }).theme).toBe('contrast');
    expect(normalizeLayout({ theme: 'nope' }).theme).toBe('dark');
  });

  it('falls back to defaults for garbage input', () => {
    expect(normalizeLayout(null).order).toEqual(MODULE_IDS);
    expect(normalizeLayout('nope').order).toEqual(MODULE_IDS);
    expect(normalizeLayout({ order: 42 }).order).toEqual(MODULE_IDS);
  });

  it('moves a module to an index and clamps out-of-range targets', () => {
    const order = defaultLayout().order;
    const first = moveModule(order, 'fx', 0);
    expect(first[0]).toBe('fx');
    expect(first).toHaveLength(order.length);
    expect(new Set(first).size).toBe(order.length);

    const last = moveModule(order, 'osc1', 99);
    expect(last[last.length - 1]).toBe('osc1');
    expect(last).toHaveLength(order.length);

    expect(moveModule(order, 'osc1', 0)).toBe(order);
  });
});
