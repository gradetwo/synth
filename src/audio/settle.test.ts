import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleWithin } from './settle';

describe('settleWithin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns as soon as the promise settles', async () => {
    let settled = false;
    const done = settleWithin(Promise.resolve('ok'), 1000).then(() => {
      settled = true;
    });
    await vi.runAllTimersAsync();
    await done;
    expect(settled).toBe(true);
  });

  it('gives up on a promise that never settles', async () => {
    // `AudioContext.resume()` in Firefox: a promise that is simply never
    // answered. Startup must not wait for it.
    const pending = new Promise(() => {});
    let passed = false;
    const waiting = settleWithin(pending, 1500).then(() => {
      passed = true;
    });
    await vi.advanceTimersByTimeAsync(1400);
    expect(passed).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await waiting;
    expect(passed).toBe(true);
  });

  it('ignores a rejection', async () => {
    let passed = false;
    const waiting = settleWithin(Promise.reject(new Error('nope')), 1000).then(() => {
      passed = true;
    });
    await vi.runAllTimersAsync();
    await waiting;
    expect(passed).toBe(true);
  });
});
