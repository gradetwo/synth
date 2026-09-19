import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, createDefaultState, Param } from '@/audio/params';
import { writeMidi } from '@/midi/smf';
import {
  PREFIX_FOR_TEST,
  decodePatch,
  decodePatchAsync,
  encodePatch,
  encodePatchAsync,
  readShareCode,
} from './share';

describe('patch share codec', () => {
  const state = createDefaultState();

  it('carries the second layer only when a patch actually uses one', () => {
    const plain = encodePatch(createDefaultState(), { routing: { mode: 'layer', splitNote: 60 } });
    expect(decodePatch(plain)!.params2).toBeNull();
    // A code with no layer carries no routing either: there is nothing to route.
    expect(decodePatch(plain)!.instanceMode).toBeNull();
    // A code with no layer must not be longer than it needs to be either.
    expect(plain.length).toBeLessThan(1200);

    const layered = createDefaultState();
    layered.params2 = { ...layered.params2, [Param.OSC1_WAVE]: 3, [Param.FILTER_CUTOFF]: 700 };
    const decoded = decodePatch(
      encodePatch(layered, { routing: { mode: 'layer', splitNote: 57 } }),
    )!;
    expect(decoded.instanceMode).toBe('layer');
    expect(decoded.splitNote).toBe(57);
    expect(decoded.params2?.[Param.OSC1_WAVE]).toBe(3);
    expect(decoded.params2?.[Param.FILTER_CUTOFF]).toBeCloseTo(700, 3);
    // Instance 1 is untouched by the layer's values.
    expect(decoded.params[Param.OSC1_WAVE]).toBe(layered.params[Param.OSC1_WAVE]);
  });

  it('carries an arrangement with its layer mix', () => {
    // The notes travel as a real MIDI file, so the receiving side decodes them
    // with the parser the player already uses.
    const midi = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]);
    const song = {
      name: 'Shared Song',
      midi,
      mix: [
        [true, 0.4, -0.6, -1.5],
        [false, 1, 0.25, 2],
      ] as [boolean, number, number, number][],
    };
    const state = createDefaultState();
    const code = encodePatch(state, { song });
    const back = decodePatch(code);
    expect(back?.song?.name).toBe('Shared Song');
    expect([...back!.song!.midi]).toEqual([...midi]);
    expect(back?.song?.mix).toEqual(song.mix);

    // Without a song the payload is unchanged, so old links keep their length.
    const plain = decodePatch(encodePatch(state));
    expect(plain?.song).toBeNull();
  });

  it('compresses a code that carries an arrangement, and reads it back', async () => {
    // A song is the case where the link length matters: MIDI bytes in base64
    // plus a patch. Compressed it should be shorter, and round-trip exactly.
    const notes = Array.from({ length: 400 }, (_, i) => ({
      note: 48 + (i % 24),
      velocity: 0.7,
      start: i * 0.05,
      duration: 0.04,
    }));
    const song = {
      name: 'Long',
      midi: writeMidi(notes, { bpm: 120, name: 'Long' }),
      mix: [[false, 0.8, -0.2, 0]] as [boolean, number, number, number][],
    };
    const plain = encodePatch(state, { song });
    const packed = await encodePatchAsync(state, { song });
    expect(packed.startsWith('gs1.2.')).toBe(true);
    expect(packed.length).toBeLessThan(plain.length);

    const back = await decodePatchAsync(packed);
    expect(back?.song?.name).toBe('Long');
    expect(back?.song?.midi.length).toBe(song.midi.length);
    expect(back?.song?.mix).toEqual(song.mix);
    expect(back?.params[Param.FILTER_CUTOFF]).toBeCloseTo(state.params[Param.FILTER_CUTOFF]!, 3);

    // A patch-only code stays in the plain format, so older builds can read it.
    const small = await encodePatchAsync(state);
    expect(small.startsWith('gs1.1.')).toBe(true);
    expect((await decodePatchAsync(small))?.params[Param.MASTER_VOLUME]).toBeCloseTo(
      state.params[Param.MASTER_VOLUME]!,
      3,
    );

    // Garbage in the compressed form is refused, not thrown.
    expect(await decodePatchAsync('gs1.2.%%%%')).toBeNull();
  });

  it('round-trips every parameter and route', () => {
    const state = createDefaultState();
    state.params[Param.FILTER_CUTOFF] = 1234.5;
    state.params[Param.OSC1_PAN] = -0.42;
    state.routes = [{ src: 'velocity', dst: 'pwm', amount: -0.75, enabled: true }];

    const code = encodePatch(state);
    expect(code.startsWith('gs1.1.')).toBe(true);
    const decoded = decodePatch(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.params[Param.FILTER_CUTOFF]).toBeCloseTo(1234.5, 3);
    expect(decoded!.params[Param.OSC1_PAN]).toBeCloseTo(-0.42, 3);
    expect(decoded!.routes).toEqual([{ src: 'velocity', dst: 'pwm', amount: -0.75, enabled: true }]);
  });

  it('recognises both forms of share code in a URL', async () => {
    const packed = await encodePatchAsync(createDefaultState(), {
      song: {
        name: 'S',
        midi: writeMidi([{ note: 60, velocity: 0.8, start: 0, duration: 0.5 }], { bpm: 120 }),
        mix: [[false, 1, 0, 0]],
      },
    });
    expect(packed.startsWith('gs1.2.')).toBe(true);
    expect(readShareCode(`#p=${packed}`)).toBe(packed);
    expect(readShareCode(`https://example.com/#p=${packed}`)).toBe(packed);
    expect(readShareCode(`https://example.com/?x=1#p=${encodePatch(createDefaultState())}`)).not.toBeNull();
    expect(readShareCode('https://example.com/#p=nope')).toBeNull();
  });

  it('rejects malformed codes', () => {
    expect(decodePatch('nope')).toBeNull();
    expect(decodePatch('gs1.1.%%%')).toBeNull();
    expect(decodePatch('gs1.1.' + btoa('{"v":"nope"}'))).toBeNull();
  });

  it('carries the routing graph, and an old code leaves it switched off', () => {
    // The graph is ordinary patch data, so it travels with the patch — and a
    // code written before it existed must not silently switch it on.
    const state = createDefaultState();
    state.params[Param.FX_GRAPH] = 1;
    state.params[Param.FX_NODE3_IN2] = 2;
    state.params[Param.FX_NODE3_IN2_GAIN] = 0.5;
    state.params[Param.FX_NODE1_TO_OUT] = 1;
    const decoded = decodePatch(encodePatch(state));
    expect(decoded!.params[Param.FX_GRAPH]).toBe(1);
    expect(decoded!.params[Param.FX_NODE3_IN2]).toBe(2);
    expect(decoded!.params[Param.FX_NODE3_IN2_GAIN]).toBeCloseTo(0.5, 3);
    expect(decoded!.params[Param.FX_NODE1_TO_OUT]).toBe(1);

    // A code with only the ids that existed before keeps the defaults.
    const short = encodePatch(createDefaultState());
    const ids = Object.keys(DEFAULT_PARAMS).map(Number).sort((a, b) => a - b);
    const values = ids.filter((id) => id < Param.FX_GRAPH).map((id) => DEFAULT_PARAMS[id]);
    const old = PREFIX_FOR_TEST + btoa(JSON.stringify({ s: 2, v: values, r: [] }));
    const back = decodePatch(old);
    expect(back).not.toBeNull();
    expect(back!.params[Param.FX_GRAPH]).toBe(0);
    expect(short.length).toBeGreaterThan(0);
  });

  it('fills missing parameters from the defaults', () => {
    const state = createDefaultState();
    const decoded = decodePatch(encodePatch(state));
    expect(decoded!.params[Param.MASTER_VOLUME]).toBe(state.params[Param.MASTER_VOLUME]);
    expect(decoded!.params[Param.VOICE_MODE]).toBe(0);
  });
});
