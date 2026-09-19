/**
 * Document-level migration tests.
 *
 * Each case writes the shape an older build left in `localStorage` (or in a
 * share code) and asserts the current build reads the *content* back, not just
 * that it does not throw.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './persist';
import { MidiLibrary } from '@/midi/library';
import { parseMidi, writeMidi, type MidiSong } from '@/midi/smf';
import { normalizeTakes, type MidiTake } from '@/midi/takes';
import { takesOf, withTakes } from '@/midi/take-edit';
import { SynthStore } from './store';
import { SCENES_KEY } from './scenes';
import { decodePatch, encodePatch } from './share';
import { parsePatchFile } from './patchfile';
import { DEFAULT_PARAMS, Param, createDefaultState } from '@/audio/params';

const STATE_KEY = 'gs1:state:v1';
const USER_KEY = 'gs1:user-presets:v1';
const LAYOUT_KEY = 'gs1:layout:v1';
const LIBRARY_KEY = 'gs1:library:v1';

/** A state document as version 1 wrote it: flat, no schema, no envelope. */
function legacyState(params: Record<number, number>, presetId?: string) {
  return { ...createDefaultState(), params: { ...DEFAULT_PARAMS, ...params }, ...(presetId ? { presetId } : {}) };
}

beforeEach(() => {
  localStorage.clear();
});

describe('document migration', () => {
  it('loads a patch stored before versioning existed', () => {
    localStorage.setItem(STATE_KEY, JSON.stringify(legacyState({ [Param.FILTER_CUTOFF]: 1234 })));
    const store = new SynthStore();
    expect(store.getParam(Param.FILTER_CUTOFF as never)).toBeCloseTo(1234, 6);
    // Everything the old document did not carry is the current default.
    expect(store.getSnapshot().state.routes.length).toBeGreaterThan(0);
  });

  it('ignores a patch written by a newer build', () => {
    // The envelope is *newer*, so the store falls back to defaults rather than
    // loading a document it may be misreading.
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ schema: SCHEMA_VERSION + 1, data: legacyState({ [Param.FILTER_CUTOFF]: 1234 }) }),
    );
    const store = new SynthStore();
    expect(store.getParam(Param.FILTER_CUTOFF as never)).not.toBeCloseTo(1234, 1);
  });

  it('loads a layout and scenes stored before versioning existed', () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ lang: 'en', polyphony: 8 }));
    localStorage.setItem(
      SCENES_KEY,
      JSON.stringify([{ id: 's1', name: 'Scene', workspace: { order: [] } }]),
    );
    const store = new SynthStore();
    expect(store.getSnapshot().layout.polyphony).toBe(8);
    expect(store.getSnapshot().scenes.map((scene) => scene.id)).toEqual(['s1']);
  });

  it('reads a schema-2 library, clips and all (P5.2 is an additive bump)', () => {
    // Schema 3 added arrangement clips to a song. A document written under 2 has
    // no clips and has to read back exactly as it played — this is the migration
    // sample the batch asks for.
    const two: MidiSong = {
      name: 'old song',
      bpm: 120,
      duration: 1,
      notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }],
    };
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        schema: 2,
        data: {
          tracks: [
            {
              id: 'file:old.mid:1',
              title: ['old', 'old'],
              composer: 'imported',
              group: 'imported',
              song: two,
              mix: [{ muted: true, volume: 0.4, pan: -0.5, offset: -1.5 }],
            },
          ],
          currentId: 'file:old.mid:1',
        },
      }),
    );
    const library = new MidiLibrary();
    const stored = library.getCurrent()!;
    expect(stored.id).toBe('file:old.mid:1');
    expect(stored.song.notes).toEqual(two.notes);
    expect(stored.song.clips).toBeUndefined();
    expect(stored.mix?.[0]).toMatchObject({ muted: true, volume: 0.4 });
    // Re-writing it stores the current schema, so the next load is a 3.
    const written = JSON.parse(localStorage.getItem(LIBRARY_KEY)!) as { schema: number };
    expect(written.schema).toBe(SCHEMA_VERSION);
  });

  it('loads user presets from a bare array and drops broken entries', () => {
    localStorage.setItem(
      USER_KEY,
      JSON.stringify([
        { id: 'mine', name: ['我的', 'Mine'], params: { ...DEFAULT_PARAMS, [Param.OSC1_LEVEL]: 0.5 }, routes: [] },
        { id: 'broken' },
      ]),
    );
    const store = new SynthStore();
    expect(store.getSnapshot().userPresets.map((preset) => preset.id)).toEqual(['mine']);
  });

  it('reads a schema-3 library, takes and all (P5.4 is an additive bump)', () => {
    // Schema 4 added recorded takes to a song. A document written under 3 has
    // none, so it has to read back exactly as it played — this is the migration
    // sample this batch asks for. (Schema 2 without clips is the previous one,
    // above.)
    const three: MidiSong = {
      name: 'old song',
      bpm: 120,
      duration: 1,
      notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }],
      clips: [
        {
          id: 'c1',
          name: 'Clip',
          layer: 0,
          start: 0,
          length: 1,
          repeat: 2,
          notes: [{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }],
        },
      ],
    };
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        schema: 3,
        data: {
          tracks: [
            {
              id: 'file:old3.mid:1',
              title: ['old', 'old'],
              composer: 'imported',
              group: 'imported',
              song: three,
            },
          ],
          currentId: 'file:old3.mid:1',
        },
      }),
    );
    const library = new MidiLibrary();
    const stored = library.getCurrent()!;
    expect(stored.song.takes).toBeUndefined();
    expect(stored.song.takeId).toBeUndefined();
    // The clip was re-expanded on the way in: two passes of the same note.
    expect(stored.song.notes).toHaveLength(2);
    const written = JSON.parse(localStorage.getItem(LIBRARY_KEY)!) as { schema: number };
    expect(written.schema).toBe(SCHEMA_VERSION);
  });
});

