/**
 * Wait for a promise, but never forever.
 *
 * `AudioContext.resume()` is the reason this exists: Firefox leaves the promise
 * pending when the context was created outside a user gesture, and iOS can do
 * the same while another app owns the audio session. A promise that never
 * settles is the worst failure mode for a start button — the page sits on
 * "starting…" with no error and no way forward — so startup waits a bounded
 * time and then carries on with whatever state the context is in.
 */
export function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}
