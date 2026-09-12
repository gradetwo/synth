/**
 * Parameter model shared with the Rust DSP core.
 *
 * The numeric ids are the wire format for `gs_set_param`; they must match
 * `crates/synth-core/src/params.rs`. The UI state is a flat `Record<ParamId,
 * number>` so preset serialization, engine sync and AudioParam automation are
 * all one loop — no path parsing, no per-field plumbing.
 */

export const Param = {
  MASTER_VOLUME: 0,
  /** Per-patch output trim: set by presets, not shown in the UI. */
  PATCH_GAIN: 78,
  OSC1_ON: 1,
  OSC1_WAVE: 2,
  OSC1_PITCH: 3,
  OSC1_DETUNE: 4,
  OSC1_LEVEL: 5,
  OSC1_PW: 6,
  OSC2_ON: 7,
  OSC2_WAVE: 8,
  OSC2_PITCH: 9,
  OSC2_DETUNE: 10,
  OSC2_LEVEL: 11,
  OSC2_PW: 12,
  FILTER_TYPE: 13,
  FILTER_CUTOFF: 14,
  FILTER_RES: 15,
  FILTER_DRIVE: 16,
  FILTER_ENV_AMT: 17,
  FILTER_KBD: 18,
  ENV_ATTACK: 19,
  ENV_DECAY: 20,
  ENV_SUSTAIN: 21,
  ENV_RELEASE: 22,
  LFO_ON: 23,
  LFO_WAVE: 24,
  LFO_RATE: 25,
  LFO_DEPTH: 26,
  LFO_TARGET: 27,
  LFO_SYNC: 28,
  FX_REVERB_ON: 29,
  FX_REVERB_SIZE: 30,
  FX_REVERB_MIX: 31,
  FX_DELAY_ON: 32,
  FX_DELAY_SYNC: 33,
  FX_DELAY_FB: 34,
  FX_DELAY_MIX: 35,
  GLIDE: 36,
  TEMPO: 37,
  PITCH_BEND_RANGE: 38,
  OSC1_PAN: 39,
  OSC2_PAN: 40,
  MASTER_TUNE: 41,
  VOICE_MODE: 42,
  FX_CHORUS_ON: 43,
  FX_CHORUS_DEPTH: 44,
  FX_CHORUS_RATE: 45,
  FX_CHORUS_MIX: 46,
  FX_FLANGER_ON: 47,
  FX_FLANGER_RATE: 48,
  FX_FLANGER_FB: 49,
  FX_FLANGER_MIX: 50,
  FX_PHASER_ON: 51,
  FX_PHASER_RATE: 52,
  FX_PHASER_FB: 53,
  FX_PHASER_MIX: 54,
  FX_DRIVE_ON: 55,
  FX_DRIVE_AMT: 56,
  FX_DRIVE_MIX: 57,
  FILTER_ENV_ATTACK: 58,
  FILTER_ENV_DECAY: 59,
  FILTER_ENV_SUSTAIN: 60,
  FILTER_ENV_RELEASE: 61,
  LFO2_ON: 62,
  LFO2_WAVE: 63,
  LFO2_RATE: 64,
  LFO2_DEPTH: 65,
  LFO2_TARGET: 66,
  FX_REVERB_DAMP: 67,
  FX_REVERB_WIDTH: 68,
  FX_REVERB_PREDELAY: 69,
  OSC1_UNISON: 70,
  OSC1_SPREAD: 71,
  OSC2_UNISON: 72,
  OSC2_SPREAD: 73,
  LFO_RETRIG: 74,
  LFO_ONESHOT: 75,
  LFO2_RETRIG: 76,
  LFO2_ONESHOT: 77,
  /** Play the imported single-cycle wavetable (A6.2) instead of a factory bank. */
  WT_USER: 79,
  /** Delay feedback damping: top end lost per repeat (A5). */
  FX_DELAY_DAMP: 80,
  /** Delay ping-pong: cross-feed so the repeats alternate channels (A5). */
  FX_DELAY_PINGPONG: 81,
  /** Effect chain positions 1..6, in signal order (A5). */
  FX_CHAIN1: 82,
  FX_CHAIN2: 83,
  FX_CHAIN3: 84,
  FX_CHAIN4: 85,
  FX_CHAIN5: 86,
  FX_CHAIN6: 87,
  /** Which engine the reverb section runs: 0 = algorithmic, 1 = impulse response (A5). */
  FX_REVERB_MODE: 94,
  /** Output trim for the impulse-response reverb. */
  FX_CONV_TRIM: 95,
  /** Sampler: the MIDI note at which the imported sample plays at its own pitch (A). */
  /** OSC 2 -> OSC 1 phase modulation, 0..1 (P6.1). Appended so old share codes
      keep lining up: the ids are the wire format. */
  OSC_FM: 137,
  /** Ring modulation between the oscillators, 0 = plain mix, 1 = the product. */
  OSC_RING: 138,
  /** Hard sync: OSC 2 restarts OSC 1's cycle. */
  OSC1_SYNC: 139,
  /** Sub oscillator per oscillator: 0 = off, 1 = one octave down, 2 = two. */
  OSC1_SUB: 140,
  OSC1_SUB_LEVEL: 141,
  OSC2_SUB: 142,
  OSC2_SUB_LEVEL: 143,
  /** White noise blended into the voice after the oscillators. */
  NOISE_MIX: 144,
  /**
   * Continuous multimode position for `FilterType.SEM` (P6.3a): 0 low-pass,
   * 1/3 band-pass, 2/3 notch, 1 high-pass, straight ramps between the four.
   * Every other filter type ignores it, so the default 0 leaves existing
   * patches exactly as they were.
   */
  FILTER_MORPH: 145,
  /**
   * Where the second filter stage sits (P6.3b): 0 off, 1 in series after the
   * first, 2 in parallel beside it. Off by default, so every patch written
   * before it existed takes exactly the code path it always did.
   */
  FILTER_ROUTING: 146,
  /** Type of the second stage; the same wire enum as `FILTER_TYPE`. */
  FILTER2_TYPE: 147,
  FILTER2_CUTOFF: 148,
  FILTER2_RES: 149,
  FILTER2_DRIVE: 150,
  /** Parallel mix: `(1 - blend) * first + blend * second` (P6.3b). */
  FILTER_BLEND: 151,
  SMP_ROOT: 96,
  /** Sampler: 0 = one-shot, 1 = loop, 2 = ping-pong. */
  SMP_MODE: 97,
  SMP_LOOP_START: 98,
  SMP_LOOP_END: 99,
  /** 1 = that position is a send (parallel) instead of an insert (A5). */
  FX_PARALLEL1: 88,
  FX_PARALLEL2: 89,
  FX_PARALLEL3: 90,
  FX_PARALLEL4: 91,
  FX_PARALLEL5: 92,
  FX_PARALLEL6: 93,
  /** 1 = route the effect nodes through the graph below instead of the chain (A1). */
  FX_GRAPH: 100,
  /** Node input 1 source: 0 nothing, 1 dry bus, 2..7 node 1..6. */
  FX_NODE1_IN1: 101,
  FX_NODE2_IN1: 102,
  FX_NODE3_IN1: 103,
  FX_NODE4_IN1: 104,
  FX_NODE5_IN1: 105,
  FX_NODE6_IN1: 106,
  /** Gain on node input 1. */
  FX_NODE1_IN1_GAIN: 107,
  FX_NODE2_IN1_GAIN: 108,
  FX_NODE3_IN1_GAIN: 109,
  FX_NODE4_IN1_GAIN: 110,
  FX_NODE5_IN1_GAIN: 111,
  FX_NODE6_IN1_GAIN: 112,
  /** Node input 2: the second connection a node can sum. */
  FX_NODE1_IN2: 113,
  FX_NODE2_IN2: 114,
  FX_NODE3_IN2: 115,
  FX_NODE4_IN2: 116,
  FX_NODE5_IN2: 117,
  FX_NODE6_IN2: 118,
  FX_NODE1_IN2_GAIN: 119,
  FX_NODE2_IN2_GAIN: 120,
  FX_NODE3_IN2_GAIN: 121,
  FX_NODE4_IN2_GAIN: 122,
  FX_NODE5_IN2_GAIN: 123,
  FX_NODE6_IN2_GAIN: 124,
  /** 1 = this node's output reaches the mix bus. */
  FX_NODE1_TO_OUT: 125,
  FX_NODE2_TO_OUT: 126,
  FX_NODE3_TO_OUT: 127,
  FX_NODE4_TO_OUT: 128,
  FX_NODE5_TO_OUT: 129,
  FX_NODE6_TO_OUT: 130,
  /** Gain on the way to the mix bus. */
  FX_NODE1_OUT_GAIN: 131,
  FX_NODE2_OUT_GAIN: 132,
  FX_NODE3_OUT_GAIN: 133,
  FX_NODE4_OUT_GAIN: 134,
  FX_NODE5_OUT_GAIN: 135,
  FX_NODE6_OUT_GAIN: 136,
  /** Bit-crusher (P6.4): quantiser + sample-rate divider, one per effect node. */
  FX_CRUSH_ON: 152,
  FX_CRUSH_BITS: 153,
  FX_CRUSH_DOWN: 154,
  FX_CRUSH_AA: 155,
  FX_CRUSH_MIX: 156,
  /** Shaping EQ (P6.4): low shelf, sweepable mid peak, high shelf. */
  FX_EQ_ON: 157,
  FX_EQ_LOW_GAIN: 158,
  FX_EQ_LOW_FREQ: 159,
  FX_EQ_MID_GAIN: 160,
  FX_EQ_MID_FREQ: 161,
  FX_EQ_MID_Q: 162,
  FX_EQ_HIGH_GAIN: 163,
  FX_EQ_HIGH_FREQ: 164,
  FX_EQ_MIX: 165,
  /** P6.5: run the saturating filter path at 2× and band-limit back to 1×. */
  OVERSAMPLE: 166,
  /**
   * In-graph modulation (P7.2), three ids per edge and `FX_MOD_SLOTS` edges:
   * `SRC` = 0 off / 1 LFO 1 / 2 LFO 2 / 3 the envelope, `DST` = 0 off or
   * `1 + node * 3 + which` (input 1 gain, input 2 gain, output gain) and
   * `DEPTH` the signed amount the edge adds to that gain. Appended after
   * `OVERSAMPLE` so every existing share code still lines up; every depth
   * starts at 0, which is what keeps a pre-P7.2 graph bit for bit its old self.
   */
  FX_MOD1_SRC: 167,
  FX_MOD1_DST: 168,
  FX_MOD1_DEPTH: 169,
  FX_MOD2_SRC: 170,
  FX_MOD2_DST: 171,
  FX_MOD2_DEPTH: 172,
  FX_MOD3_SRC: 173,
  FX_MOD3_DST: 174,
  FX_MOD3_DEPTH: 175,
  FX_MOD4_SRC: 176,
  FX_MOD4_DST: 177,
  FX_MOD4_DEPTH: 178,
} as const;

