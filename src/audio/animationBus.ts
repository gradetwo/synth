/**
 * Single animation-frame bus.
 *
 * Every canvas/indicator previously ran its own `requestAnimationFrame` loop
 * (7 concurrent loops). This multiplexes them onto one loop, and stops it when
 * the tab is hidden so background tabs do no work.
 */

type Frame = (now: number) => void;

const frames = new Set<Frame>();
let raf = 0;
let running = false;
let lastNow = 0;
let minInterval = 16;

function updateInterval() {
  if (typeof window === 'undefined') return;
  const isTouch =
    (window.matchMedia?.('(pointer: coarse)').matches ?? false) ||
    (navigator.maxTouchPoints ?? 0) > 0 ||
    Math.min(window.innerWidth, window.innerHeight) < 900;
  // 25ms on mobile/tablet (~40 FPS on 120Hz ProMotion screens, ~30 FPS on 60Hz),
  // 16ms on desktop (~60 FPS max, prevents 120Hz/144Hz monitors from overdrawing).
  minInterval = isTouch ? 25 : 16;
}

updateInterval();
if (typeof window !== 'undefined') {
  window.addEventListener('resize', updateInterval, { passive: true });
}

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (now - lastNow < minInterval) return;
  lastNow = now;
  for (const frame of frames) frame(now);
}

function start() {
  if (running || frames.size === 0) return;
  running = true;
  raf = requestAnimationFrame(loop);
}

function stop() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
}

/** Subscribe to the shared frame loop. Returns an unsubscribe function. */
export function subscribeFrame(frame: Frame): () => void {
  frames.add(frame);
  start();
  return () => {
    frames.delete(frame);
    if (frames.size === 0) stop();
  };
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
}
