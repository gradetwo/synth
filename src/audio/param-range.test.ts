/**
 * AudioParam range vs engine enumeration.
 *
 * Every value instance A sends to the DSP travels one route: `engine.setParam`
 * looks the AudioParam up by name and clamps the value to the range the worklet
 * advertises in `parameterDescriptors`
 * (`clamp(value, param.minValue, param.maxValue)`) before writing it. That makes
 * the descriptor table load-bearing in a way that is easy to miss: a range
 * narrower than the engine's enumeration does **not** clamp a knob to a "safe"
 * region, it silently rewrites the value into a *different* algorithm.
 *
 * That is exactly what happened with `osc1Wave`: the table stopped at 7 (brown
 * noise) while `Wave::from_u32` accepts 8 (`Wavetable`) and 9 (`Sample`), so
 * every wavetable preset — `wtorgan`, `wtvocal`, `wtglass`, `wtmetal` — played
 * brown noise. `filterType` stopped at 3 (notch) while `FilterType::from_u32`
 * accepts 4 (`Comb`), 5 (`Formant`) and 6 (`Sem`), so the SEM presets played a
 * notch filter. The same table stopped the effect chain at 8 (`Eq`), while the
 * chain's own kind list (`FX_KINDS`) and `FxKind::from_u32` both have 9
 * (`Transient`) — so picking TRANSIENT in a chain slot ran an EQ instead.
 *
 * None of the existing gates looked at this route: `verify-presets.mjs`,
 * `verify-audio.mjs` and the offline render tests call `gs_set_param` directly,
 * and `worklet-processor.test.ts` writes the value into its fake `parameters`
 * record itself, bypassing both this clamp and the browser's. This test reads
 * the *real* descriptor table (the same module the worklet serves) and holds it
 * against the engine's enumeration.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DELAY_SYNCS,
  DISCRETE_PARAMS,
  FILTER_TYPES,
  FX_KINDS,
  FX_MOD_GAIN_TARGETS,
  FX_MOD_SLOTS,
  FX_MOD_SOURCES,
  FX_OVR_MOD_SLOTS,
  FX_OVR_SLOTS,
  FX_SLOTS,
  LFO_TARGETS,
  LFO_WAVES,
  PARAM_NAMES,
  Param,
  WAVES,
  graphInId,
  graphModDstId,
  graphModSrcId,
  ovrTargetBusId,
  type ParamId,
} from './params';

interface Descriptor {
  name: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
}

let descriptors = new Map<string, Descriptor>();
let registered: { parameterDescriptors?: Descriptor[] } | null = null;

beforeAll(async () => {
  class FakeProcessor {
    port = { postMessage: () => {}, onmessage: null };
  }
  (globalThis as Record<string, unknown>).AudioWorkletProcessor = FakeProcessor;
  (globalThis as Record<string, unknown>).registerProcessor = (_name: string, ctor: unknown) => {
    registered = ctor as { parameterDescriptors?: Descriptor[] };
  };
  (globalThis as Record<string, unknown>).sampleRate = 48000;
  // @ts-expect-error — the worklet is a plain script served as an asset
  await import('./worklet-processor.js');
  descriptors = new Map((registered?.parameterDescriptors ?? []).map((d) => [d.name, d]));
});

const slots = (count: number) => Array.from({ length: count }, (_, i) => i);
const ids = (from: number, count: number): ParamId[] =>
  Array.from({ length: count }, (_, i) => (from + i) as ParamId);

/**
 * Every stepped parameter, the widest value its Rust decoder accepts, and where
 * that bound is written down. `list` names the shared TypeScript enumeration
 * with the same ids: its length is asserted below, so the two sides cannot drift
 * apart without one of them failing here.
 */
interface EngineRange {
  label: string;
  ids: ParamId[];
  min: number;
  max: number;
  engine: string;
  list?: readonly unknown[];
}

