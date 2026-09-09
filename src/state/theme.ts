/**
 * Resolved colour scheme for canvas painters.
 *
 * Canvas cannot read CSS custom properties, so the app writes the effective
 * scheme here whenever it changes; draw loops read the cached value instead of
 * calling getComputedStyle every frame.
 */

import { useSyncExternalStore } from 'react';

export type ResolvedTheme = 'dark' | 'light';

let resolved: ResolvedTheme = 'dark';
const listeners = new Set<() => void>();

export function resolvedTheme(): ResolvedTheme {
  return resolved;
}

export function setResolvedTheme(next: ResolvedTheme): void {
  if (next === resolved) return;
  resolved = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook for components that paint colours outside CSS. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, resolvedTheme, resolvedTheme);
}

/** Canvas-safe colours for the current scheme. */
export function canvasInk(): {
  grid: string;
  canvasFade: string;
  text: string;
  spectrumBg: string;
  accent: string;
  accentFade: string;
  peak: string;
  off: string;
} {
  return resolved === 'light'
    ? {
        grid: 'rgba(20,28,48,.16)',
        canvasFade: 'rgba(20,28,48,.06)',
        text: 'rgba(22,26,36,.75)',
        spectrumBg: 'rgba(232,236,244,.6)',
        accent: '#d9820a',
        accentFade: 'rgba(217,130,10,.22)',
        peak: 'rgba(22,26,36,.5)',
        off: '#c9cfdc',
      }
    : {
        grid: 'rgba(255,255,255,.1)',
        canvasFade: 'rgba(255,255,255,.04)',
        text: 'rgba(232,236,244,.7)',
        spectrumBg: 'rgba(11,13,18,.5)',
        accent: '#ffb340',
        accentFade: 'rgba(255,179,64,.18)',
        peak: 'rgba(255,255,255,.6)',
        off: '#333a48',
      };
}
