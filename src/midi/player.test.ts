import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiPlayer } from './player';
import type { MidiSong } from './smf';

/**
 * The transport's A/B looping is timing logic, so it is tested against a fake
 * clock: `requestAnimationFrame` is captured and driven by hand, which makes
 * the assertions exact instead of flaky.
 */

const song: MidiSong = {
  name: 'test',
  bpm: 120,
  duration: 4,
  notes: [
    { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
    { note: 62, velocity: 0.8, start: 1, duration: 0.5 },
    { note: 64, velocity: 0.8, start: 2, duration: 0.5 },
    { note: 65, velocity: 0.8, start: 3, duration: 0.5 },
  ],
};

let rafCallback: FrameRequestCallback | null = null;
let now = 0;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafCallback = null;
  });
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Advance the fake clock and run the pending frame. */
function advance(ms: number) {
  now += ms;
  const cb = rafCallback;
  rafCallback = null;
  cb?.(now);
}

describe('midi player transport', () => {
  it('starts with no A/B region and one that can be built up point by point', () => {
    const player = new MidiPlayer();
    player.load(song);
    expect(player.getState().loopStart).toBeNull();

    player.setLoopRegion(1, null);
    expect(player.getState().loopStart).toBe(1);
    expect(player.getState().loopEnd).toBeNull();
    expect(player.getState().loop).toBe(false);

    player.setLoopRegion(null, 2);
    expect(player.getState().loopEnd).toBe(2);
    // Both ends now exist, so looping switches itself on.
    expect(player.getState().loop).toBe(true);

    player.setLoopRegion(null, null);
    expect(player.getState().loopStart).toBeNull();
    expect(player.getState().loopEnd).toBeNull();
  });

  it('wraps playback inside the region instead of running past it', () => {
    const player = new MidiPlayer();
    player.load(song);
    player.setLoopRegion(1, 2);
    player.play();

    advance(0);
    expect(player.getState().time).toBeCloseTo(0, 3);
    advance(2500);
    // 2.5 s of wall clock inside a 1 s region: it must have wrapped back.
    const time = player.getState().time;
    expect(time).toBeGreaterThanOrEqual(1);
    expect(time).toBeLessThan(2);
    player.stop();
  });

  it('ignores a region shorter than a tenth of a second', () => {
    const player = new MidiPlayer();
    player.load(song);
    player.setLoopRegion(1, 1.05);
    expect(player.getState().loopStart).toBeNull();
    expect(player.getState().loopEnd).toBeNull();
  });

  it('clears the region when a new song loads', () => {
    const player = new MidiPlayer();
    player.load(song);
    player.setLoopRegion(1, 2);
    player.load({ ...song, name: 'other' });
    expect(player.getState().loopStart).toBeNull();
    expect(player.getState().loopEnd).toBeNull();
  });
});
