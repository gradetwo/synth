import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The update flow, without a browser.
 *
 * Offline-first means a returning tab can keep running an old build for a long
 * time — which is exactly how a fixed bug appears to survive a deployment — so
 * the three promises this module makes are worth pinning down: a waiting worker
 * raises the banner, applying the update activates it and reloads *once*, and
 * the stale-build recovery clears the caches and only ever redirects once per
 * session.
 */

type Listener = (event: Event) => void;

interface FakeRegistration {
  waiting: { state: string; postMessage: (message: unknown, transfer?: unknown[]) => void } | null;
  update: () => Promise<void>;
  addEventListener: (type: string, fn: Listener) => void;
  unregister: () => Promise<boolean>;
}

function setup(options: {
  prod?: boolean;
  waitingState?: string | null;
  updateMovesToWaiting?: string | null;
  /** What the fake waiting worker answers the version handshake with; null = silent. */
  answerVersion?: string | null;
}) {
  const posted: unknown[] = [];
  const controllerListeners: Listener[] = [];
  const makeWaiting = (state: string) => ({
    state,
    postMessage: (message: unknown, transfer?: unknown[]) => {
      posted.push(message);
      const port = transfer?.[0] as { postMessage?: (value: unknown) => void } | undefined;
      if ((message as { type?: string } | null)?.type === 'GET_VERSION' && options.answerVersion && port?.postMessage) {
        port.postMessage({ type: 'VERSION', version: options.answerVersion });
      }
    },
  });
  const registration: FakeRegistration = {
    waiting: options.waitingState == null ? null : makeWaiting(options.waitingState),
    update: vi.fn(async () => {
      if (options.updateMovesToWaiting != null) {
        registration.waiting = makeWaiting(options.updateMovesToWaiting);
      }
    }),
    addEventListener: vi.fn(),
    unregister: vi.fn(async () => true),
  };
  const serviceWorker = {
    getRegistration: vi.fn(async () => registration),
    register: vi.fn(async () => registration),
    addEventListener: vi.fn((type: string, fn: Listener) => {
      if (type === 'controllerchange') controllerListeners.push(fn);
    }),
    controller: {} as unknown,
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });

  const reloads: string[] = [];
  const replaced: string[] = [];
  Object.defineProperty(window, 'location', {
    value: {
      href: 'https://example.test/',
      reload: () => reloads.push('reload'),
      replace: (url: string) => replaced.push(url),
    },
    configurable: true,
    writable: true,
  });

  const cacheKeys: string[] = [];
  const deleted: string[] = [];
  Object.defineProperty(globalThis, 'caches', {
    value: {
      keys: async () => ['gs1-old', 'gs1-older'],
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
    },
    configurable: true,
  });

  window.sessionStorage.clear();
  if (options.prod) vi.stubEnv('PROD', true);

  return { registration, serviceWorker, posted, controllerListeners, reloads, replaced, cacheKeys, deleted };
}

async function load() {
  vi.resetModules();
  return import('./register');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('service worker updates', () => {
  it('announces a waiting worker and applies it exactly once', async () => {
    const env = setup({ prod: true, waitingState: 'installed' });
    const { onUpdateAvailable, applyUpdate, registerServiceWorker } = await load();
    // The worker is already waiting by the time the UI mounts (a tab that was
    // open when the deployment landed), which is the path `register` replays.
    await registerServiceWorker();

    const seen: unknown[] = [];
    onUpdateAvailable((registration) => seen.push(registration));
    expect(seen).toHaveLength(1);

    applyUpdate();
    expect(env.posted).toEqual([{ type: 'SKIP_WAITING' }]);

    // The worker takes over, the page reloads once — a second controllerchange
    // (some browsers fire it again) must not reload a second time.
    env.controllerListeners.forEach((fn) => fn(new Event('controllerchange')));
    env.controllerListeners.forEach((fn) => fn(new Event('controllerchange')));
    expect(env.reloads).toEqual(['reload']);
  });

  it('asks the waiting worker for its version, and never guesses from the page', async () => {
    const answered = setup({ prod: true, waitingState: 'installed', answerVersion: '9.9.9' });
    const withAnswer = await load();
    await withAnswer.registerServiceWorker();
    await expect(withAnswer.waitingVersion()).resolves.toBe('9.9.9');
    expect(answered.posted).toContainEqual({ type: 'GET_VERSION' });

    // A worker that never answers — an older build with no handler, or a lost
    // message — is "no version", never the running bundle's own version.
    setup({ prod: true, waitingState: 'installed' });
    const silent = await load();
    await silent.registerServiceWorker();
    await expect(silent.waitingVersion()).resolves.toBeNull();

    // Nothing waiting: there is no one to ask.
    const idle = await load();
    await expect(idle.waitingVersion()).resolves.toBeNull();
  });

  it('finds a fresh build and reports it, or reports that nothing changed', async () => {
    const env = setup({ prod: true, updateMovesToWaiting: 'installed' });
    const { checkForUpdate } = await load();

    await expect(checkForUpdate()).resolves.toBe('updated');
    expect(env.registration.update).toHaveBeenCalled();

    const quiet = setup({ prod: true });
    const second = await load();
    env.registration.waiting = null;
    await expect(second.checkForUpdate()).resolves.toBe('current');
    expect(quiet).toBeTruthy();
  });

  it('is a no-op outside a production build or without service workers', async () => {
    setup({ prod: false, waitingState: 'installed' });
    const dev = await load();
    await expect(dev.checkForUpdate()).resolves.toBe('unsupported');

    const env = setup({ prod: true, waitingState: 'installed' });
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    const none = await load();
    await expect(none.checkForUpdate()).resolves.toBe('unsupported');
    expect(env.reloads).toEqual([]);
  });

  it('recovers from a stale build once per session', async () => {
    const env = setup({ prod: true });
    const { recoverFromStaleBuild } = await load();

    await expect(recoverFromStaleBuild()).resolves.toBe(true);
    expect(env.deleted).toEqual(['gs1-old', 'gs1-older']);
    expect(env.replaced).toHaveLength(1);
    expect(env.replaced[0]).toMatch(/[?&]fresh=\d+/);

    // A genuinely offline browser must not end up in a reload loop.
    await expect(recoverFromStaleBuild()).resolves.toBe(false);
    expect(env.replaced).toHaveLength(1);
  });
});
