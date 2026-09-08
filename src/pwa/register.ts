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