describe('share codes', () => {
  it('round-trips a patch through a code', () => {
    const state = { ...createDefaultState(), params: { ...DEFAULT_PARAMS, [Param.OSC1_LEVEL]: 0.42 } };
    const decoded = decodePatch(encodePatch(state));
    expect(decoded).not.toBeNull();
    expect(decoded!.params[Param.OSC1_LEVEL]).toBeCloseTo(0.42, 4);
  });

  it('reads a code written before codes carried a schema', () => {
    // Encode by hand the way version 1 did: no `s` field.
    const ids = Object.keys(DEFAULT_PARAMS).map(Number).sort((a, b) => a - b);
    const values = ids.map((id) => (id === Param.OSC1_LEVEL ? 0.31 : DEFAULT_PARAMS[id]));
    const json = JSON.stringify({ v: values, r: [] });
    const code = 'gs1.1.' + Buffer.from(json, 'utf8').toString('base64url');
    const decoded = decodePatch(code);
    expect(decoded!.params[Param.OSC1_LEVEL]).toBeCloseTo(0.31, 4);
  });

  it('maps a short code onto the parameters it carried, in id order', () => {
    // A code written before the newest parameters existed holds fewer values;
    // ids are append-only, so the prefix still lines up.
    const ids = Object.keys(DEFAULT_PARAMS).map(Number).sort((a, b) => a - b);
    const shortIds = ids.slice(0, 10);
    const values = shortIds.map((id) => (id === Param.OSC1_LEVEL ? 0.25 : DEFAULT_PARAMS[id]));
    const code = 'gs1.1.' + Buffer.from(JSON.stringify({ s: 1, v: values, r: [] }), 'utf8').toString('base64url');
    const decoded = decodePatch(code);
    expect(decoded!.params[Param.OSC1_LEVEL]).toBeCloseTo(0.25, 4);
    // Parameters that were not in the code keep their defaults.
    expect(decoded!.params[Param.FILTER_CUTOFF]).toBe(DEFAULT_PARAMS[Param.FILTER_CUTOFF]);
  });

  it('refuses a code from a newer build', () => {
    const code =
      'gs1.1.' + Buffer.from(JSON.stringify({ s: SCHEMA_VERSION + 1, v: [], r: [] }), 'utf8').toString('base64url');
    expect(decodePatch(code)).toBeNull();
  });

  it('round-trips the takes a code carries, selection included (P5.4)', () => {
    // A code carries *all* the takes plus which one was selected: the receiver
    // gets the same list to switch between, not just the performance that
    // happened to be playing. The MIDI in the code is the selected take.
    const state = createDefaultState();
    const first: MidiTake = {
      id: 'takeA',
      name: 'Take 1',
      layer: 0,
      notes: [{ note: 60, velocity: 64 / 127, start: 0, duration: 0.5 }],
    };
    const second: MidiTake = {
      id: 'takeB',
      name: 'Take 2',
      layer: 0,
      notes: [
        { note: 60, velocity: 64 / 127, start: 0, duration: 0.5 },
        { note: 67, velocity: 64 / 127, start: 1, duration: 0.5 },
      ],
    };
    const song: MidiSong = {
      name: 'takes',
      bpm: 120,
      duration: 1.9,
      notes: second.notes,
      takes: [first, second],
      takeId: second.id,
    };
    const shared = {
      name: 'takes',
      midi: writeMidi(song.notes, { bpm: 120, name: 'takes' }),
      mix: [] as [boolean, number, number, number][],
      takes: song.takes,
      takeId: song.takeId,
    };
    const code = encodePatch(state, { song: shared });
    const decoded = decodePatch(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.song?.takes?.map((take) => take.id)).toEqual(['takeA', 'takeB']);
    expect(decoded!.song?.takeId).toBe('takeB');
    expect(decoded!.song?.takes?.[1].notes.map((note) => note.note)).toEqual([60, 67]);
    expect(decoded!.song?.takes?.[0].notes[0].velocity).toBeCloseTo(64 / 127, 3);

    // What `importSharedSong` does with it: the MIDI comes back as the current
    // performance and the take list is put back on top, so switching still
    // works on the receiving side.
    const parsed = parseMidi(decoded!.song!.midi, 'takes');
    const restored = withTakes(parsed, normalizeTakes(decoded!.song!.takes), decoded!.song!.takeId);
    expect(restored.notes.map((note) => note.note)).toEqual([60, 67]);
    const asFirst = withTakes(restored, takesOf(restored), 'takeA');
    expect(asFirst.notes.map((note) => note.note)).toEqual([60]);

    // A `.gs1song` file is that same code in a box, so it carries the takes
    // too: parse the file back and the same list comes out.
    const file = parsePatchFile(JSON.stringify({ format: 'gs1-song', schema: SCHEMA_VERSION, code }));
    expect(file?.kind).toBe('song');
    const fromFile = decodePatch((file as { kind: 'song'; code: string }).code);
    expect(fromFile?.song?.takes?.map((take) => take.id)).toEqual(['takeA', 'takeB']);
    expect(fromFile?.song?.takeId).toBe('takeB');
  });
});
