/**
 * Input-modality detection.
 *
 * The UI offers different gestures and hints for a finger vs a mouse. The
 * initial guess comes from `pointer: coarse`, then the actual `pointerType` of
 * every pointerdown refines it — so a touchscreen laptop switches models as
 * soon as you use one device or the other.
 */

import { useEffect, useState } from 'react';

export type InputMode = 'touch' | 'mouse';

export function detectInputMode(): InputMode {
  if (typeof window === 'undefined') return 'mouse';
  // `pointer: coarse` is the primary signal, but some environments (and
  // emulators) only expose touch capability through maxTouchPoints.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || (navigator.maxTouchPoints ?? 0) > 0 ? 'touch' : 'mouse';
}

let current: InputMode = detectInputMode();
const listeners = new Set<() => void>();

export function getInputMode(): InputMode {
  return current;
}

export function setInputMode(mode: InputMode): void {
  if (mode === current) return;
  current = mode;
  for (const listener of listeners) listener();
}

export function useInputMode(): InputMode {
  const [mode, setMode] = useState(current);
  useEffect(() => {
    const update = () => setMode(current);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return mode;
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => setInputMode(event.pointerType === 'touch' ? 'touch' : 'mouse'),
    { capture: true, passive: true },
  );
  const query = window.matchMedia?.('(pointer: coarse)');
  query?.addEventListener?.('change', () => setInputMode(detectInputMode()));
}

/** Short haptic tick on devices that support it (no-op on iOS). */
export function haptic(ms = 6): void {
  if (current !== 'touch') return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