/** The dry (pre-effect) bus, as a graph source code. */
export const GRAPH_DRY = 1;

/** Source code for the output of node `slot` (0-based). */
export function graphNodeSrc(slot: number): number {
  return slot + 2;
}

/** Source code of a node input parameter (0 or 1). */
export function graphInId(slot: number, which: 0 | 1): ParamId {
  return ((which === 0 ? Param.FX_NODE1_IN1 : Param.FX_NODE1_IN2) + slot) as ParamId;
}

export function graphInGainId(slot: number, which: 0 | 1): ParamId {
  return ((which === 0 ? Param.FX_NODE1_IN1_GAIN : Param.FX_NODE1_IN2_GAIN) + slot) as ParamId;
}

export function graphToOutId(slot: number): ParamId {
  return (Param.FX_NODE1_TO_OUT + slot) as ParamId;
}

export function graphOutGainId(slot: number): ParamId {
  return (Param.FX_NODE1_OUT_GAIN + slot) as ParamId;
}

/**
 * In-graph modulation edges (P7.2). Keep in step with `MOD_SLOTS` in
 * `params.rs`: the `fxgraph` unit test reads the number back out of the wasm.
 *
 * An edge's depth is carried on the edge itself, not on the source node, so one
 * LFO can push several node gains by different amounts.
 */
export const FX_MOD_SLOTS = 4;

/** Gain targets an edge can address: three per node (`FX_SLOTS * 3`). */
export const FX_MOD_GAIN_TARGETS = 18;

/** Source code of an edge: 0 off, 1 LFO 1, 2 LFO 2, 3 the envelope. */
export type FxModSrc = 0 | 1 | 2 | 3;

export const FX_MOD_SOURCES: FxModSrc[] = [0, 1, 2, 3];

export const FX_MOD_SRC_LABELS: Record<FxModSrc, string> = {
  0: '—',
  1: 'LFO 1',
  2: 'LFO 2',
  3: 'ENV',
};

export function graphModSrcId(slot: number): ParamId {
  return (Param.FX_MOD1_SRC + slot * 3) as ParamId;
}

export function graphModDstId(slot: number): ParamId {
  return (Param.FX_MOD1_DST + slot * 3) as ParamId;
}

export function graphModDepthId(slot: number): ParamId {
  return (Param.FX_MOD1_DEPTH + slot * 3) as ParamId;
}

/** Destination code of `node`'s input 1 gain, input 2 gain or output gain. */
export function graphModDst(node: number, which: 0 | 1 | 2): number {
  return 1 + node * 3 + which;
}

/** Which gain a destination code names, or `null` when it names nothing. */
export function graphModTarget(code: number): { node: number; which: 0 | 1 | 2 } | null {
  if (!Number.isFinite(code) || code < 1 || code > FX_MOD_GAIN_TARGETS) return null;
  const index = Math.round(code) - 1;
  return { node: Math.floor(index / 3), which: (index % 3) as 0 | 1 | 2 };
}

/** Everything an edge writes, in the order the UI groups it. */
export const GRAPH_MOD_PARAM_IDS: ParamId[] = Array.from({ length: FX_MOD_SLOTS }, (_, slot) => [
  graphModSrcId(slot),
  graphModDstId(slot),
  graphModDepthId(slot),
]).flat();

/** Positions in the effect chain (A5). One per effect: the chain is a permutation. */
export const FX_SLOTS = 6;

/**
 * Delay lines and convolution nodes the core's pools hold (P7.1).
 *
 * Keep in step with `DELAY_INSTANCES` / `CONV_INSTANCES` in `engine.rs`: the
 * `fxgraph` unit test reads the numbers back out of the wasm, so a drift is a
 * test failure rather than a silently disabled option.
 */
export const FX_DELAY_INSTANCES = 2;
export const FX_CONV_INSTANCES = 2;
/** Longest delay one instance holds, seconds (`MAX_DELAY_SECONDS` in `dsp/delay.rs`). */
export const FX_DELAY_MAX_SECONDS = 2;

/** What can run at a chain position. Keep in step with `FxKind` in params.rs. */
export type FxKind =
  | 'none'
  | 'delay'
  | 'reverb'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'drive'
  | 'crush'
  | 'eq';

export const FX_KINDS: FxKind[] = [
  'none',
  'delay',
  'reverb',
  'chorus',
  'flanger',
  'phaser',
  'drive',
  'crush',
  'eq',
];

export const FX_KIND_LABELS: Record<FxKind, string> = {
  none: '—',
  delay: 'DELAY',
  reverb: 'REVERB',
  chorus: 'CHORUS',
  flanger: 'FLANGER',
  phaser: 'PHASER',
  drive: 'DRIVE',
  crush: 'CRUSH',
  eq: 'EQ',
};

export function fxKindToInt(kind: FxKind): number {
  return FX_KINDS.indexOf(kind);
}

