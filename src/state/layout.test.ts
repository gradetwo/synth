import { describe, expect, it } from 'vitest';
import { MODULE_IDS, MODULE_META, defaultLayout, moveModule, normalizeLayout } from './layout';

describe('layout model', () => {
  it('ships every module exactly once by default', () => {
    const layout = defaultLayout();
    expect(layout.order).toEqual(MODULE_IDS);
    expect(new Set(layout.order).size).toBe(MODULE_IDS.length);
    expect(layout.keyboardVisible).toBe(true);
    expect(layout.collapsed).toEqual({});
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
  });

  it('falls back to defaults for garbage input', () => {
    expect(normalizeLayout(null).order).toEqual(MODULE_IDS);
    expect(normalizeLayout('nope').order).toEqual(MODULE_IDS);
    expect(normalizeLayout({ order: 42 }).order).toEqual(MODULE_IDS);
  });

  it('moves a module to an index and clamps out-of-range targets', () => {
    const order = defaultLayout().order;
    expect(moveModule(order, 'fx', 0)).toEqual(['fx', 'osc1', 'osc2', 'filter', 'env', 'lfo', 'matrix']);
    expect(moveModule(order, 'osc1', 99)).toEqual(['osc2', 'filter', 'env', 'lfo', 'matrix', 'fx', 'osc1']);
    expect(moveModule(order, 'osc1', 0)).toBe(order);
  });
});
