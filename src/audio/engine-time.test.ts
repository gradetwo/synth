import { describe, expect, it } from 'vitest';
import { frameAtTimestamp } from './engine';

/**
 * A MIDI event's `receivedTime` (or a pointer event's `timeStamp`) lives on the
 * `performance.now()` clock, while the audio worklet counts frames on the
 * context clock. `frameAtTimestamp` bridges the two: it turns a wall-clock
 * timestamp into the absolute frame at which the event happened, so a bend
 * can be scheduled at the same frame a note would land on.
 */
describe('frameAtTimestamp', () => {
  it('converts a MIDI event timestamp to the context frame', () => {
    // currentTime 10 s, sampleRate 48 kHz; the event arrived 10 ms ago.
    expect(frameAtTimestamp(4990, 10, 48000, 5000)).toBe(479520);
    // Exactly now: no offset.
    expect(frameAtTimestamp(5000, 10, 48000, 5000)).toBe(480000);
    // A host scheduling ahead: the frame is in the future.
    expect(frameAtTimestamp(5010, 10, 48000, 5000)).toBe(480480);
  });

  it('rounds to the nearest frame', () => {
    // 0.3 of a frame rounds down, 0.96 of a frame rounds up.
    expect(frameAtTimestamp(5000.00625, 10, 48000, 5000)).toBe(480000);
    expect(frameAtTimestamp(5000.02, 10, 48000, 5000)).toBe(480001);
  });

  it('returns undefined for a timestamp or clock that is not a number', () => {
    // An event with no timestamp (or a context that has not started) names
    // no frame; the caller then takes the immediate path instead of
    // scheduling a bend at a frame it invented.
    expect(frameAtTimestamp(NaN, 10, 48000, 5000)).toBeUndefined();
    expect(frameAtTimestamp(Infinity, 10, 48000, 5000)).toBeUndefined();
    expect(frameAtTimestamp(4990, NaN, 48000, 5000)).toBeUndefined();
    expect(frameAtTimestamp(4990, 10, NaN, 5000)).toBeUndefined();
    expect(frameAtTimestamp(4990, 10, 48000, NaN)).toBeUndefined();
  });
});