const ON_OFF: ParamId[] = [
  Param.OSC1_ON,
  Param.OSC2_ON,
  Param.FILTER_KBD,
  Param.LFO_ON,
  Param.LFO_SYNC,
  Param.FX_REVERB_ON,
  Param.FX_DELAY_ON,
  Param.FX_CHORUS_ON,
  Param.FX_FLANGER_ON,
  Param.FX_PHASER_ON,
  Param.FX_DRIVE_ON,
  Param.LFO2_ON,
  Param.WT_USER,
  Param.FX_DELAY_PINGPONG,
  ...ids(Param.FX_PARALLEL1, FX_SLOTS),
];

const ENGINE_RANGES: EngineRange[] = [
  {
    label: 'oscillator wave',
    ids: [Param.OSC1_WAVE, Param.OSC2_WAVE],
    min: 0,
    max: WAVES.length - 1,
    engine: 'Wave::from_u32 (crates/synth-core/src/params.rs): 8 = wavetable, 9 = sample',
    list: WAVES,
  },
  {
    label: 'stage-1 filter kind',
    ids: [Param.FILTER_TYPE],
    min: 0,
    max: FILTER_TYPES.length - 1,
    engine: 'FilterType::from_u32: 4 = comb, 5 = formant, 6 = sem',
    list: FILTER_TYPES,
  },
  {
    label: 'stage-2 filter kind',
    ids: [Param.FILTER2_TYPE],
    min: 0,
    max: FILTER_TYPES.length - 1,
    engine: 'FilterType::from_u32, with comb/formant folded to lp because stage 2 cannot own their state',
    list: FILTER_TYPES,
  },
  {
    label: 'LFO wave',
    ids: [Param.LFO_WAVE, Param.LFO2_WAVE],
    min: 0,
    max: LFO_WAVES.length - 1,
    engine: 'LfoWave::from_u32',
    list: LFO_WAVES,
  },
  {
    label: 'LFO target',
    ids: [Param.LFO_TARGET, Param.LFO2_TARGET],
    min: 0,
    max: LFO_TARGETS.length - 1,
    engine: 'LfoTarget::from_u32',
    list: LFO_TARGETS,
  },
  {
    label: 'effect chain kind',
    ids: ids(Param.FX_CHAIN1, FX_SLOTS),
    min: 0,
    max: FX_KINDS.length - 1,
    engine: 'FxKind::from_u32: 8 = eq, 9 = transient',
    list: FX_KINDS,
  },
  {
    label: 'delay sync division',
    ids: [Param.FX_DELAY_SYNC],
    min: 0,
    max: DELAY_SYNCS.length - 1,
    engine: 'set(): (value as u32).min(3), read by delay_time_seconds()',
    list: DELAY_SYNCS,
  },
  { label: 'voice mode', ids: [Param.VOICE_MODE], min: 0, max: 2, engine: 'set(): (value as u32).min(2)' },
  { label: 'sampler mode', ids: [Param.SMP_MODE], min: 0, max: 2, engine: 'set(): (value as u32).min(2)' },
  { label: 'sampler root note', ids: [Param.SMP_ROOT], min: 0, max: 127, engine: 'set(): value.clamp(0.0, 127.0)' },
  {
    label: 'filter routing',
    ids: [Param.FILTER_ROUTING],
    min: 0,
    max: 2,
    engine: 'FilterRouting::from_u32: 1 = serial, 2 = parallel',
  },
  { label: 'reverb mode', ids: [Param.FX_REVERB_MODE], min: 0, max: 1, engine: 'set(): if value >= 0.5 { 1 } else { 0 }' },
  {
    label: 'sub oscillator octave',
    ids: [Param.OSC1_SUB, Param.OSC2_SUB],
    min: 0,
    max: 2,
    engine: 'set(): (value as u32).min(2)',
  },
  {
    label: 'in-graph modulation source',
    ids: slots(FX_MOD_SLOTS).map(graphModSrcId),
    min: 0,
    max: FX_MOD_SOURCES.length - 1,
    engine: 'set(): (value as u32).min(3), 0 = off',
    list: FX_MOD_SOURCES,
  },
  {
    label: 'in-graph modulation gain target',
    ids: slots(FX_MOD_SLOTS).map(graphModDstId),
    min: 0,
    max: FX_MOD_GAIN_TARGETS,
    engine: 'mod_dst_code(): min(GRAPH_GAINS), GRAPH_GAINS = FX_SLOTS * 3',
  },
  {
    label: 'override bus target',
    ids: slots(FX_OVR_MOD_SLOTS).map(ovrTargetBusId),
    min: 0,
    max: FX_SLOTS * FX_OVR_SLOTS,
    engine: 'ovr_target_code(): 0 or 1..FX_OVR_POOL, FX_OVR_POOL = FX_SLOTS * OVR_SLOTS',
  },
  { label: 'override bus source', ids: [Param.FX_OVR_SRC], min: 0, max: 3, engine: 'set(): (value as u32).min(3)' },
  {
    label: 'graph input source',
    ids: [...slots(FX_SLOTS).map((s) => graphInId(s, 0)), ...slots(FX_SLOTS).map((s) => graphInId(s, 1))],
    min: 0,
    max: FX_SLOTS + 1,
    engine: 'graph_src_code(): min(FX_SLOTS + 1); 1 = dry bus, 2..7 = node 1..6',
  },
  { label: 'on/off switch', ids: ON_OFF, min: 0, max: 1, engine: 'set(): value > 0.5 (or >= 0.5)' },
];

