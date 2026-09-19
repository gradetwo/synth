/**
 * Small UI-only overlay switches.
 *
 * The editor can be opened from the FX module, from the signal-flow view and
 * from the graph itself, all deep in the tree, so the open flag lives here
 * rather than being threaded through every intermediate component as a prop.
 * It is deliberately not persisted: where an editor was open is not part of a
 * patch or of the workspace.
 */
import { useSyncExternalStore } from 'react';

function switchboard(initial = false) {
  let value = initial;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  return {
    get: () => value,
    set: (next: boolean) => {
      if (value === next) return;
      value = next;
      emit();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const fxGraphOpen = switchboard(false);

export function useFxGraphOpen(): boolean {
  return useSyncExternalStore(fxGraphOpen.subscribe, fxGraphOpen.get, fxGraphOpen.get);
}
