/**
 * Layout model: module order, collapsed state and keyboard visibility.
 *
 * Kept separate from the patch (`SynthState`) so loading a preset never moves
 * the user's panels around. Persisted independently under `gs1:layout:v1`.
 */

import type { ParamId } from '@/audio/params';
import { Param } from '@/audio/params';

export type ModuleId = 'osc1' | 'osc2' | 'filter' | 'env' | 'lfo' | 'matrix' | 'fx';

export const MODULE_IDS: ModuleId[] = ['osc1', 'osc2', 'filter', 'env', 'lfo', 'matrix', 'fx'];

export interface ModuleMeta {
  title: string;
  sub: string;
  color: string;
  ledId?: ParamId;
  /** Grid columns to span on wide layouts. */
  span: 1 | 2;
}

export const MODULE_META: Record<ModuleId, ModuleMeta> = {
  osc1: { title: 'OSC 1', sub: '振荡器 A', color: 'var(--osc1)', ledId: Param.OSC1_ON, span: 1 },
  osc2: { title: 'OSC 2', sub: '振荡器 B', color: 'var(--osc2)', ledId: Param.OSC2_ON, span: 1 },
  filter: { title: 'FILTER', sub: '滤波器', color: 'var(--filter)', span: 1 },
  env: { title: 'AMP ENV', sub: '振幅包络', color: 'var(--env)', span: 1 },
  lfo: { title: 'LFO', sub: '低频振荡', color: 'var(--lfo)', ledId: Param.LFO_ON, span: 1 },
  matrix: { title: 'MOD MATRIX', sub: '调制路由', color: 'var(--matrix)', span: 1 },
  fx: { title: 'FX', sub: '效果处理', color: 'var(--fx)', span: 2 },
};

export interface LayoutState {
  order: ModuleId[];
  collapsed: Partial<Record<ModuleId, boolean>>;
  keyboardVisible: boolean;
}

export function defaultLayout(): LayoutState {
  return {
    order: [...MODULE_IDS],
    collapsed: {},
    keyboardVisible: true,
  };
}

/** Repair persisted layout data (unknown/duplicate ids, missing modules). */
export function normalizeLayout(raw: unknown): LayoutState {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Partial<LayoutState>;
  const seen = new Set<ModuleId>();
  const order: ModuleId[] = [];
  if (Array.isArray(input.order)) {
    for (const id of input.order) {
      if (typeof id === 'string' && (MODULE_IDS as string[]).includes(id) && !seen.has(id as ModuleId)) {
        seen.add(id as ModuleId);
        order.push(id as ModuleId);
      }
    }
  }
  for (const id of MODULE_IDS) if (!seen.has(id)) order.push(id);

  const collapsed: Partial<Record<ModuleId, boolean>> = {};
  if (input.collapsed && typeof input.collapsed === 'object') {
    for (const id of MODULE_IDS) {
      if ((input.collapsed as Record<string, unknown>)[id] === true) collapsed[id] = true;
    }
  }

  return {
    order,
    collapsed,
    keyboardVisible: input.keyboardVisible !== false,
  };
}

/** Move `id` so that it sits at `index` in the order (clamped). */
export function moveModule(order: ModuleId[], id: ModuleId, index: number): ModuleId[] {
  const from = order.indexOf(id);
  if (from === -1) return order;
  const rest = order.filter((m) => m !== id);
  const to = Math.max(0, Math.min(rest.length, index));
  rest.splice(to, 0, id);
  if (rest.every((m, i) => m === order[i])) return order;
  return rest;
}
