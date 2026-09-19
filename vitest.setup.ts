/**
 * Make `localStorage` / `sessionStorage` usable on every Node the suite runs on.
 *
 * Node 26 ships experimental WebStorage globals that are **undefined** unless the
 * process was started with `--localstorage-file`. Because they occupy the global
 * keys before the jsdom environment populates them, the environment's own storage
 * never lands: on such a host the fifteen `src/state/store.test.ts` cases that read
 * or clear storage fail with `Cannot read properties of undefined (reading
 * 'getItem')` (measured on macOS, Node v26.8.2, 2026-09-16), and `verify` stops at
 * `npm run test` without reaching any gate behind it. Deleting the shadow does not
 * help -- in this environment `window` is an alias of `globalThis`, so there is
 * nothing underneath to reveal (both measured here with a Node-26 simulator).
 *
 * So when the global is missing or unusable, install the Storage API the tests and
 * `src/state/persist.ts` actually use. jsdom's storage is the same interface; this
 * is a stand-in for a host that would otherwise have none, not a second behaviour.
 *
 * Reproduce the Node 26 condition on an older Node with:
 *   NODE_OPTIONS="--require ./.tmp/simulate-node26.cjs" npx vitest run src/state/store.test.ts
 * (the simulator defines both globals as `undefined`, which is all Node 26 does
 * when no storage file was named).
 */
class MemoryStorage implements Storage {
  readonly #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }

  getItem(key: string): string | null {
    return this.#map.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#map.set(String(key), String(value));
  }
}

/** True when `value` looks like the Storage API the app uses. */
function usable(value: unknown): value is Storage {
  return !!value && typeof (value as Storage).getItem === 'function' && typeof (value as Storage).setItem === 'function';
}

export function ensureWebStorage(
  target: typeof globalThis = globalThis,
  win: (Window & typeof globalThis) | null | undefined = (globalThis as { window?: Window & typeof globalThis }).window,
): void {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (usable(target[name])) continue;
    const fromWindow = win?.[name];
    const value = usable(fromWindow) ? fromWindow : new MemoryStorage();
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  }
}

ensureWebStorage();
