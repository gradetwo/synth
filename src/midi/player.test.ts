import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiPlayer, mixedNotes, mixedTracks } from './player';
import type { MidiSong } from './smf';

/** Note-ons the transport hands to the engine, with their stereo position. */
const played: { note: number; velocity: number; pan: number }[] = [];
vi.mock('@/audio/noteBus', () => ({
  noteBus: {
    noteOn: (note: number, velocity: number, pan = 0) => played.push({ note, velocity, pan }),
    noteOff: () => {},
    allOff: () => {},
  },
}));

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
  played.length = 0;
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

describe('layers', () => {
  const layered = {
    name: 'two layers',
    bpm: 120,
    duration: 2,
    notes: [
      { note: 48, velocity: 0.8, start: 0, duration: 0.5 },
      { note: 60, velocity: 0.8, start: 0.5, duration: 0.5 },
    ],
    tracks: [
      { name: 'Bass', notes: [{ note: 48, velocity: 0.8, start: 0, duration: 0.5 }] },
      { name: 'Lead', notes: [{ note: 60, velocity: 0.8, start: 0.5, duration: 0.5 }] },
    ],
  };

  it('plays every layer, and honours mute and solo', () => {
    const player = new MidiPlayer();
    player.load(layered);
    expect(player.getLayers().map((layer) => layer.name)).toEqual(['Bass', 'Lead']);
    const notesPlayed = () => player['events'].filter((e) => e.on).map((e) => e.note);

    expect(notesPlayed().sort()).toEqual([48, 60]);
    player.setLayer(0, { muted: true });
    expect(notesPlayed()).toEqual([60]);
    player.setLayer(0, { muted: false });
    // Solo wins: only the soloed layer is heard, muted ones stay out.
    player.setLayer(1, { soloed: true });
    expect(notesPlayed()).toEqual([60]);
    player.setLayer(0, { muted: true });
    expect(notesPlayed()).toEqual([60]);
    // Dropping solo leaves the un-muted layer audible again…
    player.setLayer(1, { soloed: false });
    expect(notesPlayed()).toEqual([60]);
    // …and muting both is silence.
    player.setLayer(1, { muted: true });
    expect(notesPlayed()).toEqual([]);
  });

  it('scales a layer\'s velocity with its volume, never to silence', () => {
    const player = new MidiPlayer();
    player.load(layered);
    const velocities = () => player['events'].filter((e) => e.on).map((e) => e.velocity);
    expect(velocities().sort()).toEqual([0.8, 0.8]);

    player.setLayer(1, { volume: 0.5 });
    // Only the Lead layer's note (60) is attenuated.
    expect(player['events'].filter((e) => e.on && e.note === 60)[0].velocity).toBeCloseTo(0.4, 6);
    expect(player['events'].filter((e) => e.on && e.note === 48)[0].velocity).toBeCloseTo(0.8, 6);

    // Down to zero still schedules the note, at the smallest audible velocity:
    // a fader pulled down must not delete notes from the arrangement.
    player.setLayer(1, { volume: 0 });
    const quiet = player['events'].filter((e) => e.on && e.note === 60);
    expect(quiet).toHaveLength(1);
    expect(quiet[0].velocity).toBeGreaterThan(0);
    expect(quiet[0].velocity).toBeLessThan(0.02);
    // The value is clamped rather than trusted.
    player.setLayer(1, { volume: 9 });
    expect(player.getLayers()[1].volume).toBe(1);
  });

  it('slides a layer in time, dropping what it pushes before zero', () => {
    const player = new MidiPlayer();
    player.load(layered);
    const starts = (note: number) =>
      player['events']
        .filter((e) => e.on && e.note === note)
        .map((e) => Number(e.t.toFixed(6)));

    expect(starts(60)).toEqual([0.5]);
    // Nudging the Lead layer a quarter second early moves its note with it.
    player.setLayer(1, { offset: -0.25 });
    expect(starts(60)).toEqual([0.25]);
    // The other layer is untouched.
    expect(starts(48)).toEqual([0]);
    // Sliding past the start drops the notes that no longer fit, rather than
    // stacking them all on beat one.
    player.setLayer(1, { offset: -0.6 });
    expect(starts(60)).toEqual([]);
    expect(starts(48)).toEqual([0]);
    // A wild value is clamped to something a song can survive.
    player.setLayer(1, { offset: 1e6 });
    expect(player.getLayers()[1].offset).toBe(60);
  });

  it('gives each layer its own place in the stereo image', () => {
    const player = new MidiPlayer();
    player.load(layered);
    // Flat out and play: both layers are centred until they are panned.
    player.play();
    advance(1000);
    expect(played.map((p) => p.pan)).toEqual([0, 0]);

    player.stop();
    played.length = 0;
    player.setLayer(0, { pan: -0.8 });
    player.setLayer(1, { pan: 0.5 });
    player.play();
    advance(1000);
    // The bass sits left, the lead right — and each note carries its layer.
    expect(played.find((p) => p.note === 48)?.pan).toBeCloseTo(-0.8, 6);
    expect(played.find((p) => p.note === 60)?.pan).toBeCloseTo(0.5, 6);

    // Out of range is clamped rather than trusted.
    player.setLayer(0, { pan: -9 });
    expect(player.getLayers()[0].pan).toBe(-1);
  });

  it('hands the mix to renders and exports, not the raw file', () => {
    const player = new MidiPlayer();
    player.load(layered);
    // Bass moved half a second later and pushed left, lead quiet but audible,
    // and a third of the lead's notes are the same pitch so the list is stable.
    player.setLayer(0, { offset: 0.5, pan: -1 });
    player.setLayer(1, { volume: 0.5 });

    const notes = mixedNotes(player['song'], player.getLayers());
    // Bass is listed first and both land on 0.5 s: the bass moved there.
    expect(notes.map((n) => n[0])).toEqual([48, 60]);
    // Bass: moved half a second later and hard left.
    expect(notes[0]).toEqual([48, 0.5, 0.5, 0.8, -1]);
    // Lead: starts where it did, half velocity, centred.
    expect(notes[1]).toEqual([60, 0.5, 0.5, 0.4, 0]);

    // Muting a layer takes it out of the render entirely.
    player.setLayer(0, { muted: true });
    expect(mixedNotes(player['song'], player.getLayers()).map((n) => n[0])).toEqual([60]);

    // The track list keeps each layer's name and pan for the MIDI export.
    player.setLayer(0, { muted: false });
    player.setLayer(1, { pan: 0.75 });
    const tracks = mixedTracks(player['song'], player.getLayers());
    expect(tracks.map((t) => [t.name, t.pan])).toEqual([
      ['Bass', -1],
      ['Lead', 0.75],
    ]);
    expect(tracks[0].notes[0].start).toBe(0.5);
    expect(tracks[1].notes[0].velocity).toBeCloseTo(0.4, 6);
  });

  it('gives a single-layer song one layer with everything audible', () => {
    const player = new MidiPlayer();
    player.load({
      name: 'one',
      bpm: 120,
      duration: 1,
      notes: [{ note: 60, velocity: 1, start: 0, duration: 0.5 }],
    });
    expect(player.getLayers()).toHaveLength(1);
    expect(player.getLayers()[0].muted).toBe(false);
    expect(player['events'].filter((e) => e.on)).toHaveLength(1);
    // Reloading a song resets the layer state rather than carrying it over.
    player.setLayer(0, { muted: true });
    player.load(layered);
    expect(player.getLayers().every((layer) => !layer.muted)).toBe(true);
  });
});
