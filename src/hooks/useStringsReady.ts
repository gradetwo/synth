import { useSyncExternalStore } from 'react';
import { hasCopy, subscribeStrings } from '@/i18n';

/**
 * Render-gate for a row whose copy lives in a lazy i18n module (P11.2).
 *
 * `t()` is synchronous by design (toasts, aria labels and canvas code cannot
 * await) and an unregistered key falls back to its key name. The first-screen
 * core is always registered, so nothing on the first paint can hit that. The
 * imported-source rows are the one exception: they live in the eager module
 * grid, but their copy does not, so they can render before
 * `loadSourcesStrings()` has resolved.
 *
 * Holding them back for that microtask is the honest option — an empty row for
 * a frame, then the real labels — rather than rendering `wt.none` and
 * correcting itself. `main.tsx` starts the load at boot and `App` preloads at
 * idle, so in practice the keys are already there when a row is chosen. The
 * subscription is to the registry itself, so there is no polling.
 */
export function useStringsReady(keys: readonly string[]): boolean {
  return useSyncExternalStore(
    subscribeStrings,
    () => keys.every((key) => hasCopy(key)),
    () => true,
  );
}
