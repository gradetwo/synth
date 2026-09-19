import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DEFAULT_ROUTES } from '@/audio/params';
import { parsePatchFile } from './patchfile';

/**
 * Patch files and `.gs1song` arrangements, as the importer reads them.
 *
 * The fuzzer next door proves these stay total on junk; these tests say what a
 * *good* file turns into, and pin the caps that keep a hostile one from turning
 * into unbounded work.
 */

const exportFile = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'gs1-preset',
    name: 'My Patch',
    params: { '1': 1, '2': 3, '14': 880 },
    routes: [{ src: 'lfo1', dst: 'cutoff', amount: 0.5, enabled: true }],
    ...overrides,
  });

describe('patch files', () => {
  it('reads a patch file into a preset with the defaults underneath', () => {
    const file = parsePatchFile(exportFile());
    expect(file?.kind).toBe('preset');
    if (file?.kind !== 'preset') throw new Error('expected a preset');
    const { preset } = file;
    expect(preset.name).toBe('My Patch');
    expect(preset.tag).toBe('IMPORTED');
    expect(preset.cat).toBe('USER');
    // The file is an overlay: parameters it does not mention keep the default.
    expect(preset.params[14]).toBe(880);
    expect(preset.params[2]).toBe(3);
    expect(preset.params[3]).toBe(DEFAULT_PARAMS[3]);
    expect(preset.wave).toBeDefined();
    expect(preset.routes).toHaveLength(1);
    expect(preset.routes?.[0]).toMatchObject({ src: 'lfo1', dst: 'cutoff', amount: 0.5, enabled: true });
  });

  it('carries a second layer and its routing only when the file has one', () => {
    const single = parsePatchFile(exportFile());
    expect(single?.kind === 'preset' && single.preset.params2).toBeUndefined();

    const layered = parsePatchFile(
      exportFile({ params2: { '14': 220 }, instanceMode: 'split', splitNote: 64 }),
    );
    expect(layered?.kind).toBe('preset');
    if (layered?.kind !== 'preset') throw new Error('expected a preset');
    expect(layered.preset.params2?.[14]).toBe(220);
    expect(layered.preset.instanceMode).toBe('split');
    expect(layered.preset.splitNote).toBe(64);
  });

  it('accepts a .gs1song file as a share code in a box', () => {
    const file = parsePatchFile(JSON.stringify({ format: 'gs1-song', schema: 2, code: 'gs1.1.abc' }));
    expect(file).toEqual({ kind: 'song', code: 'gs1.1.abc' });
    // …but a song file with no code, or a code that is not a string, is junk.
    expect(parsePatchFile(JSON.stringify({ format: 'gs1-song' }))).toBeNull();
    expect(parsePatchFile(JSON.stringify({ format: 'gs1-song', code: 42 }))).toBeNull();
  });

  it('rejects anything that is not one of the two formats, without throwing', () => {
    const junk = [
      '',
      'nope',
      '[]',
      'null',
      '{"format":"other","params":{}}',
      '{"format":"gs1-preset"}',
      '{"format":"gs1-preset","params":[]}',
      '{"format":"gs1-preset","params":null}',
      '{"format":"gs1-preset","params":"1,2,3"}',
      '{"format":"gs1-preset","params":{',
      '{"format":"gs1-preset","params":{"1":1},"routes":',
    ];
    for (const text of junk) expect(parsePatchFile(text)).toBeNull();
  });

  it('caps what a file may add: parameters, routes, name length and code size', () => {
    const many = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`${i}`, i / 100]));
    const routes = Array.from({ length: 500 }, () => ({ src: 'lfo1', dst: 'cutoff', amount: 0.5 }));
    const file = parsePatchFile(exportFile({ params: many, routes, name: 'x'.repeat(5000) }));
    expect(file?.kind).toBe('preset');
    if (file?.kind !== 'preset') throw new Error('expected a preset');
    // 512 from the file plus the default matrix underneath.
    expect(Object.keys(file.preset.params).length).toBeLessThanOrEqual(512 + Object.keys(DEFAULT_PARAMS).length);
    expect(file.preset.routes?.length).toBe(64);
    expect(file.preset.name.length).toBe(120);

    const huge = parsePatchFile(JSON.stringify({ format: 'gs1-song', code: 'A'.repeat(300_000) }));
    expect(huge).toBeNull();
  });

  it('falls back to the default routing, and ignores rows without a source or target', () => {
    const missing = parsePatchFile(exportFile({ routes: undefined }));
    expect(missing?.kind === 'preset' && missing.preset.routes).toEqual(DEFAULT_ROUTES.map((r) => ({ ...r })));

    const broken = parsePatchFile(exportFile({ routes: [{ src: 'lfo1' }, null, 7, { dst: 'cutoff' }] }));
    expect(broken?.kind === 'preset' && broken.preset.routes).toEqual(DEFAULT_ROUTES.map((r) => ({ ...r })));
  });

  it('ignores parameters that are not finite numbers, and clamps routing amounts', () => {
    const file = parsePatchFile(
      JSON.stringify({
        format: 'gs1-preset',
        params: { '1': 1, '2': 'three', '3': null, '4': [1], '5': Number.MAX_SAFE_INTEGER },
        routes: [{ src: 'lfo1', dst: 'cutoff', amount: 99, enabled: 1 }],
      }),
    );
    if (file?.kind !== 'preset') throw new Error('expected a preset');
    expect(file.preset.params[2]).toBe(DEFAULT_PARAMS[2]);
    expect(file.preset.params[4]).toBe(DEFAULT_PARAMS[4]);
    expect(file.preset.params[5]).toBe(Number.MAX_SAFE_INTEGER);
    expect(file.preset.routes?.[0].amount).toBe(1);
    expect(file.preset.routes?.[0].enabled).toBe(true);
  });

  it('keeps split notes inside MIDI range and rounds them', () => {
    const note = (value: unknown) => {
      const file = parsePatchFile(exportFile({ params2: { '1': 1 }, splitNote: value }));
      return file?.kind === 'preset' ? file.preset.splitNote : 'rejected';
    };
    expect(note(60.4)).toBe(60);
    expect(note(-1)).toBeUndefined();
    expect(note(200)).toBeUndefined();
    expect(note('60')).toBeUndefined();
  });
});
