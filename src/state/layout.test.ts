import { describe, expect, it } from 'vitest';
import { Param } from '@/audio/params';
import { MODULE_IDS, MODULE_META, defaultLayout, moveModule, normalizeLayout } from './layout';

describe('layout model', () => {
  it('ships every module exactly once by default', () => {
    const layout = defaultLayout();
    expect(layout.order).toEqual(MODULE_IDS);
    expect(new Set(layout.order).size).toBe(MODULE_IDS.length);
    expect(layout.keyboardVisible).toBe(true);
    expect(layout.collapsed).toEqual({});
    expect(layout.theme).toBe('auto');
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
    expect(layout.theme).toBe('auto');
  });

  it('validates the theme and migrates the old contrast mode', () => {
    expect(normalizeLayout({ theme: 'light' }).theme).toBe('light');
    expect(normalizeLayout({ theme: 'auto' }).theme).toBe('auto');
    expect(normalizeLayout({ theme: 'nope' }).theme).toBe('auto');
    expect(normalizeLayout({}).theme).toBe('auto');
    // Older saves stored high contrast as a theme value.
    const migrated = normalizeLayout({ theme: 'contrast' });
    expect(migrated.theme).toBe('dark');
    expect(migrated.contrast).toBe(true);
    expect(normalizeLayout({ contrast: true }).contrast).toBe(true);
  });

  it('validates velocity mode and haptics', () => {
    const base = defaultLayout();
    expect(base.velocityMode).toBe('fixed');
    expect(base.haptics).toBe(true);

    expect(normalizeLayout({ velocityMode: 'touch' }).velocityMode).toBe('touch');
    expect(normalizeLayout({ velocityMode: 'nope' }).velocityMode).toBe('fixed');
    expect(normalizeLayout({ haptics: false }).haptics).toBe(false);
    expect(normalizeLayout({ haptics: true }).haptics).toBe(true);
    expect(normalizeLayout({}).haptics).toBe(true);
  });

  it('keeps the effect-graph card positions it recognises, and repairs the rest', () => {
    const layout = normalizeLayout({
      fxGraphPos: {
        dry: [40, 60],
        node3: [300.4, 120.6],
        out: [9999, -9999],
        lfo1: [12, 158],
        env: [12, 446],
        nope: [10, 10],
        node9: [10, 10],
        node2: ['x', 12],
      },
    });
    expect(layout.fxGraphPos.dry).toEqual([40, 60]);
    expect(layout.fxGraphPos.node3).toEqual([300, 121]);
    // A card dragged off the board is pulled back to where it can be grabbed.
    expect(layout.fxGraphPos.out).toEqual([2400, -400]);
    // The modulation source cards keep their place too (P7.2).
    expect(layout.fxGraphPos.lfo1).toEqual([12, 158]);
    expect(layout.fxGraphPos.env).toEqual([12, 446]);
    // Unknown keys and malformed pairs are dropped, not trusted.
    expect(layout.fxGraphPos.nope).toBeUndefined();
    expect(layout.fxGraphPos.node9).toBeUndefined();
    expect(layout.fxGraphPos.node2).toBeUndefined();
    // A layout from before the graph existed simply has none.
    expect(normalizeLayout({}).fxGraphPos).toEqual({});
  });

  it('falls back to defaults for garbage input', () => {
    expect(normalizeLayout(null).order).toEqual(MODULE_IDS);
    expect(normalizeLayout('nope').order).toEqual(MODULE_IDS);
    expect(normalizeLayout({ order: 42 }).order).toEqual(MODULE_IDS);
  });

  it('keeps the effect-graph templates it recognises, and repairs the rest', () => {
    const layout = normalizeLayout({
      fxTemplates: [
        {
          id: 'mine',
          name: 'Mine',
          params: { [Param.FX_CHAIN2]: 1, [Param.FX_REVERB_MODE]: 1, [Param.FX_NODE1_IN1_GAIN]: 50 },
        },
        { id: 'mine', name: 'duplicate', params: { [Param.FX_CHAIN1]: 1 } },
        { id: 'junk', name: 'junk', params: {} },
      ],
    });
    expect(layout.fxTemplates).toHaveLength(1);
    expect(layout.fxTemplates[0].id).toBe('mine');
    // The whitelist holds; the gain is clamped.
    expect(layout.fxTemplates[0].params[Param.FX_CHAIN2]).toBe(1);
    expect(layout.fxTemplates[0].params[Param.FX_NODE1_IN1_GAIN]).toBe(4);
    expect(Param.FX_REVERB_MODE in layout.fxTemplates[0].params).toBe(false);
    // A layout from before the templates existed simply has none.
    expect(normalizeLayout({}).fxTemplates).toEqual([]);
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
