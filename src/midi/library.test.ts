/**
 * MIDI library persistence tests.
 *
 * Imported files and recordings are the player's own work; losing them on a
 * reload is the kind of thing a player only discovers after it has happened. The
 * interesting cases are the bad ones: junk in storage, a document from a newer
 * build, and a track whose song does not validate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wrap } from '@/state/persist';
import type { MidiSong } from './smf';

const KEY = 'gs1:library:v1';

/** A fresh module reads storage in its constructor, like a page reload does. */
async function loadLibrary() {
  const { midiLibrary } = await import('./library');
  return midiLibrary;
}

const song: MidiSong = {
  name: 'test',
  bpm: 120,
  duration: 1,
  notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }],
};

const track = {
  id: 'file:mine.mid:1',
  title: ['mine', 'mine'] as [string, string],
  composer: 'imported',
  song,
  group: 'imported' as const,
};

beforeEach(() => {
  localStorage.clear();
  // The module keeps one instance; a page reload re-runs its constructor.
  vi.resetModules();
});

describe('MIDI library persistence', () => {
  it('keeps imported tracks across a reload', async () => {
    const library = await loadLibrary();
    library.put(track);
    expect(localStorage.getItem(KEY)).toBeTruthy();

    vi.resetModules();
    vi.resetModules();
    const reloaded = await loadLibrary();
    const stored = reloaded.getTracks().find((entry) => entry.id === track.id);
    expect(stored?.song.notes).toHaveLength(1);
    expect(stored?.group).toBe('imported');
    // …and it is the selected track, so the player resumes where it was.
    expect(reloaded.getCurrentId()).toBe(track.id);
  });

  it('keeps recordings as clips and removes them again', async () => {
    const library = await loadLibrary();
    library.put({ ...track, id: 'clip', group: 'clip' });
    vi.resetModules();
    let reloaded = await loadLibrary();
    expect(reloaded.getTracks().some((entry) => entry.id === 'clip')).toBe(true);

    reloaded.remove('clip');
    vi.resetModules();
    reloaded = await loadLibrary();
    expect(reloaded.getTracks().some((entry) => entry.id === 'clip')).toBe(false);
  });

  it('keeps a multi-track song\'s layer mix across a reload', async () => {
    const layered = {
      id: 'file:two-track.mid:1',
      title: ['two', 'two'] as [string, string],
      composer: 'imported',
      group: 'imported' as const,
      song: {
        name: 'two',
        bpm: 120,
        duration: 1,
        notes: [
          { note: 48, velocity: 0.8, start: 0, duration: 0.5 },
          { note: 60, velocity: 0.8, start: 0, duration: 0.5 },
        ],
        tracks: [
          { name: 'Bass', notes: [{ note: 48, velocity: 0.8, start: 0, duration: 0.5 }] },
          { name: 'Lead', notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }] },
        ],
      },
    };
    const library = await loadLibrary();
    library.put(layered);
    // Balance it like a player would…
    const { midiPlayer } = await import('./player');
    midiPlayer.setLayer(0, { muted: true, volume: 0.4, offset: -1.5, pan: -0.6 });
    library.saveMix();

    // …and a reload brings the mix back with the song.
    vi.resetModules();
    vi.resetModules();
    const reloaded = await loadLibrary();
    const { midiPlayer: player2 } = await import('./player');
    reloaded.setCurrent(layered.id, { autoplay: false });
    expect(player2.getLayers()[0].muted).toBe(true);
    expect(player2.getLayers()[0].volume).toBeCloseTo(0.4, 6);
    expect(player2.getLayers()[1].muted).toBe(false);
    // The arrangement (a layer pushed 1.5 s earlier) and its place in the
    // stereo image travel with the mix.
    expect(player2.getLayers()[0].offset).toBeCloseTo(-1.5, 6);
    expect(player2.getLayers()[0].pan).toBeCloseTo(-0.6, 6);
  });

  it('announces a mix it saves, so the strip is never stale', async () => {
    // The mix can also be applied from outside the player panel (a share code,
    // an undo): whoever is showing the layers has to hear about it.
    const library = await loadLibrary();
    library.put({
      id: 'file:notify.mid:1',
      title: ['notify', 'notify'],
      composer: 'imported',
      group: 'imported' as const,
      song: {
        name: 'notify',
        bpm: 120,
        duration: 1,
        notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }],
        tracks: [
          { name: 'A', notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }] },
          { name: 'B', notes: [{ note: 67, velocity: 0.8, start: 0, duration: 0.5 }] },
        ],
      },
    });
    let notified = 0;
    const stop = library.subscribe(() => {
      notified += 1;
    });
    const { midiPlayer } = await import('./player');
    midiPlayer.setLayer(0, { muted: true });
    library.saveMix();
    stop();
    expect(notified).toBeGreaterThan(0);
  });

  it('never stores the built-in songs', async () => {
    const library = await loadLibrary();
    library.put(track);
    const payload = JSON.parse(localStorage.getItem(KEY)!) as { data: { tracks: { id: string }[] } };
    expect(payload.data.tracks.map((entry) => entry.id)).toEqual([track.id]);
    expect(library.getTracks().some((entry) => entry.id.startsWith('demo:'))).toBe(true);
  });

  it('labels built-ins with the licence from their spec', async () => {
    const library = await loadLibrary();
    const builtins = library.getTracks().filter((entry) => entry.id.startsWith('demo:'));
    expect(builtins.length).toBeGreaterThan(10);
    for (const entry of builtins) {
      expect(['public-domain', 'original'], entry.id).toContain(entry.source?.kind);
      expect(entry.source?.credit.length, entry.id).toBeGreaterThan(0);
    }
    expect(library.getTracks().find((entry) => entry.id === 'demo:elise')?.source?.kind).toBe('public-domain');
  });

  it('keeps a user track\'s own source across a reload', async () => {
    const library = await loadLibrary();
    library.put({
      ...track,
      id: 'file:labelled.mid:1',
      source: { kind: 'user', credit: 'labelled.mid' },
    });
    vi.resetModules();
    const reloaded = await loadLibrary();
    expect(reloaded.getTracks().find((entry) => entry.id === 'file:labelled.mid:1')?.source).toEqual({
      kind: 'user',
      credit: 'labelled.mid',
    });
  });

  it('gives an unlabelled track a source and discards a junk one', async () => {
    const library = await loadLibrary();
    // A shared arrangement arrives through `put()` without a source.
    library.put({ ...track, id: 'share:abc' });
    expect(library.getTracks().find((entry) => entry.id === 'share:abc')?.source?.kind).toBe('user');

    // A hand-edited store cannot smuggle in a kind the app does not know.
    vi.resetModules();
    localStorage.setItem(
      KEY,
      JSON.stringify(
        wrap({
          tracks: [{ ...track, id: 'file:junk.mid:1', source: { kind: 'pirated' } }],
          currentId: 'file:junk.mid:1',
        }),
      ),
    );
    const reloaded = await loadLibrary();
    const stored = reloaded.getTracks().find((entry) => entry.id === 'file:junk.mid:1');
    expect(stored?.source?.kind).toBe('user');
  });

  it('ignores junk, damaged songs and a newer schema', async () => {
    localStorage.setItem(KEY, 'not json');
    expect((await loadLibrary()).getTracks().every((entry) => entry.id.startsWith('demo:'))).toBe(true);

    vi.resetModules();
    localStorage.setItem(KEY, JSON.stringify(wrap({ tracks: [{ ...track, song: { name: 'x' } }], currentId: 'x' })));
    expect((await loadLibrary()).getTracks().every((entry) => entry.id.startsWith('demo:'))).toBe(true);

    vi.resetModules();
    localStorage.setItem(KEY, JSON.stringify({ schema: 99, data: { tracks: [track], currentId: track.id } }));
    const library = await loadLibrary();
    expect(library.getTracks().some((entry) => entry.id === track.id)).toBe(false);
  });
});

