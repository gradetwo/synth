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
} as const;

export type ParamId = (typeof Param)[keyof typeof Param];

/** AudioParam name for every parameter id (used by the worklet + UI). */
export const PARAM_NAMES: Record<ParamId, string> = {
  [Param.MASTER_VOLUME]: 'masterVolume',
  [Param.PATCH_GAIN]: 'patchGain',
  [Param.WT_USER]: 'wtUser',
  [Param.FX_DELAY_DAMP]: 'fxDelayDamp',
  [Param.FX_DELAY_PINGPONG]: 'fxDelayPingpong',
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
  | 'wavetable';
export type FilterType = 'lp' | 'hp' | 'bp' | 'nt' | 'comb' | 'formant';
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
export type ModDst = 'cutoff' | 'pitch' | 'volume' | 'pwm' | 'pan' | 'res';
export type DelaySync = '1/4' | '1/8.' | '1/8' | '1/16';

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
};
export const FILTER_TYPES: FilterType[] = ['lp', 'hp', 'bp', 'nt', 'comb', 'formant'];
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
export const MOD_DESTS: ModDst[] = ['cutoff', 'pitch', 'volume', 'pwm', 'pan', 'res'];
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
};
export const DELAY_SYNCS: DelaySync[] = ['1/4', '1/8.', '1/8', '1/16'];

export interface ModRoute {
  src: ModSrc;
  dst: ModDst;
  amount: number;
  enabled: boolean;
}

export interface SynthState {
  /** Every DSP parameter, keyed by `Param`. */
  params: Record<number, number>;
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
  // Per-patch loudness trim (presets set it; see `PATCH_TRIM` in state/presets).
  [Param.PATCH_GAIN]: 1,
  // Factory banks by default; the player flips this after importing a cycle.
  [Param.WT_USER]: 0,
  [Param.FX_DELAY_DAMP]: 0.35,
  [Param.FX_DELAY_PINGPONG]: 0,
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
  spec(Param.GLIDE, 'GLIDE', 0, 1, 0, fmt.pct),
  spec(Param.MASTER_VOLUME, 'VOLUME', 0, 1, 0.75, fmt.pct),
];

export const SPEC_BY_ID: Record<number, ParamSpec> = Object.fromEntries(
  PARAM_SPECS.map((s) => [s.id, s]),
);
