/**
 * Factory preset library.
 *
 * A preset is a sparse parameter overlay on `DEFAULT_PARAMS`, so adding a preset
 * never duplicates the full parameter set and future parameters keep working.
 */

import {
  DEFAULT_PARAMS,
  DEFAULT_ROUTES,
  Param,
  type ModRoute,
  type Wave,
} from '@/audio/params';

export type PresetCategory =
  | 'ALL'
  | 'LEAD'
  | 'BASS'
  | 'PAD'
  | 'PLUCK'
  | 'KEYS'
  | 'FX'
  | 'BASIC'
  | 'USER';

export const PRESET_CATEGORIES: PresetCategory[] = [
  'ALL',
  'LEAD',
  'BASS',
  'PAD',
  'PLUCK',
  'KEYS',
  'FX',
  'BASIC',
  'USER',
];

export interface Preset {
  id: string;
  name: string;
  tag: string;
  cat: Exclude<PresetCategory, 'ALL'>;
  wave: Wave;
  params: Partial<Record<number, number>>;
  routes?: ModRoute[];
  user?: boolean;
}

const P = Param;

/** Envelope shorthand for compact preset definitions. */
const envP = (a: number, d: number, s: number, r: number) => ({
  [P.ENV_ATTACK]: a,
  [P.ENV_DECAY]: d,
  [P.ENV_SUSTAIN]: s,
  [P.ENV_RELEASE]: r,
});

/** Sparse helper: only the parameters that differ from the default patch. */
const preset = (
  id: string,
  name: string,
  tag: string,
  cat: Preset['cat'],
  wave: Wave,
  params: Partial<Record<number, number>>,
  routes?: ModRoute[],
): Preset => ({ id, name, tag, cat, wave, params, routes });