/**
 * Anything outside the known kinds reads as "nothing here", which is what the
 * DSP does with the same value. Clamping instead would turn a value written by a
 * newer build into an effect this one suddenly runs.
 */
export function intToFxKind(value: number): FxKind {
  return FX_KINDS[Math.round(value)] ?? 'none';
}

/**
 * Only the insert effects have a wet/dry crossfade the send mode can replace;
 * a delay and a reverb already add their wet signal, so the switch would do
 * nothing and the UI does not offer it.
 */
export function fxKindCanBeParallel(kind: FxKind): boolean {
  return (
    kind === 'chorus' ||
    kind === 'flanger' ||
    kind === 'phaser' ||
    kind === 'drive' ||
    kind === 'crush' ||
    kind === 'eq'
  );
}

/**
 * The routing graph a chain is equivalent to (A1).
 *
 * Node 1 reads the dry bus, every later node reads the one before it, and the
 * last position that actually runs feeds the mix bus — which is exactly what
 * the chain does, so switching the graph on cannot change the sound. Positions
 * that run as sends keep the dry signal through their own blend law, which is
 * why they need no special routing here.
 *
 * A position with nothing in it passes its input straight through, so the last
 * position with an effect is the signal the bus ends up carrying.
 */
export function graphFromChain(read: (id: ParamId) => number): number[] {
  const chain = readChain(read);
  const out: number[] = [1]; // the graph switch itself
  const sources: number[] = [];
  let previous: number | null = null;
  for (let slot = 0; slot < FX_SLOTS; slot++) {
    sources.push(previous === null ? GRAPH_DRY : graphNodeSrc(previous));
    if (chain[slot] !== 'none') previous = slot;
  }
  const lastActive = previous ?? 0;
  // The order has to match `GRAPH_FROM_CHAIN_IDS`, which is the order the
  // parameters are written in.
  out.push(...sources); // input 1 sources
  for (let slot = 0; slot < FX_SLOTS; slot++) out.push(1); // input 1 gains
  for (let slot = 0; slot < FX_SLOTS; slot++) out.push(0); // input 2 sources
  for (let slot = 0; slot < FX_SLOTS; slot++) out.push(1); // input 2 gains
  for (let slot = 0; slot < FX_SLOTS; slot++) out.push(slot === lastActive ? 1 : 0);
  for (let slot = 0; slot < FX_SLOTS; slot++) out.push(1); // output gains
  return out;
}

/** The parameter ids `graphFromChain` writes, in the order it returns values. */
export const GRAPH_FROM_CHAIN_IDS: ParamId[] = [
  Param.FX_GRAPH,
  ...Array.from({ length: FX_SLOTS }, (_, slot) => graphInId(slot, 0)),
  ...Array.from({ length: FX_SLOTS }, (_, slot) => graphInGainId(slot, 0)),
  ...Array.from({ length: FX_SLOTS }, (_, slot) => graphInId(slot, 1)),
  ...Array.from({ length: FX_SLOTS }, (_, slot) => graphInGainId(slot, 1)),
  ...Array.from({ length: FX_SLOTS }, (_, slot) => graphToOutId(slot)),
  ...Array.from({ length: FX_SLOTS }, (_, slot) => graphOutGainId(slot)),
];

/** The chain as it is set today, in signal order. */
export function readChain(get: (id: ParamId) => number): FxKind[] {
  const ids = [
    Param.FX_CHAIN1,
    Param.FX_CHAIN2,
    Param.FX_CHAIN3,
    Param.FX_CHAIN4,
    Param.FX_CHAIN5,
    Param.FX_CHAIN6,
  ];
  return ids.map((id) => intToFxKind(get(id as ParamId)));
}

export function chainId(slot: number): ParamId {
  return (Param.FX_CHAIN1 + slot) as ParamId;
}

export function parallelId(slot: number): ParamId {
  return (Param.FX_PARALLEL1 + slot) as ParamId;
}

export type ParamId = (typeof Param)[keyof typeof Param];