describe('AudioParam ranges cover the engine enums', () => {
  it('reads the descriptors the worklet actually serves', () => {
    // A gate that silently saw an empty table would pass everything below.
    expect(descriptors.size).toBeGreaterThan(200);
    expect(descriptors.get('osc1Wave')?.maxValue).toBeGreaterThan(0);
  });

  it('advertises a range that contains every value the Rust decoder accepts', () => {
    for (const range of ENGINE_RANGES) {
      expect(range.ids.length, `${range.label} names no parameter`).toBeGreaterThan(0);
      for (const id of range.ids) {
        const name = PARAM_NAMES[id];
        const descriptor = descriptors.get(name);
        const where = `${range.label}: ${name} (id ${id})`;
        expect(descriptor, `${where} is missing from the worklet's descriptor table`).toBeDefined();
        if (!descriptor) continue;
        expect(
          descriptor.maxValue,
          `${where} advertises max ${descriptor.maxValue}, but ${range.engine} accepts up to ${range.max}. ` +
            'engine.setParam clamps to the advertised range, so the higher ids can never reach the DSP.',
        ).toBeGreaterThanOrEqual(range.max);
        expect(
          descriptor.minValue,
          `${where} advertises min ${descriptor.minValue}, but ${range.engine} accepts down to ${range.min}.`,
        ).toBeLessThanOrEqual(range.min);
        expect(
          descriptor.defaultValue,
          `${where} defaults to ${descriptor.defaultValue}, outside its own ${descriptor.minValue}..${descriptor.maxValue}.`,
        ).toBeGreaterThanOrEqual(descriptor.minValue);
        expect(descriptor.defaultValue).toBeLessThanOrEqual(descriptor.maxValue);
      }
    }
  });

  it('keeps the pinned engine bound equal to the shared enumeration', () => {
    for (const range of ENGINE_RANGES) {
      if (!range.list) continue;
      expect(range.list.length - 1, `${range.label} pinned to ${range.max}, list has ${range.list.length}`).toBe(
        range.max,
      );
    }
  });

  it('states a range for every stepped parameter', () => {
    const covered = new Set<ParamId>(ENGINE_RANGES.flatMap((range) => range.ids));
    const missing = [...DISCRETE_PARAMS]
      .filter((id) => !covered.has(id as ParamId))
      .map((id) => `${id} ${PARAM_NAMES[id as ParamId] ?? '(unknown)'}`);
    expect(missing, 'stepped parameters with no engine range stated in ENGINE_RANGES').toEqual([]);
  });
});
