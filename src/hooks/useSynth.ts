import { useSyncExternalStore } from 'react';
import { store } from '@/state/store';
import type { Snapshot } from '@/state/store';

/** Subscribe to the whole synth store. */
export function useSynth(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