/** AudioParam name for every parameter id (used by the worklet + UI). */
export const PARAM_NAMES: Record<ParamId, string> = {
  [Param.MASTER_VOLUME]: 'masterVolume',
  [Param.OSC_FM]: 'oscFm',
  [Param.OSC_RING]: 'oscRing',
  [Param.OSC1_SYNC]: 'osc1Sync',
  [Param.OSC1_SUB]: 'osc1Sub',
  [Param.OSC1_SUB_LEVEL]: 'osc1SubLevel',
  [Param.OSC2_SUB]: 'osc2Sub',
  [Param.OSC2_SUB_LEVEL]: 'osc2SubLevel',
  [Param.NOISE_MIX]: 'noiseMix',
  [Param.FILTER_MORPH]: 'filterMorph',
  [Param.FILTER_ROUTING]: 'filterRouting',
  [Param.FILTER2_TYPE]: 'filter2Type',
  [Param.FILTER2_CUTOFF]: 'filter2Cutoff',
  [Param.FILTER2_RES]: 'filter2Res',
  [Param.FILTER2_DRIVE]: 'filter2Drive',
  [Param.FILTER_BLEND]: 'filterBlend',
  [Param.PATCH_GAIN]: 'patchGain',
  [Param.WT_USER]: 'wtUser',
  [Param.FX_DELAY_DAMP]: 'fxDelayDamp',
  [Param.FX_DELAY_PINGPONG]: 'fxDelayPingpong',
  [Param.FX_REVERB_MODE]: 'fxReverbMode',
  [Param.FX_CONV_TRIM]: 'fxConvTrim',
  [Param.SMP_ROOT]: 'smpRoot',
  [Param.SMP_MODE]: 'smpMode',
  [Param.SMP_LOOP_START]: 'smpLoopStart',
  [Param.SMP_LOOP_END]: 'smpLoopEnd',
  [Param.FX_CHAIN1]: 'fxChain1',
  [Param.FX_CHAIN2]: 'fxChain2',
  [Param.FX_CHAIN3]: 'fxChain3',
  [Param.FX_CHAIN4]: 'fxChain4',
  [Param.FX_CHAIN5]: 'fxChain5',
  [Param.FX_CHAIN6]: 'fxChain6',
  [Param.FX_PARALLEL1]: 'fxParallel1',
  [Param.FX_PARALLEL2]: 'fxParallel2',
  [Param.FX_PARALLEL3]: 'fxParallel3',
  [Param.FX_PARALLEL4]: 'fxParallel4',
  [Param.FX_PARALLEL5]: 'fxParallel5',
  [Param.FX_PARALLEL6]: 'fxParallel6',
  [Param.FX_GRAPH]: 'fxGraph',
  [Param.FX_NODE1_IN1]: 'fxNode1In1',
  [Param.FX_NODE2_IN1]: 'fxNode2In1',
  [Param.FX_NODE3_IN1]: 'fxNode3In1',
  [Param.FX_NODE4_IN1]: 'fxNode4In1',
  [Param.FX_NODE5_IN1]: 'fxNode5In1',
  [Param.FX_NODE6_IN1]: 'fxNode6In1',
  [Param.FX_NODE1_IN1_GAIN]: 'fxNode1In1Gain',
  [Param.FX_NODE2_IN1_GAIN]: 'fxNode2In1Gain',
  [Param.FX_NODE3_IN1_GAIN]: 'fxNode3In1Gain',
  [Param.FX_NODE4_IN1_GAIN]: 'fxNode4In1Gain',
  [Param.FX_NODE5_IN1_GAIN]: 'fxNode5In1Gain',
  [Param.FX_NODE6_IN1_GAIN]: 'fxNode6In1Gain',
  [Param.FX_NODE1_IN2]: 'fxNode1In2',
  [Param.FX_NODE2_IN2]: 'fxNode2In2',
  [Param.FX_NODE3_IN2]: 'fxNode3In2',
  [Param.FX_NODE4_IN2]: 'fxNode4In2',
  [Param.FX_NODE5_IN2]: 'fxNode5In2',
  [Param.FX_NODE6_IN2]: 'fxNode6In2',
  [Param.FX_NODE1_IN2_GAIN]: 'fxNode1In2Gain',
  [Param.FX_NODE2_IN2_GAIN]: 'fxNode2In2Gain',
  [Param.FX_NODE3_IN2_GAIN]: 'fxNode3In2Gain',
  [Param.FX_NODE4_IN2_GAIN]: 'fxNode4In2Gain',
  [Param.FX_NODE5_IN2_GAIN]: 'fxNode5In2Gain',
  [Param.FX_NODE6_IN2_GAIN]: 'fxNode6In2Gain',
  [Param.FX_NODE1_TO_OUT]: 'fxNode1ToOut',
  [Param.FX_NODE2_TO_OUT]: 'fxNode2ToOut',
  [Param.FX_NODE3_TO_OUT]: 'fxNode3ToOut',
  [Param.FX_NODE4_TO_OUT]: 'fxNode4ToOut',
  [Param.FX_NODE5_TO_OUT]: 'fxNode5ToOut',
  [Param.FX_NODE6_TO_OUT]: 'fxNode6ToOut',
  [Param.FX_NODE1_OUT_GAIN]: 'fxNode1OutGain',
  [Param.FX_NODE2_OUT_GAIN]: 'fxNode2OutGain',
  [Param.FX_NODE3_OUT_GAIN]: 'fxNode3OutGain',
  [Param.FX_NODE4_OUT_GAIN]: 'fxNode4OutGain',
  [Param.FX_NODE5_OUT_GAIN]: 'fxNode5OutGain',
  [Param.FX_NODE6_OUT_GAIN]: 'fxNode6OutGain',
  [Param.FX_CRUSH_ON]: 'fxCrushOn',
  [Param.FX_CRUSH_BITS]: 'fxCrushBits',
  [Param.FX_CRUSH_DOWN]: 'fxCrushDown',
  [Param.FX_CRUSH_AA]: 'fxCrushAa',
  [Param.FX_CRUSH_MIX]: 'fxCrushMix',
  [Param.FX_EQ_ON]: 'fxEqOn',
  [Param.FX_EQ_LOW_GAIN]: 'fxEqLowGain',
  [Param.FX_EQ_LOW_FREQ]: 'fxEqLowFreq',
  [Param.FX_EQ_MID_GAIN]: 'fxEqMidGain',
  [Param.FX_EQ_MID_FREQ]: 'fxEqMidFreq',
  [Param.FX_EQ_MID_Q]: 'fxEqMidQ',
  [Param.FX_EQ_HIGH_GAIN]: 'fxEqHighGain',
  [Param.FX_EQ_HIGH_FREQ]: 'fxEqHighFreq',
  [Param.FX_EQ_MIX]: 'fxEqMix',
  [Param.OVERSAMPLE]: 'oversample',
  // In-graph modulation edges (P7.2). The worklet pushes every one of these
  // once per render quantum, which is exactly the block rate the engine
  // resolves them at.
  [Param.FX_MOD1_SRC]: 'fxMod1Src',
  [Param.FX_MOD1_DST]: 'fxMod1Dst',
  [Param.FX_MOD1_DEPTH]: 'fxMod1Depth',
  [Param.FX_MOD2_SRC]: 'fxMod2Src',
  [Param.FX_MOD2_DST]: 'fxMod2Dst',
  [Param.FX_MOD2_DEPTH]: 'fxMod2Depth',
  [Param.FX_MOD3_SRC]: 'fxMod3Src',
  [Param.FX_MOD3_DST]: 'fxMod3Dst',
  [Param.FX_MOD3_DEPTH]: 'fxMod3Depth',
  [Param.FX_MOD4_SRC]: 'fxMod4Src',
  [Param.FX_MOD4_DST]: 'fxMod4Dst',
  [Param.FX_MOD4_DEPTH]: 'fxMod4Depth',
  [Param.OSC1_ON]: 'osc1On',
  [Param.OSC1_WAVE]: 'osc1Wave',
  [Param.OSC1_PITCH]: 'osc1Pitch',
  [Param.OSC1_DETUNE]: 'osc1Detune',
  [Param.OSC1_LEVEL]: 'osc1Level',
  [Param.OSC1_PW]: 'osc1Pw',
  [Param.OSC2_ON]: 'osc2On',
  [Param.OSC2_WAVE]: 'osc2Wave',
  [Param.OSC2_PITCH]: 'osc2Pitch',
  [Param.OSC2_DETUNE]: 'osc2Detune',
  [Param.OSC2_LEVEL]: 'osc2Level',
  [Param.OSC2_PW]: 'osc2Pw',
  [Param.FILTER_TYPE]: 'filterType',
  [Param.FILTER_CUTOFF]: 'filterCutoff',
  [Param.FILTER_RES]: 'filterRes',
  [Param.FILTER_DRIVE]: 'filterDrive',
  [Param.FILTER_ENV_AMT]: 'filterEnvAmt',
  [Param.FILTER_KBD]: 'filterKbd',
  [Param.ENV_ATTACK]: 'envAttack',
  [Param.ENV_DECAY]: 'envDecay',
  [Param.ENV_SUSTAIN]: 'envSustain',
  [Param.ENV_RELEASE]: 'envRelease',
  [Param.LFO_ON]: 'lfoOn',
  [Param.LFO_WAVE]: 'lfoWave',
  [Param.LFO_RATE]: 'lfoRate',
  [Param.LFO_DEPTH]: 'lfoDepth',
  [Param.LFO_TARGET]: 'lfoTarget',
  [Param.LFO_SYNC]: 'lfoSync',
  [Param.FX_REVERB_ON]: 'fxReverbOn',
  [Param.FX_REVERB_SIZE]: 'fxReverbSize',
  [Param.FX_REVERB_DAMP]: 'fxReverbDamp',
  [Param.FX_REVERB_WIDTH]: 'fxReverbWidth',
  [Param.FX_REVERB_PREDELAY]: 'fxReverbPredelay',
  [Param.OSC1_UNISON]: 'osc1Unison',
  [Param.OSC1_SPREAD]: 'osc1Spread',
  [Param.OSC2_UNISON]: 'osc2Unison',
  [Param.OSC2_SPREAD]: 'osc2Spread',
  [Param.LFO_RETRIG]: 'lfoRetrig',
  [Param.LFO_ONESHOT]: 'lfoOneshot',
  [Param.LFO2_RETRIG]: 'lfo2Retrig',
  [Param.LFO2_ONESHOT]: 'lfo2Oneshot',
  [Param.FX_REVERB_MIX]: 'fxReverbMix',
  [Param.FX_DELAY_ON]: 'fxDelayOn',
  [Param.FX_DELAY_SYNC]: 'fxDelaySync',
  [Param.FX_DELAY_FB]: 'fxDelayFb',
  [Param.FX_DELAY_MIX]: 'fxDelayMix',
  [Param.GLIDE]: 'glide',
  [Param.TEMPO]: 'tempo',
  [Param.PITCH_BEND_RANGE]: 'pitchBendRange',
  [Param.OSC1_PAN]: 'osc1Pan',
  [Param.OSC2_PAN]: 'osc2Pan',
  [Param.MASTER_TUNE]: 'masterTune',
  [Param.VOICE_MODE]: 'voiceMode',
  [Param.FX_CHORUS_ON]: 'fxChorusOn',
  [Param.FX_CHORUS_DEPTH]: 'fxChorusDepth',
  [Param.FX_CHORUS_RATE]: 'fxChorusRate',
  [Param.FX_CHORUS_MIX]: 'fxChorusMix',
  [Param.FX_FLANGER_ON]: 'fxFlangerOn',
  [Param.FX_FLANGER_RATE]: 'fxFlangerRate',
  [Param.FX_FLANGER_FB]: 'fxFlangerFb',
  [Param.FX_FLANGER_MIX]: 'fxFlangerMix',
  [Param.FX_PHASER_ON]: 'fxPhaserOn',
  [Param.FX_PHASER_RATE]: 'fxPhaserRate',
  [Param.FX_PHASER_FB]: 'fxPhaserFb',
  [Param.FX_PHASER_MIX]: 'fxPhaserMix',
  [Param.FX_DRIVE_ON]: 'fxDriveOn',
  [Param.FX_DRIVE_AMT]: 'fxDriveAmt',
  [Param.FX_DRIVE_MIX]: 'fxDriveMix',
  [Param.FILTER_ENV_ATTACK]: 'filterEnvAttack',
  [Param.FILTER_ENV_DECAY]: 'filterEnvDecay',
  [Param.FILTER_ENV_SUSTAIN]: 'filterEnvSustain',
  [Param.FILTER_ENV_RELEASE]: 'filterEnvRelease',
  [Param.LFO2_ON]: 'lfo2On',
  [Param.LFO2_WAVE]: 'lfo2Wave',
  [Param.LFO2_RATE]: 'lfo2Rate',
  [Param.LFO2_DEPTH]: 'lfo2Depth',
  [Param.LFO2_TARGET]: 'lfo2Target',
};

