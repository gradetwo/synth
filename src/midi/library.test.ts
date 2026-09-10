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

  it('never stores the built-in songs', async () => {
    const library = await loadLibrary();
    library.put(track);
    const payload = JSON.parse(localStorage.getItem(KEY)!) as { data: { tracks: { id: string }[] } };
    expect(payload.data.tracks.map((entry) => entry.id)).toEqual([track.id]);
    expect(library.getTracks().some((entry) => entry.id.startsWith('demo:'))).toBe(true);
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
