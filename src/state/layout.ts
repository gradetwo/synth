/**
 * Layout model: module order, collapsed state and keyboard visibility.
 *
 * Kept separate from the patch (`SynthState`) so loading a preset never moves
 * the user's panels around. Persisted independently under `gs1:layout:v1`.
 */

import type { ParamId } from '@/audio/params';
import type { Lang } from '@/i18n';
import { Param } from '@/audio/params';
import { normalizeBindings, type CcBinding } from '@/audio/ccmap';
import { normalizeScale } from '@/audio/scala';

export type ModuleId = 'osc1' | 'osc2' | 'filter' | 'env' | 'lfo' | 'matrix' | 'fx' | 'fx2';

export const MODULE_IDS: ModuleId[] = ['osc1', 'osc2', 'filter', 'env', 'lfo', 'matrix', 'fx', 'fx2'];

export interface ModuleMeta {
  title: string;
  sub: string;
  color: string;
  ledId?: ParamId;
  /** Grid columns to span on wide layouts. */
  span: 1 | 2;
}

export const MODULE_META: Record<ModuleId, ModuleMeta> = {
  osc1: { title: 'OSC 1', sub: 'module.osc1.sub', color: 'var(--osc1)', ledId: Param.OSC1_ON, span: 1 },
  osc2: { title: 'OSC 2', sub: 'module.osc2.sub', color: 'var(--osc2)', ledId: Param.OSC2_ON, span: 1 },
  filter: { title: 'FILTER', sub: 'module.filter.sub', color: 'var(--filter)', span: 1 },
  env: { title: 'AMP ENV', sub: 'module.env.sub', color: 'var(--env)', span: 1 },
  lfo: { title: 'LFO', sub: 'module.lfo.sub', color: 'var(--lfo)', ledId: Param.LFO_ON, span: 1 },
  matrix: { title: 'MOD MATRIX', sub: 'module.matrix.sub', color: 'var(--matrix)', span: 1 },
  fx: { title: 'FX', sub: 'module.fx.sub', color: 'var(--fx)', span: 2 },
  fx2: { title: 'FX 2', sub: 'module.fx2.sub', color: 'var(--fx)', span: 2 },
};

/** Colour scheme. `auto` follows the operating system preference live. */
export type Theme = 'dark' | 'light' | 'auto';

/**
 * How a touch on a key maps to note velocity.
 * - `fixed`  → every tap is 0.9 (predictable, like a step sequencer).
 * - `touch`  → vertical position on the key: lower = louder (0.35..1).
 */
export type VelocityMode = 'fixed' | 'touch';

/** Top-level workspace: the classic module grid or the signal-flow canvas. */
export type ViewMode = 'modules' | 'flow';

export interface LayoutState {
  order: ModuleId[];
  collapsed: Partial<Record<ModuleId, boolean>>;
  keyboardVisible: boolean;
  theme: Theme;
  /** High-contrast overlay, independent of the colour scheme. */
  contrast: boolean;
  lang: Lang;
  velocityMode: VelocityMode;
  haptics: boolean;
  view: ViewMode;
  /** Signal-flow node positions in canvas pixels. */
  flowPos: Record<string, [number, number]>;
  /** Nodes removed from the signal-flow canvas. */
  flowHidden: string[];
  /** `null` = automatic (collapsed on phones/tablets, expanded on desktop). */
  displayExpanded: boolean | null;
  /** Whether the phone first-run defaults (collapsed modules, compact row) were applied. */
  phoneDefaults: boolean;
  /** Modules collapsed automatically by the phone defaults, not by the user. */
  autoCollapsed: ModuleId[];
  /** User-pinned polyphony ceiling; 0 = let the load monitor decide. */
  polyphony: number;
  /** Microtuning temperament id (see `audio/tuning`). */
  temperament: string;
  /** MIDI CC → parameter bindings (see `audio/ccmap`). */
  ccMap: CcBinding[];
  /** Imported Scala scale, when the temperament is set to `custom`. */
  customTuning: { name: string; degrees: number[]; period: number } | null;
}

export function defaultLayout(): LayoutState {
  return {
    order: [...MODULE_IDS],
    collapsed: {},
    keyboardVisible: true,
    // Fresh installs follow the operating system; the user can pin either mode.
    theme: 'auto',
    contrast: false,
    lang: 'zh',
    velocityMode: 'fixed',
    haptics: true,
    view: 'modules',
    flowPos: {},
    flowHidden: [],
    displayExpanded: null,
    phoneDefaults: false,
    autoCollapsed: [],
    polyphony: 0,
    temperament: 'equal',
    ccMap: [],
    customTuning: null,
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

  const flowPos: Record<string, [number, number]> = {};
  if (input.flowPos && typeof input.flowPos === 'object') {
    for (const [id, pos] of Object.entries(input.flowPos as Record<string, unknown>)) {
      if (Array.isArray(pos) && pos.length === 2 && pos.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        flowPos[id] = [pos[0], pos[1]];
      }
    }
  }
  const flowHidden = Array.isArray(input.flowHidden)
    ? input.flowHidden.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    order,
    collapsed,
    keyboardVisible: input.keyboardVisible !== false,
    // Older saves used `theme: 'contrast'`; migrate it to dark + contrast.
    theme:
      input.theme === 'light'
        ? 'light'
        : input.theme === 'dark' || (input.theme as string) === 'contrast'
          ? 'dark'
          : 'auto',
    // `contrast` was a theme value in older saves.
    contrast: input.contrast === true || (input.theme as string) === 'contrast',
    lang: input.lang === 'en' ? 'en' : 'zh',
    velocityMode: input.velocityMode === 'touch' ? 'touch' : 'fixed',
    haptics: input.haptics !== false,
    view: input.view === 'flow' ? 'flow' : 'modules',
    flowPos,
    flowHidden,
    displayExpanded:
      typeof input.displayExpanded === 'boolean' ? input.displayExpanded : null,
    phoneDefaults: input.phoneDefaults === true,
    temperament: typeof input.temperament === 'string' ? input.temperament : 'equal',
    ccMap: normalizeBindings(input.ccMap),
    customTuning: normalizeScale(input.customTuning),
    polyphony: [0, 4, 8, 16, 32].includes(input.polyphony as number)
      ? (input.polyphony as number)
      : 0,
    autoCollapsed: Array.isArray(input.autoCollapsed)
      ? input.autoCollapsed.filter(
          (id, index, list): id is ModuleId =>
            typeof id === 'string' &&
            (MODULE_IDS as string[]).includes(id) &&
            list.indexOf(id) === index,
        )
      : [],
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