export type Wave =
  | 'sine'
  | 'triangle'
  | 'saw'
  | 'square'
  | 'pulse'
  | 'noise'
  | 'pink'
  | 'brown'
  | 'wavetable'
  | 'sample';
export type FilterType = 'lp' | 'hp' | 'bp' | 'nt' | 'comb' | 'formant' | 'sem';
export type LfoWave = 'sine' | 'triangle' | 'square' | 'saw';
export type LfoTarget = 'cutoff' | 'pitch' | 'volume' | 'pwm';
export type ModSrc =
  | 'lfo'
  | 'lfo2'
  | 'env'
  | 'modwheel'
  | 'velocity'
  | 'aftertouch'
  | 'random'
  | 'keytrack';
export type ModDst = 'cutoff' | 'pitch' | 'volume' | 'pwm' | 'pan' | 'res' | 'fm' | 'ring';
export type DelaySync = '1/4' | '1/8.' | '1/8' | '1/16';

/** Note names for the sampler's root note readout. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const WAVES: Wave[] = [
  'sine',
  'triangle',
  'saw',
  'square',
  'pulse',
  'noise',
  'pink',
  'brown',
  // Harmonic table; the PW knob picks which one (see dsp/wavetable).
  'wavetable',
  // Imported sample, played back at the note's rate (see dsp/sampler).
  'sample',
];
export const WAVE_CN: Record<Wave, string> = {
  sine: '正弦',
  triangle: '三角',
  saw: '锯齿',
  square: '方波',
  pulse: '脉冲',
  noise: '白噪',
  pink: '粉噪',
  brown: '棕噪',
  wavetable: '波表',
  sample: '采样',
};
export const FILTER_TYPES: FilterType[] = ['lp', 'hp', 'bp', 'nt', 'comb', 'formant', 'sem'];
export const LFO_WAVES: LfoWave[] = ['sine', 'triangle', 'square', 'saw'];
export const LFO_TARGETS: LfoTarget[] = ['cutoff', 'pitch', 'volume', 'pwm'];
/** Engine-side modulation slots (must match `MOD_ROUTES` in params.rs). */
export const MAX_ROUTES = 8;
export const MOD_SOURCES: ModSrc[] = [
  'lfo',
  'lfo2',
  'env',
  'modwheel',
  'velocity',
  'aftertouch',
  'random',
  'keytrack',
];
// Appended, never reordered: the index is what a share code stores.
export const MOD_DESTS: ModDst[] = ['cutoff', 'pitch', 'volume', 'pwm', 'pan', 'res', 'fm', 'ring'];
/** Compact labels for the matrix rows (kept short so the panel stays tidy). */
export const MOD_SRC_LABELS: Record<ModSrc, string> = {
  lfo: 'LFO',
  lfo2: 'LFO2',
  env: 'ENV',
  modwheel: 'WHEEL',
  velocity: 'VELO',
  aftertouch: 'AFTER',
  random: 'RANDOM',
  keytrack: 'KEY',
};
export const MOD_DST_LABELS: Record<ModDst, string> = {
  cutoff: 'CUTOFF',
  pitch: 'PITCH',
  volume: 'VOLUME',
  pwm: 'PWM',
  pan: 'PAN',
  res: 'RES',
  fm: 'FM',
  ring: 'RING',
};
export const DELAY_SYNCS: DelaySync[] = ['1/4', '1/8.', '1/8', '1/16'];

export interface ModRoute {
  src: ModSrc;
  dst: ModDst;
  amount: number;
  enabled: boolean;
}

export interface SynthState {
  /** Every DSP parameter of instance 1 (the main patch), keyed by `Param`. */
  params: Record<number, number>;
  /**
   * The same for instance 2, the layer/split timbre. Kept with the patch so a
   * layered sound survives a reload and a scene; it starts as a copy of the
   * default patch, so switching to it gives something that makes a sound.
   */
  params2: Record<number, number>;
  routes: ModRoute[];
  /** UI-only: master power. */
  power: boolean;
}

