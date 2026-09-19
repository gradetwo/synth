/**
 * Viewport classification.
 *
 * The device class is derived from the **short side** of the viewport, so an
 * iPhone in landscape is still a phone (844×390 → 390) while an iPad in any
 * orientation is a tablet. That drives which chrome is shown by default.
 */

import { useEffect, useState } from 'react';

export type Device = 'phone' | 'tablet' | 'desktop';

export interface Viewport {
  device: Device;
  portrait: boolean;
  touch: boolean;
  width: number;
  height: number;
}

function measure(): Viewport {
  if (typeof window === 'undefined') {
    return { device: 'desktop', portrait: false, touch: false, width: 1440, height: 900 };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const short = Math.min(width, height);
  const device: Device = short < 620 ? 'phone' : short < 900 ? 'tablet' : 'desktop';
  const touch =
    (window.matchMedia?.('(pointer: coarse)').matches ?? false) || (navigator.maxTouchPoints ?? 0) > 0;
  return { device, portrait: height >= width, touch, width, height };
}

let current: Viewport = measure();
const listeners = new Set<() => void>();

function refresh(): void {
  const next = measure();
  if (
    next.device === current.device &&
    next.portrait === current.portrait &&
    next.touch === current.touch &&
    next.width === current.width &&
    next.height === current.height
  ) {
    return;
  }
  current = next;
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
}

export function getViewport(): Viewport {
  return current;
}

export function useViewport(): Viewport {
  const [snapshot, setSnapshot] = useState(current);
  useEffect(() => {
    const update = () => setSnapshot(current);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return snapshot;
}