export const FACTORY_PRESETS: Preset[] = [
  preset(
    'pluck',
    'Crystal Pluck · 晶体拨弦',
    'FUTURE BASS',
    'PLUCK',
    'triangle',
    {
      [P.OSC1_ON]: 1, [P.OSC1_WAVE]: 1, [P.OSC1_PITCH]: 0, [P.OSC1_DETUNE]: 0, [P.OSC1_LEVEL]: 0.7,
      [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 4, [P.OSC2_PITCH]: 0, [P.OSC2_DETUNE]: 9, [P.OSC2_LEVEL]: 0.35,
      [P.FILTER_TYPE]: 0, [P.FILTER_CUTOFF]: 5200, [P.FILTER_RES]: 0.35, [P.FILTER_DRIVE]: 0.12,
      [P.FILTER_ENV_AMT]: 0.65, [P.FILTER_KBD]: 1,
      [P.ENV_ATTACK]: 0.001, [P.ENV_DECAY]: 0.13, [P.ENV_SUSTAIN]: 0, [P.ENV_RELEASE]: 0.24,
      [P.LFO_ON]: 1, [P.LFO_WAVE]: 0, [P.LFO_RATE]: 5.2, [P.LFO_DEPTH]: 0.3, [P.LFO_TARGET]: 0,
      [P.FX_REVERB_ON]: 1, [P.FX_REVERB_SIZE]: 0.4, [P.FX_REVERB_MIX]: 0.3,
      [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 2, [P.FX_DELAY_FB]: 0.3, [P.FX_DELAY_MIX]: 0.22,
    },
  ),
  preset(
    'fbsaw',
    'Future Saw Lead · 未来锯齿',
    'FUTURE BASS',
    'LEAD',
    'saw',
    {
      [P.OSC1_WAVE]: 2, [P.OSC1_DETUNE]: 7, [P.OSC1_LEVEL]: 0.6,
      [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_DETUNE]: -6, [P.OSC2_LEVEL]: 0.55,
      [P.FILTER_CUTOFF]: 9000, [P.FILTER_RES]: 0.25, [P.FILTER_DRIVE]: 0.2, [P.FILTER_ENV_AMT]: 0.5,
      [P.ENV_ATTACK]: 0.003, [P.ENV_DECAY]: 0.18, [P.ENV_SUSTAIN]: 0.6, [P.ENV_RELEASE]: 0.3,
      [P.LFO_RATE]: 4.6, [P.LFO_DEPTH]: 0.32,
      [P.FX_REVERB_SIZE]: 0.5, [P.FX_REVERB_MIX]: 0.25,
      [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 1, [P.FX_DELAY_FB]: 0.35, [P.FX_DELAY_MIX]: 0.2,
    },
  ),
  preset('acid', 'Acid 303 · 酸性贝斯', 'ACID HOUSE', 'BASS', 'saw', {
    [P.OSC1_WAVE]: 2, [P.OSC1_PITCH]: -12, [P.OSC1_LEVEL]: 0.8,
    [P.OSC2_ON]: 0, [P.OSC2_WAVE]: 3, [P.OSC2_PITCH]: -12, [P.OSC2_LEVEL]: 0.2,
    [P.FILTER_CUTOFF]: 800, [P.FILTER_RES]: 0.85, [P.FILTER_DRIVE]: 0.55, [P.FILTER_ENV_AMT]: 0.75,
    [P.FILTER_KBD]: 0,
    [P.ENV_ATTACK]: 0.002, [P.ENV_DECAY]: 0.14, [P.ENV_SUSTAIN]: 0.2, [P.ENV_RELEASE]: 0.12,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_ON]: 0, [P.FX_REVERB_MIX]: 0.1, [P.FX_DELAY_ON]: 0,
  }),
  preset('pad', 'Warm Analog Pad · 模拟铺底', 'DEEP HOUSE', 'PAD', 'triangle', {
    [P.OSC1_WAVE]: 1, [P.OSC1_DETUNE]: 5, [P.OSC1_LEVEL]: 0.55,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 1, [P.OSC2_DETUNE]: -5, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 3200, [P.FILTER_RES]: 0.15, [P.FILTER_DRIVE]: 0.08, [P.FILTER_ENV_AMT]: 0.3,
    [P.FILTER_KBD]: 0,
    [P.ENV_ATTACK]: 1.1, [P.ENV_DECAY]: 1.2, [P.ENV_SUSTAIN]: 0.85, [P.ENV_RELEASE]: 2.2,
    [P.LFO_RATE]: 0.6, [P.LFO_DEPTH]: 0.25,
    [P.FX_REVERB_SIZE]: 0.75, [P.FX_REVERB_MIX]: 0.45,
  }),
  preset('sub', 'Pulse Sub Bass · 脉冲超低', 'TECHNO', 'BASS', 'pulse', {
    [P.OSC1_WAVE]: 4, [P.OSC1_PITCH]: -12, [P.OSC1_LEVEL]: 0.8,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 3, [P.OSC2_PITCH]: -12, [P.OSC2_DETUNE]: 4, [P.OSC2_LEVEL]: 0.3,
    [P.FILTER_CUTOFF]: 420, [P.FILTER_RES]: 0.2, [P.FILTER_DRIVE]: 0.25, [P.FILTER_ENV_AMT]: 0.4,
    [P.ENV_ATTACK]: 0.002, [P.ENV_DECAY]: 0.1, [P.ENV_SUSTAIN]: 0.9, [P.ENV_RELEASE]: 0.16,
    [P.LFO_ON]: 0, [P.LFO_TARGET]: 2,
    [P.FX_REVERB_ON]: 0, [P.FX_REVERB_MIX]: 0.05, [P.FX_DELAY_ON]: 0,
  }),
  preset('bell', 'Digital Bell · 数字铃音', 'MELODIC', 'KEYS', 'sine', {
    [P.OSC1_WAVE]: 0, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 0, [P.OSC2_PITCH]: 12, [P.OSC2_DETUNE]: 3, [P.OSC2_LEVEL]: 0.45,
    [P.FILTER_CUTOFF]: 14000, [P.FILTER_RES]: 0.1, [P.FILTER_DRIVE]: 0, [P.FILTER_ENV_AMT]: 0.2,
    [P.ENV_ATTACK]: 0.001, [P.ENV_DECAY]: 0.9, [P.ENV_SUSTAIN]: 0.08, [P.ENV_RELEASE]: 1.6,
    [P.LFO_ON]: 0, [P.LFO_TARGET]: 1,
    [P.FX_REVERB_SIZE]: 0.7, [P.FX_REVERB_MIX]: 0.5, [P.FX_DELAY_ON]: 0,
  }),
  preset('trem', 'Auto Tremolo · 自动颤音', 'CHILLWAVE', 'FX', 'square', {
    [P.OSC1_WAVE]: 3, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 0, [P.OSC2_WAVE]: 0, [P.OSC2_LEVEL]: 0.3,
    [P.FILTER_CUTOFF]: 6500, [P.FILTER_RES]: 0.2, [P.FILTER_DRIVE]: 0.1, [P.FILTER_ENV_AMT]: 0.3,
    [P.ENV_ATTACK]: 0.01, [P.ENV_DECAY]: 0.3, [P.ENV_SUSTAIN]: 0.8, [P.ENV_RELEASE]: 0.4,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 6.2, [P.LFO_DEPTH]: 0.85, [P.LFO_TARGET]: 2,
    [P.FX_REVERB_SIZE]: 0.5, [P.FX_REVERB_MIX]: 0.35,
  }),
  preset('init', 'INIT · 初始正弦', 'BASIC', 'BASIC', 'sine', {
    [P.OSC1_WAVE]: 0, [P.OSC1_DETUNE]: 0, [P.OSC1_LEVEL]: 0.8,
    [P.OSC2_ON]: 0, [P.OSC2_WAVE]: 0, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 18000, [P.FILTER_RES]: 0.05, [P.FILTER_DRIVE]: 0, [P.FILTER_ENV_AMT]: 0,
    [P.FILTER_KBD]: 0,
    [P.ENV_ATTACK]: 0.002, [P.ENV_DECAY]: 0.2, [P.ENV_SUSTAIN]: 0.8, [P.ENV_RELEASE]: 0.3,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_ON]: 0, [P.FX_REVERB_MIX]: 0.1, [P.FX_DELAY_ON]: 0,
  }),

  preset('neon', 'Neon Pluck · 霓虹拨弦', 'SYNTHWAVE', 'PLUCK', 'square', {
    [P.OSC1_WAVE]: 3, [P.OSC1_DETUNE]: 0, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: 12, [P.OSC2_DETUNE]: -8, [P.OSC2_LEVEL]: 0.35,
    [P.FILTER_CUTOFF]: 7000, [P.FILTER_RES]: 0.45, [P.FILTER_DRIVE]: 0.2, [P.FILTER_ENV_AMT]: 0.7,
    [P.ENV_ATTACK]: 0.001, [P.ENV_DECAY]: 0.22, [P.ENV_SUSTAIN]: 0.15, [P.ENV_RELEASE]: 0.4,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 3.1, [P.LFO_DEPTH]: 0.4,
    [P.FX_REVERB_MIX]: 0.3, [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 3, [P.FX_DELAY_MIX]: 0.25,
  }),
  preset('stab', 'Deep House Stab · 深宅和弦', 'DEEP HOUSE', 'LEAD', 'saw', {
    [P.OSC1_WAVE]: 2, [P.OSC1_DETUNE]: 12, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 3, [P.OSC2_DETUNE]: -10, [P.OSC2_LEVEL]: 0.4,
    [P.FILTER_CUTOFF]: 2600, [P.FILTER_RES]: 0.3, [P.FILTER_DRIVE]: 0.3, [P.FILTER_ENV_AMT]: 0.6,
    [P.ENV_ATTACK]: 0.005, [P.ENV_DECAY]: 0.25, [P.ENV_SUSTAIN]: 0.3, [P.ENV_RELEASE]: 0.3,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_MIX]: 0.2, [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 1, [P.FX_DELAY_MIX]: 0.2,
  }),
  preset('gate', 'Trance Gate Lead · 迷幻闸门', 'TRANCE', 'LEAD', 'saw', {
    [P.OSC1_WAVE]: 2, [P.OSC1_DETUNE]: 14, [P.OSC1_LEVEL]: 0.65,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_DETUNE]: -14, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 11000, [P.FILTER_RES]: 0.2, [P.FILTER_DRIVE]: 0.25, [P.FILTER_ENV_AMT]: 0.4,
    [P.ENV_ATTACK]: 0.01, [P.ENV_DECAY]: 0.2, [P.ENV_SUSTAIN]: 0.75, [P.ENV_RELEASE]: 0.25,
    [P.LFO_ON]: 1, [P.LFO_WAVE]: 2, [P.LFO_RATE]: 8, [P.LFO_DEPTH]: 1, [P.LFO_TARGET]: 2,
    [P.FX_REVERB_MIX]: 0.25, [P.FX_DELAY_ON]: 1, [P.FX_DELAY_MIX]: 0.25,
  }),
  preset('drift', 'Ambient Drift · 氛围漂移', 'AMBIENT', 'PAD', 'noise', {
    [P.OSC1_WAVE]: 1, [P.OSC1_DETUNE]: 8, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 5, [P.OSC2_LEVEL]: 0.12,
    [P.FILTER_CUTOFF]: 1800, [P.FILTER_RES]: 0.25, [P.FILTER_DRIVE]: 0, [P.FILTER_ENV_AMT]: 0.2,
    [P.ENV_ATTACK]: 2.4, [P.ENV_DECAY]: 3, [P.ENV_SUSTAIN]: 0.9, [P.ENV_RELEASE]: 5,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.12, [P.LFO_DEPTH]: 0.55,
    [P.FX_REVERB_ON]: 1, [P.FX_REVERB_SIZE]: 0.95, [P.FX_REVERB_MIX]: 0.6,
  }),
  preset('hardbass', 'Hard Bass · 硬核低音', 'HARD DANCE', 'BASS', 'saw', {
    [P.OSC1_WAVE]: 2, [P.OSC1_PITCH]: -12, [P.OSC1_LEVEL]: 0.85,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 3, [P.OSC2_PITCH]: -12, [P.OSC2_DETUNE]: 6, [P.OSC2_LEVEL]: 0.35,
    [P.FILTER_CUTOFF]: 900, [P.FILTER_RES]: 0.5, [P.FILTER_DRIVE]: 0.7, [P.FILTER_ENV_AMT]: 0.8,
    [P.ENV_ATTACK]: 0.001, [P.ENV_DECAY]: 0.12, [P.ENV_SUSTAIN]: 0.35, [P.ENV_RELEASE]: 0.1,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_ON]: 0, [P.FX_DELAY_ON]: 0,
  }),
  preset('lofi', 'Lo-Fi Keys · 低保真键盘', 'LO-FI', 'KEYS', 'triangle', {
    [P.OSC1_WAVE]: 1, [P.OSC1_DETUNE]: 4, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 0, [P.OSC2_PITCH]: 12, [P.OSC2_LEVEL]: 0.25,
    [P.FILTER_CUTOFF]: 2400, [P.FILTER_RES]: 0.1, [P.FILTER_DRIVE]: 0.35, [P.FILTER_ENV_AMT]: 0.25,
    [P.ENV_ATTACK]: 0.01, [P.ENV_DECAY]: 0.6, [P.ENV_SUSTAIN]: 0.4, [P.ENV_RELEASE]: 0.8,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.35, [P.LFO_DEPTH]: 0.18, [P.LFO_TARGET]: 3,
    [P.FX_REVERB_MIX]: 0.35,
  }),
  preset('sync', 'Sync Lead · 同步主音', 'ELECTRO', 'LEAD', 'pulse', {
    [P.OSC1_WAVE]: 4, [P.OSC1_PW]: 0.25, [P.OSC1_LEVEL]: 0.75,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: 7, [P.OSC2_LEVEL]: 0.4,
    [P.FILTER_CUTOFF]: 8500, [P.FILTER_RES]: 0.35, [P.FILTER_DRIVE]: 0.3, [P.FILTER_ENV_AMT]: 0.5,
    [P.ENV_ATTACK]: 0.002, [P.ENV_DECAY]: 0.18, [P.ENV_SUSTAIN]: 0.55, [P.ENV_RELEASE]: 0.2,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 5.5, [P.LFO_DEPTH]: 0.45, [P.LFO_TARGET]: 3,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_MIX]: 0.3,
  }),
  preset('widepad', 'Detuned Wide Pad · 宽幅铺底', 'PROGRESSIVE', 'PAD', 'saw', {
    [P.OSC1_WAVE]: 2, [P.OSC1_DETUNE]: 18, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_DETUNE]: -18, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 4200, [P.FILTER_RES]: 0.18, [P.FILTER_DRIVE]: 0.1, [P.FILTER_ENV_AMT]: 0.35,
    [P.ENV_ATTACK]: 0.8, [P.ENV_DECAY]: 1.4, [P.ENV_SUSTAIN]: 0.8, [P.ENV_RELEASE]: 2.6,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.28, [P.LFO_DEPTH]: 0.3,
    [P.FX_REVERB_SIZE]: 0.8, [P.FX_REVERB_MIX]: 0.4,
  }),

  // ---- expanded library (v1.0.8) ----
  preset('supersaw', 'Supersaw Anthem · 超级锯', 'TRANCE', 'LEAD', 'saw', {
    ...envP(0.01, 0.3, 0.85, 0.4),
    [P.OSC1_WAVE]: 2, [P.OSC1_DETUNE]: 18, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_DETUNE]: -18, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 12000, [P.FILTER_RES]: 0.2, [P.FILTER_DRIVE]: 0.25, [P.FILTER_ENV_AMT]: 0.35,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.2, [P.LFO_DEPTH]: 0.2,
    [P.FX_REVERB_MIX]: 0.35, [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 2, [P.FX_DELAY_MIX]: 0.3,
  }),
  preset('hoover', 'Hoover Stab · 吸尘器主音', 'HARDCORE', 'LEAD', 'saw', {
    ...envP(0.005, 0.25, 0.4, 0.25),
    [P.OSC1_WAVE]: 2, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: -12, [P.OSC2_DETUNE]: 20, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 3500, [P.FILTER_RES]: 0.45, [P.FILTER_DRIVE]: 0.5, [P.FILTER_ENV_AMT]: 0.6,
    [P.LFO_ON]: 1, [P.LFO_WAVE]: 1, [P.LFO_RATE]: 5.5, [P.LFO_DEPTH]: 0.5, [P.LFO_TARGET]: 1,
    [P.FX_REVERB_MIX]: 0.25,
  }),
  preset('squarelead', 'Retro Square Lead · 复古方波', 'CHIPTUNE', 'LEAD', 'square', {
    ...envP(0.002, 0.1, 0.7, 0.15),
    [P.OSC1_WAVE]: 3, [P.OSC1_LEVEL]: 0.7, [P.OSC1_PW]: 0.5,
    [P.OSC2_ON]: 0,
    [P.FILTER_CUTOFF]: 9000, [P.FILTER_RES]: 0.1, [P.FILTER_DRIVE]: 0, [P.FILTER_ENV_AMT]: 0.2,
    [P.LFO_ON]: 0,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 3, [P.FX_DELAY_MIX]: 0.2,
  }),
  preset('hardlead', 'Hard Dance Lead · 硬舞主音', 'HARD DANCE', 'LEAD', 'saw', {
    ...envP(0.002, 0.2, 0.75, 0.2),
    [P.OSC1_WAVE]: 2, [P.OSC1_DETUNE]: 14, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_DETUNE]: -14, [P.OSC2_LEVEL]: 0.55,
    [P.FILTER_CUTOFF]: 10500, [P.FILTER_RES]: 0.25, [P.FILTER_DRIVE]: 0.4, [P.FILTER_ENV_AMT]: 0.4,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 5, [P.LFO_DEPTH]: 0.25,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 2, [P.FX_DELAY_MIX]: 0.2,
  }),
  preset('reese', 'Reese Bass · 里斯贝斯', 'DnB', 'BASS', 'saw', {
    ...envP(0.01, 0.4, 0.9, 0.25),
    [P.OSC1_WAVE]: 2, [P.OSC1_PITCH]: -12, [P.OSC1_DETUNE]: 22, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: -12, [P.OSC2_DETUNE]: -22, [P.OSC2_LEVEL]: 0.7,
    [P.FILTER_CUTOFF]: 1200, [P.FILTER_RES]: 0.3, [P.FILTER_DRIVE]: 0.35, [P.FILTER_ENV_AMT]: 0.2,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.3, [P.LFO_DEPTH]: 0.15,
    [P.FX_REVERB_ON]: 0, [P.FX_DELAY_ON]: 0,
  }),
  preset('wobble', 'Wobble Bass · 摇摆贝斯', 'DUBSTEP', 'BASS', 'saw', {
    ...envP(0.01, 0.3, 0.85, 0.2),
    [P.OSC1_WAVE]: 2, [P.OSC1_PITCH]: -12, [P.OSC1_LEVEL]: 0.8,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: -12, [P.OSC2_DETUNE]: 12, [P.OSC2_LEVEL]: 0.4,
    [P.FILTER_CUTOFF]: 600, [P.FILTER_RES]: 0.55, [P.FILTER_DRIVE]: 0.5, [P.FILTER_ENV_AMT]: 0.3,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 3, [P.LFO_DEPTH]: 0.9, [P.LFO_TARGET]: 0,
    [P.FX_REVERB_ON]: 0, [P.FX_DELAY_ON]: 0,
  }),
  preset('fmbass', 'FM Growl Bass · FM 咆哮贝斯', 'DUBSTEP', 'BASS', 'saw', {
    ...envP(0.002, 0.18, 0.3, 0.12),
    [P.OSC1_WAVE]: 2, [P.OSC1_PITCH]: -12, [P.OSC1_LEVEL]: 0.8,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 3, [P.OSC2_PITCH]: -24, [P.OSC2_DETUNE]: 8, [P.OSC2_LEVEL]: 0.4,
    [P.FILTER_CUTOFF]: 700, [P.FILTER_RES]: 0.6, [P.FILTER_DRIVE]: 0.6, [P.FILTER_ENV_AMT]: 0.8,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 2.2, [P.LFO_DEPTH]: 0.5,
    [P.FX_REVERB_ON]: 0, [P.FX_DELAY_ON]: 0,
  }),
  preset('sub808', '808 Sub · 808 超低音', 'TRAP', 'BASS', 'sine', {
    ...envP(0.002, 0.6, 0, 0.4),
    [P.OSC1_WAVE]: 0, [P.OSC1_PITCH]: -12, [P.OSC1_LEVEL]: 0.9,
    [P.OSC2_ON]: 0,
    [P.FILTER_CUTOFF]: 400, [P.FILTER_RES]: 0.1, [P.FILTER_DRIVE]: 0.1, [P.FILTER_ENV_AMT]: 0.1,
    [P.LFO_ON]: 0, [P.FX_REVERB_ON]: 0, [P.FX_DELAY_ON]: 0,
  }),
  preset('voxpad', 'Choir Pad · 人声铺底', 'AMBIENT', 'PAD', 'triangle', {
    ...envP(1.2, 1.5, 0.85, 3),
    [P.OSC1_WAVE]: 1, [P.OSC1_DETUNE]: 10, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 1, [P.OSC2_DETUNE]: -10, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 2600, [P.FILTER_RES]: 0.2, [P.FILTER_DRIVE]: 0.05, [P.FILTER_ENV_AMT]: 0.25,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.18, [P.LFO_DEPTH]: 0.3, [P.LFO_TARGET]: 3,
    [P.FX_REVERB_SIZE]: 0.85, [P.FX_REVERB_MIX]: 0.55,
  }),
  preset('glasspad', 'Glass Pad · 玻璃铺底', 'CINEMATIC', 'PAD', 'sine', {
    ...envP(0.8, 1.2, 0.8, 2.4),
    [P.OSC1_WAVE]: 0, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 0, [P.OSC2_PITCH]: 12, [P.OSC2_DETUNE]: 4, [P.OSC2_LEVEL]: 0.4,
    [P.FILTER_CUTOFF]: 6000, [P.FILTER_RES]: 0.15, [P.FILTER_ENV_AMT]: 0.2,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.25, [P.LFO_DEPTH]: 0.25,
    [P.FX_REVERB_SIZE]: 0.8, [P.FX_REVERB_MIX]: 0.5,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 0, [P.FX_DELAY_MIX]: 0.2,
  }),
  preset('darkpad', 'Dark Pad · 暗色铺底', 'TECHNO', 'PAD', 'saw', {
    ...envP(1.5, 2, 0.7, 4),
    [P.OSC1_WAVE]: 2, [P.OSC1_DETUNE]: 8, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 3, [P.OSC2_PITCH]: -12, [P.OSC2_LEVEL]: 0.35,
    [P.FILTER_CUTOFF]: 1400, [P.FILTER_RES]: 0.35, [P.FILTER_DRIVE]: 0.2, [P.FILTER_ENV_AMT]: 0.3,
    [P.LFO_ON]: 1, [P.LFO_WAVE]: 1, [P.LFO_RATE]: 0.12, [P.LFO_DEPTH]: 0.4,
    [P.FX_REVERB_SIZE]: 0.8, [P.FX_REVERB_MIX]: 0.5,
  }),
  preset('marimba', 'Marimba · 马林巴', 'WORLD', 'PLUCK', 'sine', {
    ...envP(0.001, 0.35, 0, 0.5),
    [P.OSC1_WAVE]: 0, [P.OSC1_LEVEL]: 0.8,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 0, [P.OSC2_PITCH]: 12, [P.OSC2_DETUNE]: 2, [P.OSC2_LEVEL]: 0.3,
    [P.FILTER_CUTOFF]: 5000, [P.FILTER_RES]: 0.1, [P.FILTER_ENV_AMT]: 0.4,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_SIZE]: 0.4, [P.FX_REVERB_MIX]: 0.3, [P.FX_DELAY_ON]: 0,
  }),
  preset('koto', 'Koto Pluck · 古筝拨弦', 'WORLD', 'PLUCK', 'triangle', {
    ...envP(0.001, 0.5, 0, 0.6),
    [P.OSC1_WAVE]: 1, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: 12, [P.OSC2_LEVEL]: 0.2,
    [P.FILTER_CUTOFF]: 4200, [P.FILTER_RES]: 0.3, [P.FILTER_DRIVE]: 0.1, [P.FILTER_ENV_AMT]: 0.5,
    [P.LFO_ON]: 0,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 2, [P.FX_DELAY_MIX]: 0.25,
  }),
  preset('pluckstack', 'Stacked Pluck · 叠加拨弦', 'FUTURE BASS', 'PLUCK', 'saw', {
    ...envP(0.001, 0.2, 0.05, 0.35),
    [P.OSC1_WAVE]: 2, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 3, [P.OSC2_PITCH]: 12, [P.OSC2_DETUNE]: 8, [P.OSC2_LEVEL]: 0.4,
    [P.FILTER_CUTOFF]: 6500, [P.FILTER_RES]: 0.4, [P.FILTER_DRIVE]: 0.25, [P.FILTER_ENV_AMT]: 0.7,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 4, [P.LFO_DEPTH]: 0.25,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 2, [P.FX_DELAY_MIX]: 0.25, [P.FX_REVERB_MIX]: 0.3,
  }),
  preset('epiano', 'Electric Piano · 电钢', 'CHILL', 'KEYS', 'sine', {
    ...envP(0.003, 0.9, 0.25, 1.1),
    [P.OSC1_WAVE]: 0, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 1, [P.OSC2_PITCH]: 12, [P.OSC2_LEVEL]: 0.3,
    [P.FILTER_CUTOFF]: 4500, [P.FILTER_RES]: 0.12, [P.FILTER_DRIVE]: 0.2, [P.FILTER_ENV_AMT]: 0.35,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_SIZE]: 0.4, [P.FX_REVERB_MIX]: 0.3,
  }),
  preset('organ', 'Drawbar Organ · 拉杆风琴', 'GOSPEL', 'KEYS', 'square', {
    ...envP(0.005, 0.05, 1, 0.08),
    [P.OSC1_WAVE]: 3, [P.OSC1_LEVEL]: 0.5, [P.OSC1_PW]: 0.5,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 3, [P.OSC2_PITCH]: 12, [P.OSC2_LEVEL]: 0.4,
    [P.FILTER_CUTOFF]: 8000, [P.FILTER_RES]: 0.05, [P.FILTER_ENV_AMT]: 0,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 6.5, [P.LFO_DEPTH]: 0.12, [P.LFO_TARGET]: 1,
    [P.FX_REVERB_MIX]: 0.25,
  }),
  preset('clav', 'Funk Clav · 放克克拉维', 'FUNK', 'KEYS', 'square', {
    ...envP(0.001, 0.25, 0.15, 0.15),
    [P.OSC1_WAVE]: 3, [P.OSC1_PW]: 0.35, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 0,
    [P.FILTER_TYPE]: 2, [P.FILTER_CUTOFF]: 1800, [P.FILTER_RES]: 0.5, [P.FILTER_DRIVE]: 0.3, [P.FILTER_ENV_AMT]: 0.6,
    [P.LFO_ON]: 0,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 3, [P.FX_DELAY_MIX]: 0.2,
  }),
  preset('glasskeys', 'Glass Keys · 玻璃键盘', 'MELODIC', 'KEYS', 'sine', {
    ...envP(0.002, 0.8, 0.05, 1.2),
    [P.OSC1_WAVE]: 0, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 0, [P.OSC2_PITCH]: 19, [P.OSC2_DETUNE]: 3, [P.OSC2_LEVEL]: 0.25,
    [P.FILTER_CUTOFF]: 11000, [P.FILTER_RES]: 0.1, [P.FILTER_ENV_AMT]: 0.2,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_SIZE]: 0.7, [P.FX_REVERB_MIX]: 0.45,
  }),
  preset('crystalbell', 'Crystal Bell · 水晶铃', 'MELODIC', 'KEYS', 'sine', {
    ...envP(0.001, 1.4, 0, 2),
    [P.OSC1_WAVE]: 0, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 0, [P.OSC2_PITCH]: 24, [P.OSC2_DETUNE]: 6, [P.OSC2_LEVEL]: 0.25,
    [P.FILTER_CUTOFF]: 16000, [P.FILTER_RES]: 0.05, [P.FILTER_ENV_AMT]: 0,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_SIZE]: 0.85, [P.FX_REVERB_MIX]: 0.6,
  }),
  preset('riser', 'Noise Riser · 噪声上升', 'TRANSITION', 'FX', 'noise', {
    ...envP(2.5, 0.1, 1, 0.5),
    [P.OSC1_WAVE]: 5, [P.OSC1_LEVEL]: 0.6,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: 12, [P.OSC2_LEVEL]: 0.2,
    [P.FILTER_CUTOFF]: 800, [P.FILTER_RES]: 0.4, [P.FILTER_DRIVE]: 0.2, [P.FILTER_ENV_AMT]: 0.9,
    [P.LFO_ON]: 1, [P.LFO_WAVE]: 1, [P.LFO_RATE]: 0.3, [P.LFO_DEPTH]: 0.5,
    [P.FX_REVERB_SIZE]: 0.7, [P.FX_REVERB_MIX]: 0.5,
  }),
  preset('drone', 'Dark Drone · 暗黑长音', 'AMBIENT', 'FX', 'saw', {
    ...envP(3, 3, 1, 5),
    [P.OSC1_WAVE]: 2, [P.OSC1_PITCH]: -12, [P.OSC1_DETUNE]: 6, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 1, [P.OSC2_WAVE]: 2, [P.OSC2_PITCH]: -12, [P.OSC2_DETUNE]: -6, [P.OSC2_LEVEL]: 0.5,
    [P.FILTER_CUTOFF]: 900, [P.FILTER_RES]: 0.4, [P.FILTER_DRIVE]: 0.15, [P.FILTER_ENV_AMT]: 0.2,
    [P.LFO_ON]: 1, [P.LFO_RATE]: 0.07, [P.LFO_DEPTH]: 0.5,
    [P.FX_REVERB_SIZE]: 0.9, [P.FX_REVERB_MIX]: 0.6,
  }),
  preset('siren', 'Siren · 警笛', 'SFX', 'FX', 'square', {
    ...envP(0.01, 0.1, 0.9, 0.2),
    [P.OSC1_WAVE]: 3, [P.OSC1_LEVEL]: 0.5,
    [P.OSC2_ON]: 0,
    [P.FILTER_TYPE]: 1, [P.FILTER_CUTOFF]: 400, [P.FILTER_RES]: 0.2, [P.FILTER_ENV_AMT]: 0,
    [P.LFO_ON]: 1, [P.LFO_WAVE]: 1, [P.LFO_RATE]: 1.2, [P.LFO_DEPTH]: 1, [P.LFO_TARGET]: 1,
    [P.FX_DELAY_ON]: 1, [P.FX_DELAY_SYNC]: 0, [P.FX_DELAY_MIX]: 0.3,
  }),
  preset('sinelead', 'Pure Sine Lead · 纯正弦主音', 'BASIC', 'BASIC', 'sine', {
    ...envP(0.01, 0.2, 0.8, 0.3),
    [P.OSC1_WAVE]: 0, [P.OSC1_LEVEL]: 0.8,
    [P.OSC2_ON]: 0,
    [P.FILTER_CUTOFF]: 18000, [P.FILTER_RES]: 0.05, [P.FILTER_ENV_AMT]: 0,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_MIX]: 0.2,
  }),
  preset('sawinit', 'Saw Init · 锯齿初始', 'BASIC', 'BASIC', 'saw', {
    ...envP(0.005, 0.25, 0.7, 0.3),
    [P.OSC1_WAVE]: 2, [P.OSC1_LEVEL]: 0.7,
    [P.OSC2_ON]: 0,
    [P.FILTER_CUTOFF]: 12000, [P.FILTER_RES]: 0.2, [P.FILTER_DRIVE]: 0.1, [P.FILTER_ENV_AMT]: 0.2,
    [P.LFO_ON]: 0,
    [P.FX_REVERB_ON]: 0, [P.FX_DELAY_ON]: 0,
  }),
];

/** Merge a preset over the default patch (returns a fresh parameter record). */
export function presetParams(preset: Preset): Record<number, number> {
  const merged: Record<number, number> = { ...DEFAULT_PARAMS };
  for (const [id, value] of Object.entries(preset.params)) {
    if (typeof value === 'number') merged[Number(id)] = value;
  }
  return merged;
}

export function presetRoutes(preset: Preset): ModRoute[] {
  return (preset.routes ?? DEFAULT_ROUTES).map((r) => ({ ...r }));
}