export function waveToInt(w: Wave): number {
  return WAVES.indexOf(w);
}
export function intToWave(v: number): Wave {
  return WAVES[clamp(Math.round(v), 0, WAVES.length - 1)] ?? 'sine';
}
export function filterToInt(f: FilterType): number {
  return FILTER_TYPES.indexOf(f);
}
export function intToFilter(v: number): FilterType {
  return FILTER_TYPES[clamp(Math.round(v), 0, FILTER_TYPES.length - 1)] ?? 'lp';
}
export function lfoWaveToInt(w: LfoWave): number {
  return LFO_WAVES.indexOf(w);
}
export function intToLfoWave(v: number): LfoWave {
  return LFO_WAVES[clamp(Math.round(v), 0, LFO_WAVES.length - 1)] ?? 'sine';
}
export function lfoTargetToInt(t: LfoTarget): number {
  return LFO_TARGETS.indexOf(t);
}
export function intToLfoTarget(v: number): LfoTarget {
  return LFO_TARGETS[clamp(Math.round(v), 0, LFO_TARGETS.length - 1)] ?? 'cutoff';
}
export function modSrcToInt(s: ModSrc): number {
  return MOD_SOURCES.indexOf(s);
}
export function intToModSrc(v: number): ModSrc {
  return MOD_SOURCES[clamp(Math.round(v), 0, MOD_SOURCES.length - 1)] ?? 'lfo';
}
export function modDstToInt(d: ModDst): number {
  return MOD_DESTS.indexOf(d);
}
export function intToModDst(v: number): ModDst {
  return MOD_DESTS[clamp(Math.round(v), 0, MOD_DESTS.length - 1)] ?? 'cutoff';
}
export function delaySyncToInt(d: DelaySync): number {
  return DELAY_SYNCS.indexOf(d);
}
export function intToDelaySync(v: number): DelaySync {
  return DELAY_SYNCS[clamp(Math.round(v), 0, DELAY_SYNCS.length - 1)] ?? '1/8';
}

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Default patch, mirroring the reference prototype's "Future Saw Lead". */
export const DEFAULT_PARAMS: Record<number, number> = {
  [Param.MASTER_VOLUME]: 0.75,
  // Off by default: a patch that predates them sounds exactly as it did.
  [Param.OSC_FM]: 0,
  [Param.OSC_RING]: 0,
  [Param.OSC1_SYNC]: 0,
  [Param.OSC1_SUB]: 0,
  [Param.OSC1_SUB_LEVEL]: 0.4,
  [Param.OSC2_SUB]: 0,
  [Param.OSC2_SUB_LEVEL]: 0.4,
  [Param.NOISE_MIX]: 0,
  [Param.FILTER_MORPH]: 0,
  [Param.FILTER_ROUTING]: 0,
  [Param.FILTER2_TYPE]: 0,
  [Param.FILTER2_CUTOFF]: 9000,
  [Param.FILTER2_RES]: 0.25,
  [Param.FILTER2_DRIVE]: 0.15,
  [Param.FILTER_BLEND]: 0.5,
  // Per-patch loudness trim (presets set it; see `PATCH_TRIM` in state/presets).
  [Param.PATCH_GAIN]: 1,
  // Factory banks by default; the player flips this after importing a cycle.
  [Param.WT_USER]: 0,
  [Param.FX_DELAY_DAMP]: 0.35,
  [Param.FX_DELAY_PINGPONG]: 0,
  [Param.FX_REVERB_MODE]: 0,
  [Param.FX_CONV_TRIM]: 1,
  // C4 is the note most one-shots are played at; the loop covers the whole file.
  [Param.SMP_ROOT]: 60,
  [Param.SMP_MODE]: 0,
  [Param.SMP_LOOP_START]: 0,
  [Param.SMP_LOOP_END]: 1,
  // The order effects have always run in, so every existing patch keeps its sound.
  [Param.FX_CHAIN1]: 1,
  [Param.FX_CHAIN2]: 2,
  [Param.FX_CHAIN3]: 3,
  [Param.FX_CHAIN4]: 4,
  [Param.FX_CHAIN5]: 5,
  [Param.FX_CHAIN6]: 6,
  [Param.FX_PARALLEL1]: 0,
  [Param.FX_PARALLEL2]: 0,
  [Param.FX_PARALLEL3]: 0,
  [Param.FX_PARALLEL4]: 0,
  [Param.FX_PARALLEL5]: 0,
  [Param.FX_PARALLEL6]: 0,
  // The routing graph is off until the editor turns it on: every existing patch
  // then runs the chain above, which is what it was written for (A1).
  [Param.FX_GRAPH]: 0,
  // Its default is the chain: node 1 reads the dry bus, each later node reads
  // the one before it, and the last node feeds the output.
  [Param.FX_NODE1_IN1]: GRAPH_DRY,
  [Param.FX_NODE2_IN1]: graphNodeSrc(0),
  [Param.FX_NODE3_IN1]: graphNodeSrc(1),
  [Param.FX_NODE4_IN1]: graphNodeSrc(2),
  [Param.FX_NODE5_IN1]: graphNodeSrc(3),
  [Param.FX_NODE6_IN1]: graphNodeSrc(4),
  [Param.FX_NODE1_IN1_GAIN]: 1,
  [Param.FX_NODE2_IN1_GAIN]: 1,
  [Param.FX_NODE3_IN1_GAIN]: 1,
  [Param.FX_NODE4_IN1_GAIN]: 1,
  [Param.FX_NODE5_IN1_GAIN]: 1,
  [Param.FX_NODE6_IN1_GAIN]: 1,
  [Param.FX_NODE1_IN2]: 0,
  [Param.FX_NODE2_IN2]: 0,
  [Param.FX_NODE3_IN2]: 0,
  [Param.FX_NODE4_IN2]: 0,
  [Param.FX_NODE5_IN2]: 0,
  [Param.FX_NODE6_IN2]: 0,
  [Param.FX_NODE1_IN2_GAIN]: 1,
  [Param.FX_NODE2_IN2_GAIN]: 1,
  [Param.FX_NODE3_IN2_GAIN]: 1,
  [Param.FX_NODE4_IN2_GAIN]: 1,
  [Param.FX_NODE5_IN2_GAIN]: 1,
  [Param.FX_NODE6_IN2_GAIN]: 1,
  [Param.FX_NODE1_TO_OUT]: 0,
  [Param.FX_NODE2_TO_OUT]: 0,
  [Param.FX_NODE3_TO_OUT]: 0,
  [Param.FX_NODE4_TO_OUT]: 0,
  [Param.FX_NODE5_TO_OUT]: 0,
  [Param.FX_NODE6_TO_OUT]: 1,
  [Param.FX_NODE1_OUT_GAIN]: 1,
  [Param.FX_NODE2_OUT_GAIN]: 1,
  [Param.FX_NODE3_OUT_GAIN]: 1,
  [Param.FX_NODE4_OUT_GAIN]: 1,
  [Param.FX_NODE5_OUT_GAIN]: 1,
  [Param.FX_NODE6_OUT_GAIN]: 1,
  [Param.MASTER_TUNE]: 0,
  [Param.VOICE_MODE]: 0,
  [Param.FX_CHORUS_ON]: 0,
  [Param.FX_CHORUS_DEPTH]: 0.5,
  [Param.FX_CHORUS_RATE]: 0.6,
  [Param.FX_CHORUS_MIX]: 0.4,
  [Param.FX_FLANGER_ON]: 0,
  [Param.FX_FLANGER_RATE]: 0.3,
  [Param.FX_FLANGER_FB]: 0.5,
  [Param.FX_FLANGER_MIX]: 0.4,
  [Param.FX_PHASER_ON]: 0,
  [Param.FX_PHASER_RATE]: 0.4,
  [Param.FX_PHASER_FB]: 0.6,
  [Param.FX_PHASER_MIX]: 0.5,
  [Param.FX_DRIVE_ON]: 0,
  [Param.FX_DRIVE_AMT]: 0.4,
  [Param.FX_DRIVE_MIX]: 0.6,
  // Both new effects (P6.4) start switched off, so a patch that predates them
  // renders exactly as it did.
  [Param.FX_CRUSH_ON]: 0,
  [Param.FX_CRUSH_BITS]: 8,
  [Param.FX_CRUSH_DOWN]: 4,
  [Param.FX_CRUSH_AA]: 0.5,
  [Param.FX_CRUSH_MIX]: 1,
  [Param.FX_EQ_ON]: 0,
  [Param.FX_EQ_LOW_GAIN]: 0,
  [Param.FX_EQ_LOW_FREQ]: 200,
  [Param.FX_EQ_MID_GAIN]: 0,
  [Param.FX_EQ_MID_FREQ]: 1000,
  [Param.FX_EQ_MID_Q]: 0.9,
  [Param.FX_EQ_HIGH_GAIN]: 0,
  [Param.FX_EQ_HIGH_FREQ]: 4000,
  [Param.FX_EQ_MIX]: 1,
  // P6.5 starts switched off, exactly like the two P6.4 effects: a patch that
  // predates it renders through the same code path it always did.
  [Param.OVERSAMPLE]: 0,
  [Param.FILTER_ENV_ATTACK]: 0.01,
  [Param.FILTER_ENV_DECAY]: 0.3,
  [Param.FILTER_ENV_SUSTAIN]: 0.5,
  [Param.FILTER_ENV_RELEASE]: 0.3,
  [Param.LFO2_ON]: 0,
  [Param.LFO2_WAVE]: 1,
  [Param.LFO2_RATE]: 0.5,
  [Param.LFO2_DEPTH]: 0.3,
  [Param.LFO2_TARGET]: 0,
  [Param.PITCH_BEND_RANGE]: 2,
  [Param.TEMPO]: 120,
  [Param.GLIDE]: 0,

  [Param.OSC1_ON]: 1,
  [Param.OSC1_WAVE]: 2,
  [Param.OSC1_PITCH]: 0,
  [Param.OSC1_DETUNE]: 7,
  [Param.OSC1_LEVEL]: 0.65,
  [Param.OSC1_PW]: 0.5,
  [Param.OSC1_PAN]: 0,

  [Param.OSC2_ON]: 1,
  [Param.OSC2_WAVE]: 2,
  [Param.OSC2_PITCH]: 0,
  [Param.OSC2_DETUNE]: -6,
  [Param.OSC2_LEVEL]: 0.55,
  [Param.OSC2_PW]: 0.5,
  [Param.OSC2_PAN]: 0,

  [Param.FILTER_TYPE]: 0,
  [Param.FILTER_CUTOFF]: 9000,
  [Param.FILTER_RES]: 0.25,
  [Param.FILTER_DRIVE]: 0.15,
  [Param.FILTER_ENV_AMT]: 0.5,
  [Param.FILTER_KBD]: 1,

  [Param.ENV_ATTACK]: 0.003,
  [Param.ENV_DECAY]: 0.16,
  [Param.ENV_SUSTAIN]: 0.55,
  [Param.ENV_RELEASE]: 0.28,

  [Param.LFO_ON]: 1,
  [Param.LFO_WAVE]: 0,
  [Param.LFO_RATE]: 4.6,
  [Param.LFO_DEPTH]: 0.32,
  [Param.LFO_TARGET]: 0,
  [Param.LFO_SYNC]: 0,

  [Param.FX_REVERB_ON]: 1,
  [Param.FX_REVERB_SIZE]: 0.45,
  [Param.FX_REVERB_DAMP]: 0.35,
  [Param.FX_REVERB_WIDTH]: 0.8,
  [Param.FX_REVERB_PREDELAY]: 0.012,
  [Param.OSC1_UNISON]: 1,
  [Param.OSC1_SPREAD]: 0.35,
  [Param.OSC2_UNISON]: 1,
  [Param.OSC2_SPREAD]: 0.35,
  [Param.LFO_RETRIG]: 0,
  [Param.LFO_ONESHOT]: 0,
  [Param.LFO2_RETRIG]: 0,
  [Param.LFO2_ONESHOT]: 0,
  [Param.FX_REVERB_MIX]: 0.25,
  [Param.FX_DELAY_ON]: 0,
  [Param.FX_DELAY_SYNC]: 2,
  [Param.FX_DELAY_FB]: 0.35,
  [Param.FX_DELAY_MIX]: 0.22,
  // No in-graph modulation edge exists until one is drawn (P7.2), and depth 0
  // is the same as none at all.
  [Param.FX_MOD1_SRC]: 0,
  [Param.FX_MOD1_DST]: 0,
  [Param.FX_MOD1_DEPTH]: 0,
  [Param.FX_MOD2_SRC]: 0,
  [Param.FX_MOD2_DST]: 0,
  [Param.FX_MOD2_DEPTH]: 0,
  [Param.FX_MOD3_SRC]: 0,
  [Param.FX_MOD3_DST]: 0,
  [Param.FX_MOD3_DEPTH]: 0,
  [Param.FX_MOD4_SRC]: 0,
  [Param.FX_MOD4_DST]: 0,
  [Param.FX_MOD4_DEPTH]: 0,
};

