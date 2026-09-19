/**
 * Service-worker registration + update flow.
 *
 * The app is offline-first: the generated `sw.js` precaches every hashed asset
 * (JS/CSS, the WASM core, the worklet, fonts, icons). When a new build is
 * deployed the worker installs in the background; we surface a banner and only
 * activate the new version when the user taps "立即更新", so a running audio
 * session is never interrupted mid-play.
 */

type UpdateListener = (registration: ServiceWorkerRegistration) => void;

let updateListener: UpdateListener | null = null;
let pending: ServiceWorkerRegistration | null = null;
let reloading = false;

export function onUpdateAvailable(fn: UpdateListener) {
  updateListener = fn;
  if (pending) fn(pending);
}

/** Tell the waiting worker to activate, then reload once it takes control. */
export function applyUpdate() {
  const waiting = pending?.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** How long the banner waits for the waiting worker to name itself. */
const VERSION_TIMEOUT_MS = 1500;

/**
 * The version of the build the waiting worker will install.
 *
 * `registration.waiting.scriptURL` is always the same `sw.js`, so the only
 * source for this is the worker itself: `scripts/gen-sw.mjs` bakes the
 * `package.json` version into the generated file, which answers `GET_VERSION`
 * over the `MessageChannel` port transferred with the message. The *running*
 * bundle's `CHANGELOG_HEAD` must not be used instead — after a rollback it names
 * the version being rolled back, while the button installs the rollback target.
 *
 * Any failure or timeout resolves to `null`, and the banner then shows no
 * version at all rather than a wrong one.
 */
export function waitingVersion(): Promise<string | null> {
  const worker = pending?.waiting;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    // Both paths can fire; whichever does first cancels the other (a settled
    // promise would ignore the second resolve anyway, this just stops the work).
    const finish = (value: string | null) => {
      clearTimeout(timer);
      channel.port1.onmessage = null;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), VERSION_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; version?: unknown } | null;
      finish(data?.type === 'VERSION' && typeof data.version === 'string' ? data.version : null);
    };
    try {
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/**
 * Ask the browser for a fresh build right now.
 *
 * Returns what happened so the UI can say something useful: an offline-first
 * app can otherwise keep running a cached build for a long time, which is
 * exactly how a fixed bug appears to survive an update.
 */
export async function checkForUpdate(): Promise<'updated' | 'current' | 'unsupported'> {
  // `navigator.serviceWorker` exists but is undefined on an insecure origin
  // (plain http:// that is not localhost), which is why this checks the value
  // rather than the property: the property version threw a TypeError here
  // instead of saying "this browser cannot do it".
  if (!navigator.serviceWorker || !import.meta.env.PROD) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'unsupported';
  const before = registration.waiting?.state ?? null;
  await registration.update().catch(() => undefined);
  // The browser needs a moment to move a new worker into `waiting`.
  for (let i = 0; i < 10; i++) {
    if (registration.waiting?.state !== before && registration.waiting) {
      pending = registration;
      updateListener?.(registration);
      return 'updated';
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return 'current';
}

/**
 * Recover from a build that cannot boot.
 *
 * Seen in the wild: a service worker (or a CDN) serves an old `index.html`
 * whose asset hashes the current deployment no longer has, so the worklet and
 * the WASM core 404 and the synth starts silently. Nothing in the app can fix
 * that by itself, but it can clear the caches that are lying to it and reload
 * once. Guarded with session storage so a genuinely offline browser does not
 * reload in a loop.
 */
export async function recoverFromStaleBuild(): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.serviceWorker) return false;
  const KEY = 'gs1:recovered';
  try {
    if (window.sessionStorage.getItem(KEY) === '1') return false;
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* best effort: the reload below is what matters */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('fresh', String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

export async function registerServiceWorker() {
  if (!navigator.serviceWorker || !import.meta.env.PROD) return;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const registration = await navigator.serviceWorker.register(`${base}sw.js`, {
      scope: base,
    });

    const announce = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) {
        pending = reg;
        updateListener?.(reg);
      }
    };

    announce(registration);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          announce(registration);
        }
      });
    });

    // Check for a new deployment when the tab becomes visible again, and
    // periodically for long-lived sessions.
    const check = () => registration.update().catch(() => undefined);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.setInterval(check, 30 * 60 * 1000);
    return registration;
  } catch {
    // Offline-first is an enhancement; the synth works without the worker.
    return undefined;
  }
}