describe('stored arrangements', () => {
  it('re-expands the clips instead of trusting the stored flat list', async () => {
    // A file whose flat list disagrees with its clips (hand-edited, or written
    // by a build with another expansion rule): the clips are the arrangement.
    localStorage.setItem(
      KEY,
      JSON.stringify(
        wrap({
          tracks: [
            {
              ...track,
              id: 'file:clips.mid:1',
              song: {
                ...song,
                notes: [{ note: 99, velocity: 1, start: 0, duration: 0.5 }],
                clips: [
                  {
                    id: 'c1',
                    name: 'loop',
                    start: 0,
                    length: 1,
                    repeat: 3,
                    notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }],
                  },
                ],
              },
            },
          ],
          currentId: 'file:clips.mid:1',
        }),
      ),
    );
    vi.resetModules();
    const reloaded = await loadLibrary();
    const stored = reloaded.getCurrent()!;
    expect(stored.song.clips).toHaveLength(1);
    expect(stored.song.notes.map((n) => [n.note, n.start])).toEqual([
      [60, 0],
      [60, 1],
      [60, 2],
    ]);
    expect(stored.song.duration).toBeCloseTo(2.9, 6);
  });

  it('drops broken clips and keeps the song playable', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        wrap({
          tracks: [
            {
              ...track,
              id: 'file:broken.mid:1',
              song: { ...song, clips: [{ id: 'x' }, null, 'nope'] },
            },
          ],
          currentId: 'file:broken.mid:1',
        }),
      ),
    );
    vi.resetModules();
    const reloaded = await loadLibrary();
    const stored = reloaded.getCurrent()!;
    // Nothing survived validation, so the song is the flat list it was stored
    // with — not silence, and not a crash.
    expect(stored.song.clips).toBeUndefined();
    expect(stored.song.notes).toEqual(song.notes);
  });
});
