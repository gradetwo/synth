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

/**
 * Ask the browser for a fresh build right now.
 *
 * Returns what happened so the UI can say something useful: an offline-first
 * app can otherwise keep running a cached build for a long time, which is
 * exactly how a fixed bug appears to survive an update.
 */
export async function checkForUpdate(): Promise<'updated' | 'current' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return 'unsupported';
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
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
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
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
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
