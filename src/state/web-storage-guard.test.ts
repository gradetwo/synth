import { describe, expect, it } from 'vitest';
import { ensureWebStorage } from '../../vitest.setup';

/**
 * The guard itself, exercised without depending on which Node is running: only
 * Node 26 shadows web storage (and only without `--localstorage-file`), so a unit
 * test is the only way to pin both arms on a Node 22 host.
 */
describe('web storage guard', () => {
  it('installs a working storage when the global is missing (Node 26)', () => {
    const target = {} as typeof globalThis;
    ensureWebStorage(target, null);
    target.localStorage.setItem('a', 'b');
    expect(target.localStorage.getItem('a')).toBe('b');
    expect(target.localStorage.length).toBe(1);
    expect(target.localStorage.key(0)).toBe('a');
    target.localStorage.removeItem('a');
    expect(target.localStorage.getItem('a')).toBeNull();
    target.localStorage.setItem('c', 'd');
    target.localStorage.clear();
    expect(target.localStorage.length).toBe(0);
    // Separate stores, like the two real ones.
    expect(target.sessionStorage).not.toBe(target.localStorage);
  });

  it('keeps a usable storage (the environment-provided one)', () => {
    const mine = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mine.get(k) ?? null,
      setItem: (k: string, v: string) => void mine.set(k, v),
    } as unknown as Storage;
    const target = { localStorage: storage, sessionStorage: undefined } as unknown as typeof globalThis;
    ensureWebStorage(target, null);
    expect(target.localStorage).toBe(storage);
    // …and only the broken one is replaced.
    expect(typeof target.sessionStorage.setItem).toBe('function');
  });

  it('prefers the window copy when the environment has one', () => {
    const fromWindow = { getItem: () => 'w', setItem: () => {} } as unknown as Storage;
    const target = {} as typeof globalThis;
    ensureWebStorage(target, { localStorage: fromWindow } as unknown as Window & typeof globalThis);
    expect(target.localStorage).toBe(fromWindow);
  });
});
