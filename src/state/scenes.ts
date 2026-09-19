/**
 * Workspace scenes.
 *
 * A scene is the *workspace* half of the layout — module order, what is
 * collapsed, which view is open, where the signal-flow nodes sit — saved under a
 * name so different jobs ("performing", "sound design", "iPad") can be switched
 * in one tap.
 *
 * Preferences are deliberately excluded: a scene must not change the language,
 * the colour scheme, the haptics setting or the MIDI mappings, which belong to
 * the person rather than to the job.
 */

import type { LayoutState } from './layout';

/** The keys a scene captures (and restores). */
export const WORKSPACE_KEYS = [
  'order',
  'collapsed',
  'keyboardVisible',
  'view',
  'flowPos',
  'flowHidden',
  'displayExpanded',
  'autoCollapsed',
] as const;

export type WorkspaceKey = (typeof WORKSPACE_KEYS)[number];

export interface Scene {
  id: string;
  name: string;
  workspace: Pick<LayoutState, WorkspaceKey>;
}

export const SCENES_KEY = 'gs1:scenes:v1';

/** Copy just the workspace half of a layout, deeply enough to be independent. */
export function captureWorkspace(layout: LayoutState): Scene['workspace'] {
  return {
    order: [...layout.order],
    collapsed: { ...layout.collapsed },
    keyboardVisible: layout.keyboardVisible,
    view: layout.view,
    flowPos: Object.fromEntries(
      Object.entries(layout.flowPos).map(([id, pos]) => [id, [...pos] as [number, number]]),
    ),
    flowHidden: [...layout.flowHidden],
    displayExpanded: layout.displayExpanded,
    autoCollapsed: [...layout.autoCollapsed],
  };
}

export function makeScene(id: string, name: string, layout: LayoutState): Scene {
  return { id, name: name.trim() || 'Scene', workspace: captureWorkspace(layout) };
}

/** Merge a scene into a layout, leaving every preference untouched. */
export function applyScene(layout: LayoutState, scene: Scene): LayoutState {
  return { ...layout, ...captureWorkspace({ ...layout, ...scene.workspace }) };
}

/** Accept scenes from storage without trusting their shape. */
export function normalizeScenes(raw: unknown): Scene[] {
  if (!Array.isArray(raw)) return [];
  const out: Scene[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, workspace } = entry as Partial<Scene>;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    if (!workspace || typeof workspace !== 'object') continue;
    if (out.some((scene) => scene.id === id)) continue;
    out.push({ id, name, workspace: workspace as Scene['workspace'] });
  }
  return out;
}