/**
 * Default patch rows. The engine has `MAX_ROUTES` slots, but a fresh patch only
 * shows the classic four; the rest are added on demand from the matrix panel.
 */
export const DEFAULT_ROUTES: ModRoute[] = [
  { src: 'lfo', dst: 'cutoff', amount: 0.8, enabled: true },
  { src: 'env', dst: 'cutoff', amount: 0.55, enabled: true },
  { src: 'lfo', dst: 'pitch', amount: 0.18, enabled: false },
  { src: 'modwheel', dst: 'cutoff', amount: 0.4, enabled: false },
];

export function createDefaultState(): SynthState {
  return {
    params: { ...DEFAULT_PARAMS },
    params2: { ...DEFAULT_PARAMS },
    routes: DEFAULT_ROUTES.map((r) => ({ ...r })),
    power: true,
  };
}

// ------------------------------------------------------------------ formatting

export const fmt = {
  hz(v: number): string {
    if (v >= 1000) return `${(v / 1000).toFixed(2)} kHz`;
    if (v >= 10) return `${v.toFixed(0)} Hz`;
    return `${v.toFixed(1)} Hz`;
  },
  pct(v: number): string {
    return `${Math.round(v * 100)} %`;
  },
  ms(v: number): string {
    return v >= 1 ? `${v.toFixed(2)} s` : `${Math.round(v * 1000)} ms`;
  },
  st(v: number): string {
    return `${v > 0 ? '+' : ''}${Math.round(v)} st`;
  },
  ct(v: number): string {
    return `${v > 0 ? '+' : ''}${Math.round(v)} ct`;
  },
  /** A filter/EQ gain in dB, signed so a cut reads as one. */
  db(v: number): string {
    return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  },
  bpm(v: number): string {
    return `${Math.round(v)} BPM`;
  },
  sync(v: number): string {
    return DELAY_SYNCS[clamp(Math.round(v), 0, 3)] ?? '1/8';
  },
  pan(v: number): string {
    const n = Math.round(Math.abs(v) * 100);
    if (v < -0.005) return `L${n}`;
    if (v > 0.005) return `R${n}`;
    return 'C';
  },
};

export interface ParamSpec {
  id: ParamId;
  label: string;
  min: number;
  max: number;
  curve?: 'lin' | 'log';
  /** Default value used by double-click reset. */
  def: number;
  format: (v: number) => string;
  /** `true` for on/off and enum parameters: stepped, not ramped. */
  discrete?: boolean;
  /** Excluded from AudioParam automation (events only). */
  hidden?: boolean;
}

const spec = (
  id: ParamId,
  label: string,
  min: number,
  max: number,
  def: number,
  format: (v: number) => string,
  extra: Partial<ParamSpec> = {},
): ParamSpec => ({ id, label, min, max, def, format, ...extra });

