import { describe, expect, it } from 'vitest';
import { defaultLayout } from './layout';
import { applyScene, captureWorkspace, makeScene, normalizeScenes } from './scenes';

describe('workspace scenes', () => {
  it('captures the workspace and nothing personal', () => {
    const layout = { ...defaultLayout(), view: 'flow' as const, lang: 'en' as const, theme: 'light' as const };
    const workspace = captureWorkspace(layout);
    expect(Object.keys(workspace).sort()).toEqual(
      ['autoCollapsed', 'collapsed', 'displayExpanded', 'flowHidden', 'flowPos', 'keyboardVisible', 'order', 'view'].sort(),
    );
    // Preferences are not part of a scene.
    expect('lang' in workspace).toBe(false);
    expect('theme' in workspace).toBe(false);
    expect('ccMap' in workspace).toBe(false);
  });

  it('recalls the workspace without touching preferences', () => {
    const base = { ...defaultLayout(), lang: 'en' as const, theme: 'light' as const, haptics: false };
    const scene = makeScene('a', 'design', { ...base, view: 'flow', collapsed: { filter: true } });
    const recalled = applyScene({ ...base, view: 'modules', collapsed: {} }, scene);

    expect(recalled.view).toBe('flow');
    expect(recalled.collapsed.filter).toBe(true);
    // The person's own settings survive the recall.
    expect(recalled.lang).toBe('en');
    expect(recalled.theme).toBe('light');
    expect(recalled.haptics).toBe(false);
  });

  it('keeps a scene independent of the layout it came from', () => {
    const layout = defaultLayout();
    const scene = makeScene('a', 's', layout);
    layout.collapsed.filter = true;
    layout.flowPos.foo = [10, 20];
    expect(scene.workspace.collapsed.filter).toBeUndefined();
    expect(scene.workspace.flowPos.foo).toBeUndefined();
  });

  it('rejects junk from storage', () => {
    expect(normalizeScenes(null)).toEqual([]);
    expect(normalizeScenes([{ id: 1 }, { name: 'x' }, 'nope'])).toEqual([]);
    const good = makeScene('a', 's', defaultLayout());
    expect(normalizeScenes([good, good])).toHaveLength(1);
    expect(normalizeScenes([{ id: 'b', name: '  ', workspace: {} }])[0].name).toBe('  ');
  });
});
