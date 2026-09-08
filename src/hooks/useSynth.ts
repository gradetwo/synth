import { useSyncExternalStore } from 'react';
import { store, type Snapshot } from '@/state/store';
import type { ParamId } from '@/audio/params';
import type { LayoutState, ModuleId } from '@/state/layout';
import type { ModRoute } from '@/audio/params';
import type { Preset } from '@/state/presets';

/**
 * Selector hooks.
 *
 * `useSyncExternalStore` re-renders a component whenever `subscribe` fires, but
 * bails out when the selected value is `Object.is`-equal to the previous one.
 * Selecting a scalar (or a reference that only changes when that slice changes)
 * therefore keeps a knob drag from re-rendering the whole synth.
 */
const subscribe = store.subscribe;

/** Full snapshot — use sparingly; prefer the selector hooks below. */
export function useSynth(): Snapshot {
  return useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
}

/** One DSP parameter. */
export function useParam(id: ParamId): number {
  return useSyncExternalStore(
    subscribe,
    () => store.getParam(id),
    () => store.getParam(id),
  );
}

/** The whole layout object (changes only on layout mutations). */
export function useLayout(): LayoutState {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().layout,
    () => store.getSnapshot().layout,
  );
}

/** Whether one module is collapsed. */
export function useCollapsed(id: ModuleId): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(store.getSnapshot().layout.collapsed[id]),
    () => Boolean(store.getSnapshot().layout.collapsed[id]),
  );
}

export function useLang(): 'zh' | 'en' {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().layout.lang,
    () => store.getSnapshot().layout.lang,
  );
}

export function useTheme(): 'dark' | 'contrast' {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().layout.theme,
    () => store.getSnapshot().layout.theme,
  );
}

export function useKeyboardVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().layout.keyboardVisible,
    () => store.getSnapshot().layout.keyboardVisible,
  );
}

export function useVelocityMode(): 'fixed' | 'touch' {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().layout.velocityMode,
    () => store.getSnapshot().layout.velocityMode,
  );
}

export function useHaptics(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().layout.haptics,
    () => store.getSnapshot().layout.haptics,
  );
}

export function usePower(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().state.power,
    () => store.getSnapshot().state.power,
  );
}

export function usePresetId(): string {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().currentPresetId,
    () => store.getSnapshot().currentPresetId,
  );
}

export function useUserPresets(): Preset[] {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().userPresets,
    () => store.getSnapshot().userPresets,
  );
}

export function useCanUndo(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().canUndo,
    () => store.getSnapshot().canUndo,
  );
}

export function useCanRedo(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().canRedo,
    () => store.getSnapshot().canRedo,
  );
}

export function useActiveSlot(): 'a' | 'b' {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().activeSlot,
    () => store.getSnapshot().activeSlot,
  );
}

export function useSlotFilled(slot: 'a' | 'b'): boolean {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().slotFilled[slot],
    () => store.getSnapshot().slotFilled[slot],
  );
}

/** Modulation routes (stable reference unless routes change). */
export function useRoutes(): ModRoute[] {
  return useSyncExternalStore(
    subscribe,
    () => store.getSnapshot().state.routes,
    () => store.getSnapshot().state.routes,
  );
}
