import { describe, expect, it } from 'vitest';
import { MpeRouter } from './mpe';

describe('MPE routing', () => {
  it('does nothing while disabled', () => {
    const router = new MpeRouter(false);
    expect(router.handle({ type: 'noteOn', note: 60, channel: 2 })).toEqual([]);
  });

  it('routes a bend to the note on that channel', () => {
    const router = new MpeRouter(true);
    router.setBendRange(48);
    router.handle({ type: 'noteOn', note: 60, channel: 2 });
    router.handle({ type: 'noteOn', note: 67, channel: 3 });
    const bent = router.handle({ type: 'pitchBend', channel: 3, value: 0.5 });
    expect(bent).toEqual([{ type: 'bend', note: 67, semitones: 24, pressure: 0 }]);
    // Channel 2 is untouched.
    expect(router.handle({ type: 'pitchBend', channel: 2, value: -0.25 })).toEqual([
      { type: 'bend', note: 60, semitones: -12, pressure: 0 },
    ]);
  });

  it('ignores a bend for a channel with no note', () => {
    const router = new MpeRouter(true);
    expect(router.handle({ type: 'pitchBend', channel: 9, value: 1 })).toEqual([]);
  });

  it('routes channel pressure to the note on that channel', () => {
    const router = new MpeRouter(true);
    router.handle({ type: 'noteOn', note: 64, channel: 5 });
    const pressed = router.handle({ type: 'aftertouch', channel: 5, value: 0.8 });
    expect(pressed).toEqual([{ type: 'pressure', note: 64, semitones: 0, pressure: 0.8 }]);
    // A note that arrives later on the same channel inherits the pressure.
    router.handle({ type: 'noteOff', channel: 5 });
    const next = router.handle({ type: 'noteOn', note: 65, channel: 5 });
    expect(next[0]).toMatchObject({ type: 'noteOn', note: 65, pressure: 0.8 });
  });

  it('releases the bend on note-off so a reused channel is not left bent', () => {
    const router = new MpeRouter(true);
    router.handle({ type: 'noteOn', note: 60, channel: 2 });
    router.handle({ type: 'pitchBend', channel: 2, value: 1 });
    const off = router.handle({ type: 'noteOff', channel: 2 });
    expect(off.map((e) => e.type)).toEqual(['bend', 'noteOff']);
    expect(off[0]).toMatchObject({ note: 60, semitones: 0 });
  });

  it('hands back the bends to release when MPE is switched off', () => {
    const router = new MpeRouter(true);
    router.handle({ type: 'noteOn', note: 60, channel: 2 });
    router.handle({ type: 'noteOn', note: 64, channel: 3 });
    router.handle({ type: 'pitchBend', channel: 2, value: 1 });
    const released = router.setEnabled(false);
    expect(released.map((e) => e.note).sort((a, b) => a - b)).toEqual([60, 64]);
    expect(released.every((e) => e.semitones === 0)).toBe(true);
    expect(router.heldNotes()).toEqual([]);
    // Already off: nothing to release a second time.
    expect(router.setEnabled(false)).toEqual([]);
  });
});
