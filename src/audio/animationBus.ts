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

function loop(now: number) {
  raf = requestAnimationFrame(loop);
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