/** Knob/slider definitions, shared by the UI and the engine sync. */
export const PARAM_SPECS: ParamSpec[] = [
  spec(Param.OSC1_PITCH, 'PITCH', -24, 24, 0, fmt.st, { discrete: false }),
  spec(Param.OSC1_DETUNE, 'DETUNE', -50, 50, 0, fmt.ct),
  spec(Param.OSC1_LEVEL, 'LEVEL', 0, 1, 0.65, fmt.pct),
  spec(Param.OSC1_PW, 'PW', 0.05, 0.95, 0.5, fmt.pct),
  spec(Param.OSC1_PAN, 'PAN', -1, 1, 0, fmt.pan),
  spec(Param.OSC1_UNISON, 'UNI', 1, 7, 1, (v) => `${Math.round(v)}`, { discrete: true }),
  spec(Param.OSC1_SPREAD, 'SPREAD', 0, 1, 0.35, fmt.pct),
  // How OSC 2 shapes OSC 1: its phase (FM), its amplitude (RING) and its cycle
  // (SYNC, a switch); plus the noise blend and each oscillator's sub.
  spec(Param.OSC_FM, 'FM', 0, 1, 0, fmt.pct),
  spec(Param.OSC_RING, 'RING', 0, 1, 0, fmt.pct),
  spec(Param.OSC1_SYNC, 'SYNC', 0, 1, 0, (v) => (v >= 0.5 ? 'ON' : 'OFF'), { discrete: true }),
  spec(Param.NOISE_MIX, 'NOISE', 0, 1, 0, fmt.pct),
  spec(Param.OSC1_SUB, 'SUB', 0, 2, 0, (v) => (v < 0.5 ? 'OFF' : `-${Math.round(v)}`), { discrete: true }),
  spec(Param.OSC1_SUB_LEVEL, 'SUB LVL', 0, 1, 0.4, fmt.pct),
  spec(Param.OSC2_SUB, 'SUB', 0, 2, 0, (v) => (v < 0.5 ? 'OFF' : `-${Math.round(v)}`), { discrete: true }),
  spec(Param.OSC2_SUB_LEVEL, 'SUB LVL', 0, 1, 0.4, fmt.pct),
  spec(Param.OSC2_PITCH, 'PITCH', -24, 24, 0, fmt.st),
  spec(Param.OSC2_DETUNE, 'DETUNE', -50, 50, 0, fmt.ct),
  spec(Param.OSC2_LEVEL, 'LEVEL', 0, 1, 0.55, fmt.pct),
  spec(Param.OSC2_PW, 'PW', 0.05, 0.95, 0.5, fmt.pct),
  spec(Param.OSC2_PAN, 'PAN', -1, 1, 0, fmt.pan),
  spec(Param.OSC2_UNISON, 'UNI', 1, 7, 1, (v) => `${Math.round(v)}`, { discrete: true }),
  spec(Param.OSC2_SPREAD, 'SPREAD', 0, 1, 0.35, fmt.pct),
  spec(Param.FILTER_CUTOFF, 'CUTOFF', 40, 18000, 9000, fmt.hz, { curve: 'log' }),
  spec(Param.FILTER_RES, 'RES', 0, 1, 0.25, fmt.pct),
  spec(Param.FILTER_DRIVE, 'DRIVE', 0, 1, 0.15, fmt.pct),
  spec(Param.FILTER_ENV_AMT, 'ENV AMT', 0, 1, 0.5, fmt.pct),
  // Only the `sem` type reads this; on every other type the knob is hidden.
  spec(Param.FILTER_MORPH, 'MORPH', 0, 1, 0, fmt.pct),
  // The second stage (P6.3b). Its type and routing are segments, not knobs.
  spec(Param.FILTER2_CUTOFF, 'CUTOFF 2', 40, 18000, 9000, fmt.hz, { curve: 'log' }),
  spec(Param.FILTER2_RES, 'RES 2', 0, 1, 0.25, fmt.pct),
  spec(Param.FILTER2_DRIVE, 'DRIVE 2', 0, 1, 0.15, fmt.pct),
  spec(Param.FILTER_BLEND, 'BLEND', 0, 1, 0.5, fmt.pct),
  spec(Param.ENV_ATTACK, 'ATTACK', 0.0005, 8, 0.003, fmt.ms, { curve: 'log' }),
  spec(Param.ENV_DECAY, 'DECAY', 0.001, 12, 0.16, fmt.ms, { curve: 'log' }),
  spec(Param.ENV_SUSTAIN, 'SUSTAIN', 0, 1, 0.55, fmt.pct),
  spec(Param.ENV_RELEASE, 'RELEASE', 0.005, 16, 0.28, fmt.ms, { curve: 'log' }),
  spec(Param.LFO_RATE, 'RATE', 0.02, 40, 4.6, (v) => `${v.toFixed(2)} Hz`, { curve: 'log' }),
  spec(Param.LFO_DEPTH, 'DEPTH', 0, 1, 0.32, fmt.pct),
  spec(Param.FX_REVERB_SIZE, 'SIZE', 0, 1, 0.45, fmt.pct),
  spec(Param.FX_REVERB_MIX, 'MIX', 0, 1, 0.25, fmt.pct),
  spec(Param.FX_REVERB_DAMP, 'DAMP', 0, 1, 0.35, fmt.pct),
  spec(Param.FX_REVERB_WIDTH, 'WIDTH', 0, 1, 0.8, fmt.pct),
  spec(Param.FX_REVERB_PREDELAY, 'PRE', 0, 0.1, 0.012, (v) => `${Math.round(v * 1000)} ms`),
  spec(Param.FX_CONV_TRIM, 'TRIM', 0, 4, 1, (v) => `${v.toFixed(2)}×`),
  spec(Param.SMP_ROOT, 'ROOT', 0, 127, 60, (v) => NOTE_NAMES[Math.round(v) % 12] + (Math.floor(v / 12) - 1), {
    discrete: true,
  }),
  spec(Param.SMP_LOOP_START, 'LOOP A', 0, 1, 0, fmt.pct),
  spec(Param.SMP_LOOP_END, 'LOOP B', 0, 1, 1, fmt.pct),
  spec(Param.FX_DELAY_FB, 'FDBK', 0, 0.9, 0.35, fmt.pct),
  spec(Param.FX_DELAY_MIX, 'MIX', 0, 1, 0.22, fmt.pct),
  spec(Param.FX_DELAY_DAMP, 'DAMP', 0, 1, 0.35, fmt.pct),
  spec(Param.FILTER_ENV_ATTACK, 'ATTACK', 0.0005, 8, 0.01, fmt.ms, { curve: 'log' }),
  spec(Param.FILTER_ENV_DECAY, 'DECAY', 0.001, 12, 0.3, fmt.ms, { curve: 'log' }),
  spec(Param.FILTER_ENV_SUSTAIN, 'SUSTAIN', 0, 1, 0.5, fmt.pct),
  spec(Param.FILTER_ENV_RELEASE, 'RELEASE', 0.005, 16, 0.3, fmt.ms, { curve: 'log' }),
  spec(Param.LFO2_RATE, 'RATE', 0.02, 40, 0.5, (v) => `${v.toFixed(2)} Hz`, { curve: 'log' }),
  spec(Param.LFO2_DEPTH, 'DEPTH', 0, 1, 0.3, fmt.pct),
  spec(Param.FX_CHORUS_DEPTH, 'DEPTH', 0, 1, 0.5, fmt.pct),
  spec(Param.FX_CHORUS_RATE, 'RATE', 0.02, 10, 0.6, (v) => `${v.toFixed(2)} Hz`, { curve: 'log' }),
  spec(Param.FX_CHORUS_MIX, 'MIX', 0, 1, 0.4, fmt.pct),
  spec(Param.FX_FLANGER_RATE, 'RATE', 0.02, 10, 0.3, (v) => `${v.toFixed(2)} Hz`, { curve: 'log' }),
  spec(Param.FX_FLANGER_FB, 'FDBK', 0, 0.95, 0.5, fmt.pct),
  spec(Param.FX_FLANGER_MIX, 'MIX', 0, 1, 0.4, fmt.pct),
  spec(Param.FX_PHASER_RATE, 'RATE', 0.02, 10, 0.4, (v) => `${v.toFixed(2)} Hz`, { curve: 'log' }),
  spec(Param.FX_PHASER_FB, 'FDBK', 0, 0.95, 0.6, fmt.pct),
  spec(Param.FX_PHASER_MIX, 'MIX', 0, 1, 0.5, fmt.pct),
  spec(Param.FX_DRIVE_AMT, 'DRIVE', 0, 1, 0.4, fmt.pct),
  spec(Param.FX_DRIVE_MIX, 'MIX', 0, 1, 0.6, fmt.pct),
  // Bit-crusher and shaping EQ (P6.4). Both are inserts with their own mix.
  spec(Param.FX_CRUSH_BITS, 'BITS', 4, 16, 8, (v) => `${Math.round(v)} bit`, { discrete: true }),
  spec(Param.FX_CRUSH_DOWN, 'DOWN', 1, 64, 4, (v) => `${Math.round(v)}×`, { discrete: true }),
  spec(Param.FX_CRUSH_AA, 'AA', 0, 1, 0.5, fmt.pct),
  spec(Param.FX_CRUSH_MIX, 'MIX', 0, 1, 1, fmt.pct),
  spec(Param.FX_EQ_LOW_GAIN, 'LOW', -18, 18, 0, fmt.db),
  spec(Param.FX_EQ_LOW_FREQ, 'LOW F', 40, 1000, 200, fmt.hz, { curve: 'log' }),
  spec(Param.FX_EQ_MID_GAIN, 'MID', -18, 18, 0, fmt.db),
  spec(Param.FX_EQ_MID_FREQ, 'MID F', 200, 8000, 1000, fmt.hz, { curve: 'log' }),
  spec(Param.FX_EQ_MID_Q, 'MID Q', 0.3, 6, 0.9, (v) => v.toFixed(2), { curve: 'log' }),
  spec(Param.FX_EQ_HIGH_GAIN, 'HIGH', -18, 18, 0, fmt.db),
  spec(Param.FX_EQ_HIGH_FREQ, 'HIGH F', 1000, 16000, 4000, fmt.hz, { curve: 'log' }),
  spec(Param.FX_EQ_MIX, 'MIX', 0, 1, 1, fmt.pct),
  // A stepped switch, so it is not offered as a MIDI CC target.
  spec(Param.OVERSAMPLE, '2×', 0, 1, 0, (v) => (v >= 0.5 ? 'ON' : 'OFF'), {
    discrete: true,
  }),
  spec(Param.GLIDE, 'GLIDE', 0, 1, 0, fmt.pct),
  spec(Param.MASTER_VOLUME, 'VOLUME', 0, 1, 0.75, fmt.pct),
];

export const SPEC_BY_ID: Record<number, ParamSpec> = Object.fromEntries(
  PARAM_SPECS.map((s) => [s.id, s]),
);
