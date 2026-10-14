/**
 * Factory preset library.
 *
 * A preset is a sparse parameter overlay on `DEFAULT_PARAMS`, so adding a preset
 * never duplicates the full parameter set and future parameters keep working.
 */

import { Param, type ModRoute, type Wave } from '@/audio/params';
import type { Preset } from './preset-model';

// The model lives in `preset-model.ts` so the first screen and the drawer shell
// can render a category chip, merge a preset or name the boot patch without
// fetching this table (see the note there). Re-exported here because this is
// still where a preset comes from.
export { PRESET_CATEGORIES, presetParams, presetRoutes, type Preset, type PresetCategory } from './preset-model';

const P = Param;

/**
 * Envelope shorthand. Returns the four pairs in the same flat `id, value` form
 * the preset table uses, so an envelope costs one spread instead of an object.
 */
const envP = (a: number, d: number, s: number, r: number): number[] => [
  P.ENV_ATTACK, a, P.ENV_DECAY, d, P.ENV_SUSTAIN, s, P.ENV_RELEASE, r,
];

/**
 * Sparse helper: only the parameters that differ from the default patch.
 *
 * The pairs arrive as a flat `id, value, id, value …` list rather than an
 * object literal. The table is ~1 300 pairs and the brackets, colons and
 * repeated `P.` keys of an object cost several kilobytes in the first-screen
 * chunk for no runtime difference; the list is also where each patch's measured
 * loudness trim lives, as `PATCH_GAIN`, so it cannot fall out of step with the
 * patch it belongs to.
 */
const preset = (
  id: string,
  name: string,
  tag: string,
  cat: Preset['cat'],
  wave: Wave,
  pairs: readonly number[],
  routes?: ModRoute[],
): Preset => {
  const params: Partial<Record<number, number>> = {};
  for (let index = 0; index < pairs.length; index += 2) params[pairs[index]] = pairs[index + 1];
  return { id, name, tag, cat, wave, params, routes };
};

export const FACTORY_PRESETS: Preset[] = [
  preset(
    'pluck',
    'Crystal Pluck · 晶体拨弦',
    'FUTURE BASS',
    'PLUCK',
    'triangle',
    [
      P.OSC1_WAVE, 1, P.OSC1_DETUNE, 0, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 4, P.OSC2_DETUNE, 9,
      P.OSC2_LEVEL, 0.35, P.FILTER_CUTOFF, 5200, P.FILTER_RES, 0.35, P.FILTER_DRIVE, 0.12,
      P.FILTER_ENV_AMT, 0.65, P.ENV_ATTACK, 0.001, P.ENV_DECAY, 0.13, P.ENV_SUSTAIN, 0,
      P.ENV_RELEASE, 0.24, P.LFO_RATE, 5.2, P.LFO_DEPTH, 0.3, P.FX_REVERB_SIZE, 0.4,
      P.FX_REVERB_MIX, 0.3, P.FX_DELAY_ON, 1, P.FX_DELAY_FB, 0.3, P.PATCH_GAIN, 3.862,
    ],
  ),
  preset(
    'fbsaw',
    'Future Saw Lead · 未来锯齿',
    'FUTURE BASS',
    'LEAD',
    'saw',
    [
      P.OSC1_LEVEL, 0.6, P.FILTER_DRIVE, 0.2, P.ENV_DECAY, 0.18, P.ENV_SUSTAIN, 0.6,
      P.ENV_RELEASE, 0.3, P.FX_REVERB_SIZE, 0.5, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1,
      P.FX_DELAY_MIX, 0.2, P.PATCH_GAIN, 0.698,
    ],
  ),
  preset('acid', 'Acid 303 · 酸性贝斯', 'ACID HOUSE', 'BASS', 'saw', [
      P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 0, P.OSC2_WAVE, 3, P.OSC2_PITCH, -12,
      P.OSC2_LEVEL, 0.2, P.FILTER_CUTOFF, 800, P.FILTER_RES, 0.85, P.FILTER_DRIVE, 0.55,
      P.FILTER_ENV_AMT, 0.75, P.FILTER_KBD, 0, P.ENV_ATTACK, 0.002, P.ENV_DECAY, 0.14,
      P.ENV_SUSTAIN, 0.2, P.ENV_RELEASE, 0.12, P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.FX_REVERB_MIX, 0.1,
      P.PATCH_GAIN, 2.81,
    ]),
  preset('pad', 'Warm Analog Pad · 模拟铺底', 'DEEP HOUSE', 'PAD', 'triangle', [
      P.OSC1_WAVE, 1, P.OSC1_DETUNE, 5, P.OSC1_LEVEL, 0.55, P.OSC2_WAVE, 1, P.OSC2_DETUNE, -5,
      P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 3200, P.FILTER_RES, 0.15, P.FILTER_DRIVE, 0.08,
      P.FILTER_ENV_AMT, 0.3, P.FILTER_KBD, 0, P.ENV_ATTACK, 1.1, P.ENV_DECAY, 1.2, P.ENV_SUSTAIN, 0.85,
      P.ENV_RELEASE, 2.2, P.LFO_RATE, 0.6, P.LFO_DEPTH, 0.25, P.FX_REVERB_SIZE, 0.75,
      P.FX_REVERB_MIX, 0.45, P.PATCH_GAIN, 0.866,
    ]),
  preset('sub', 'Pulse Sub Bass · 脉冲超低', 'TECHNO', 'BASS', 'pulse', [
      P.OSC1_WAVE, 4, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_WAVE, 3, P.OSC2_PITCH, -12,
      P.OSC2_DETUNE, 4, P.OSC2_LEVEL, 0.3, P.FILTER_CUTOFF, 420, P.FILTER_RES, 0.2,
      P.FILTER_DRIVE, 0.25, P.FILTER_ENV_AMT, 0.4, P.ENV_ATTACK, 0.002, P.ENV_DECAY, 0.1,
      P.ENV_SUSTAIN, 0.9, P.ENV_RELEASE, 0.16, P.LFO_ON, 0, P.LFO_TARGET, 2, P.FX_REVERB_ON, 0,
      P.FX_REVERB_MIX, 0.05, P.PATCH_GAIN, 0.29,
    ]),
  preset('bell', 'Digital Bell · 数字铃音', 'MELODIC', 'KEYS', 'sine', [
      P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 0, P.OSC2_PITCH, 12, P.OSC2_DETUNE, 3,
      P.OSC2_LEVEL, 0.45, P.FILTER_CUTOFF, 14000, P.FILTER_RES, 0.1, P.FILTER_DRIVE, 0,
      P.FILTER_ENV_AMT, 0.2, P.ENV_ATTACK, 0.001, P.ENV_DECAY, 0.9, P.ENV_SUSTAIN, 0.08,
      P.ENV_RELEASE, 1.6, P.LFO_ON, 0, P.LFO_TARGET, 1, P.FX_REVERB_SIZE, 0.7, P.FX_REVERB_MIX, 0.5,
      P.PATCH_GAIN, 0.969,
    ]),
  preset('trem', 'Auto Tremolo · 自动颤音', 'CHILLWAVE', 'FX', 'square', [
      P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.5, P.OSC2_ON, 0, P.OSC2_WAVE, 0, P.OSC2_LEVEL, 0.3,
      P.FILTER_CUTOFF, 6500, P.FILTER_RES, 0.2, P.FILTER_DRIVE, 0.1, P.FILTER_ENV_AMT, 0.3,
      P.ENV_ATTACK, 0.01, P.ENV_DECAY, 0.3, P.ENV_SUSTAIN, 0.8, P.ENV_RELEASE, 0.4, P.LFO_RATE, 6.2,
      P.LFO_DEPTH, 0.85, P.LFO_TARGET, 2, P.FX_REVERB_SIZE, 0.5, P.FX_REVERB_MIX, 0.35,
      P.PATCH_GAIN, 1.078,
    ]),
  preset('init', 'INIT · 初始正弦', 'BASIC', 'BASIC', 'sine', [
      P.OSC1_WAVE, 0, P.OSC1_DETUNE, 0, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 0, P.OSC2_WAVE, 0,
      P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 18000, P.FILTER_RES, 0.05, P.FILTER_DRIVE, 0,
      P.FILTER_ENV_AMT, 0, P.FILTER_KBD, 0, P.ENV_ATTACK, 0.002, P.ENV_DECAY, 0.2, P.ENV_SUSTAIN, 0.8,
      P.ENV_RELEASE, 0.3, P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.FX_REVERB_MIX, 0.1, P.PATCH_GAIN, 0.193,
    ]),

  preset('neon', 'Neon Pluck · 霓虹拨弦', 'SYNTHWAVE', 'PLUCK', 'square', [
      P.OSC1_WAVE, 3, P.OSC1_DETUNE, 0, P.OSC1_LEVEL, 0.7, P.OSC2_PITCH, 12, P.OSC2_DETUNE, -8,
      P.OSC2_LEVEL, 0.35, P.FILTER_CUTOFF, 7000, P.FILTER_RES, 0.45, P.FILTER_DRIVE, 0.2,
      P.FILTER_ENV_AMT, 0.7, P.ENV_ATTACK, 0.001, P.ENV_DECAY, 0.22, P.ENV_SUSTAIN, 0.15,
      P.ENV_RELEASE, 0.4, P.LFO_RATE, 3.1, P.LFO_DEPTH, 0.4, P.FX_REVERB_MIX, 0.3, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 3, P.FX_DELAY_MIX, 0.25, P.PATCH_GAIN, 2.3,
    ]),
  preset('stab', 'Deep House Stab · 深宅和弦', 'DEEP HOUSE', 'LEAD', 'saw', [
      P.OSC1_DETUNE, 12, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 3, P.OSC2_DETUNE, -10, P.OSC2_LEVEL, 0.4,
      P.FILTER_CUTOFF, 2600, P.FILTER_RES, 0.3, P.FILTER_DRIVE, 0.3, P.FILTER_ENV_AMT, 0.6,
      P.ENV_ATTACK, 0.005, P.ENV_DECAY, 0.25, P.ENV_SUSTAIN, 0.3, P.ENV_RELEASE, 0.3, P.LFO_ON, 0,
      P.FX_REVERB_MIX, 0.2, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1, P.FX_DELAY_MIX, 0.2,
      P.PATCH_GAIN, 1.3,
    ]),
  preset('gate', 'Trance Gate Lead · 迷幻闸门', 'TRANCE', 'LEAD', 'saw', [
      P.OSC1_DETUNE, 14, P.OSC2_DETUNE, -14, P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 11000,
      P.FILTER_RES, 0.2, P.FILTER_DRIVE, 0.25, P.FILTER_ENV_AMT, 0.4, P.ENV_ATTACK, 0.01,
      P.ENV_DECAY, 0.2, P.ENV_SUSTAIN, 0.75, P.ENV_RELEASE, 0.25, P.LFO_WAVE, 2, P.LFO_RATE, 8,
      P.LFO_DEPTH, 1, P.LFO_TARGET, 2, P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.25, P.PATCH_GAIN, 0.674,
    ]),
  preset('drift', 'Ambient Drift · 氛围漂移', 'AMBIENT', 'PAD', 'noise', [
      P.OSC1_WAVE, 1, P.OSC1_DETUNE, 8, P.OSC1_LEVEL, 0.5, P.OSC2_WAVE, 5, P.OSC2_LEVEL, 0.12,
      P.FILTER_CUTOFF, 1800, P.FILTER_DRIVE, 0, P.FILTER_ENV_AMT, 0.2, P.ENV_ATTACK, 2.4,
      P.ENV_DECAY, 3, P.ENV_SUSTAIN, 0.9, P.ENV_RELEASE, 5, P.LFO_RATE, 0.12, P.LFO_DEPTH, 0.55,
      P.FX_REVERB_SIZE, 0.95, P.FX_REVERB_MIX, 0.6, P.PATCH_GAIN, 3.554,
    ]),
  preset('hardbass', 'Hard Bass · 硬核低音', 'HARD DANCE', 'BASS', 'saw', [
      P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.85, P.OSC2_WAVE, 3, P.OSC2_PITCH, -12, P.OSC2_DETUNE, 6,
      P.OSC2_LEVEL, 0.35, P.FILTER_CUTOFF, 900, P.FILTER_RES, 0.5, P.FILTER_DRIVE, 0.7,
      P.FILTER_ENV_AMT, 0.8, P.ENV_ATTACK, 0.001, P.ENV_DECAY, 0.12, P.ENV_SUSTAIN, 0.35,
      P.ENV_RELEASE, 0.1, P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 1.267,
    ]),
  preset('lofi', 'Lo-Fi Keys · 低保真键盘', 'LO-FI', 'KEYS', 'triangle', [
      P.OSC1_WAVE, 1, P.OSC1_DETUNE, 4, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 0, P.OSC2_PITCH, 12,
      P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 2400, P.FILTER_RES, 0.1, P.FILTER_DRIVE, 0.35,
      P.FILTER_ENV_AMT, 0.25, P.ENV_ATTACK, 0.01, P.ENV_DECAY, 0.6, P.ENV_SUSTAIN, 0.4,
      P.ENV_RELEASE, 0.8, P.LFO_RATE, 0.35, P.LFO_DEPTH, 0.18, P.LFO_TARGET, 3, P.FX_REVERB_MIX, 0.35,
      P.PATCH_GAIN, 0.815,
    ]),
  preset('sync', 'Sync Lead · 同步主音', 'ELECTRO', 'LEAD', 'pulse', [
      P.OSC1_WAVE, 4, P.OSC1_PW, 0.25, P.OSC1_LEVEL, 0.75, P.OSC2_PITCH, 7, P.OSC2_LEVEL, 0.4,
      P.FILTER_CUTOFF, 8500, P.FILTER_RES, 0.35, P.FILTER_DRIVE, 0.3, P.ENV_ATTACK, 0.002,
      P.ENV_DECAY, 0.18, P.ENV_RELEASE, 0.2, P.LFO_RATE, 5.5, P.LFO_DEPTH, 0.45, P.LFO_TARGET, 3,
      P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.3, P.PATCH_GAIN, 0.76,
    ]),
  preset('widepad', 'Detuned Wide Pad · 宽幅铺底', 'PROGRESSIVE', 'PAD', 'saw', [
      P.OSC1_DETUNE, 18, P.OSC1_LEVEL, 0.5, P.OSC2_DETUNE, -18, P.OSC2_LEVEL, 0.5,
      P.FILTER_CUTOFF, 4200, P.FILTER_RES, 0.18, P.FILTER_DRIVE, 0.1, P.FILTER_ENV_AMT, 0.35,
      P.ENV_ATTACK, 0.8, P.ENV_DECAY, 1.4, P.ENV_SUSTAIN, 0.8, P.ENV_RELEASE, 2.6, P.LFO_RATE, 0.28,
      P.LFO_DEPTH, 0.3, P.FX_REVERB_SIZE, 0.8, P.FX_REVERB_MIX, 0.4, P.PATCH_GAIN, 0.799,
    ]),

  // ---- expanded library (v1.0.8) ----
  preset('supersaw', 'Supersaw Anthem · 超级锯', 'TRANCE', 'LEAD', 'saw', [
      ...envP(0.01, 0.3, 0.85, 0.4), P.OSC1_DETUNE, 18, P.OSC1_LEVEL, 0.5, P.OSC2_DETUNE, -18,
      P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 12000, P.FILTER_RES, 0.2, P.FILTER_DRIVE, 0.25,
      P.FILTER_ENV_AMT, 0.35, P.LFO_RATE, 0.2, P.LFO_DEPTH, 0.2, P.FX_REVERB_MIX, 0.35,
      P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.3, P.PATCH_GAIN, 0.605,
    ]),
  preset('hoover', 'Hoover Stab · 吸尘器主音', 'HARDCORE', 'LEAD', 'saw', [
      ...envP(0.005, 0.25, 0.4, 0.25), P.OSC1_LEVEL, 0.6, P.OSC2_PITCH, -12, P.OSC2_DETUNE, 20,
      P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 3500, P.FILTER_RES, 0.45, P.FILTER_DRIVE, 0.5,
      P.FILTER_ENV_AMT, 0.6, P.LFO_WAVE, 1, P.LFO_RATE, 5.5, P.LFO_DEPTH, 0.5, P.LFO_TARGET, 1,
      P.PATCH_GAIN, 1.418,
    ]),
  preset('squarelead', 'Retro Square Lead · 复古方波', 'CHIPTUNE', 'LEAD', 'square', [
      ...envP(0.002, 0.1, 0.7, 0.15), P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.7, P.OSC2_ON, 0,
      P.FILTER_RES, 0.1, P.FILTER_DRIVE, 0, P.FILTER_ENV_AMT, 0.2, P.LFO_ON, 0, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 3, P.FX_DELAY_MIX, 0.2, P.PATCH_GAIN, 0.392,
    ]),
  preset('hardlead', 'Hard Dance Lead · 硬舞主音', 'HARD DANCE', 'LEAD', 'saw', [
      ...envP(0.002, 0.2, 0.75, 0.2), P.OSC1_DETUNE, 14, P.OSC1_LEVEL, 0.6, P.OSC2_DETUNE, -14,
      P.FILTER_CUTOFF, 10500, P.FILTER_DRIVE, 0.4, P.FILTER_ENV_AMT, 0.4, P.LFO_RATE, 5,
      P.LFO_DEPTH, 0.25, P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.2, P.PATCH_GAIN, 0.566,
    ]),
  preset('reese', 'Reese Bass · 里斯贝斯', 'DnB', 'BASS', 'saw', [
      ...envP(0.01, 0.4, 0.9, 0.25), P.OSC1_PITCH, -12, P.OSC1_DETUNE, 22, P.OSC1_LEVEL, 0.7,
      P.OSC2_PITCH, -12, P.OSC2_DETUNE, -22, P.OSC2_LEVEL, 0.7, P.FILTER_CUTOFF, 1200,
      P.FILTER_RES, 0.3, P.FILTER_DRIVE, 0.35, P.FILTER_ENV_AMT, 0.2, P.LFO_RATE, 0.3,
      P.LFO_DEPTH, 0.15, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.353,
    ]),
  preset('wobble', 'Wobble Bass · 摇摆贝斯', 'DUBSTEP', 'BASS', 'saw', [
      ...envP(0.01, 0.3, 0.85, 0.2), P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_PITCH, -12,
      P.OSC2_DETUNE, 12, P.OSC2_LEVEL, 0.4, P.FILTER_CUTOFF, 600, P.FILTER_RES, 0.55,
      P.FILTER_DRIVE, 0.5, P.FILTER_ENV_AMT, 0.3, P.LFO_RATE, 3, P.LFO_DEPTH, 0.9, P.FX_REVERB_ON, 0,
      P.PATCH_GAIN, 0.585,
    ]),
  preset('fmbass', 'FM Growl Bass · FM 咆哮贝斯', 'DUBSTEP', 'BASS', 'saw', [
      ...envP(0.002, 0.18, 0.3, 0.12), P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_WAVE, 3,
      P.OSC2_PITCH, -24, P.OSC2_DETUNE, 8, P.OSC2_LEVEL, 0.4, P.FILTER_CUTOFF, 700, P.FILTER_RES, 0.6,
      P.FILTER_DRIVE, 0.6, P.FILTER_ENV_AMT, 0.8, P.LFO_RATE, 2.2, P.LFO_DEPTH, 0.5, P.FX_REVERB_ON, 0,
      P.PATCH_GAIN, 1.147,
    ]),
  preset('sub808', '808 Sub · 808 超低音', 'TRAP', 'BASS', 'sine', [
      ...envP(0.002, 0.6, 0, 0.4), P.OSC1_WAVE, 0, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.9, P.OSC2_ON, 0,
      P.FILTER_CUTOFF, 400, P.FILTER_RES, 0.1, P.FILTER_DRIVE, 0.1, P.FILTER_ENV_AMT, 0.1, P.LFO_ON, 0,
      P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.638,
    ]),
  preset('voxpad', 'Choir Pad · 人声铺底', 'AMBIENT', 'PAD', 'triangle', [
      ...envP(1.2, 1.5, 0.85, 3), P.OSC1_WAVE, 1, P.OSC1_DETUNE, 10, P.OSC1_LEVEL, 0.5, P.OSC2_WAVE, 1,
      P.OSC2_DETUNE, -10, P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 2600, P.FILTER_RES, 0.2,
      P.FILTER_DRIVE, 0.05, P.FILTER_ENV_AMT, 0.25, P.LFO_RATE, 0.18, P.LFO_DEPTH, 0.3,
      P.LFO_TARGET, 3, P.FX_REVERB_SIZE, 0.85, P.FX_REVERB_MIX, 0.55, P.PATCH_GAIN, 1.279,
    ]),
  preset('glasspad', 'Glass Pad · 玻璃铺底', 'CINEMATIC', 'PAD', 'sine', [
      ...envP(0.8, 1.2, 0.8, 2.4), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 0, P.OSC2_PITCH, 12,
      P.OSC2_DETUNE, 4, P.OSC2_LEVEL, 0.4, P.FILTER_CUTOFF, 6000, P.FILTER_RES, 0.15,
      P.FILTER_ENV_AMT, 0.2, P.LFO_RATE, 0.25, P.LFO_DEPTH, 0.25, P.FX_REVERB_SIZE, 0.8,
      P.FX_REVERB_MIX, 0.5, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 0, P.FX_DELAY_MIX, 0.2,
      P.PATCH_GAIN, 0.667,
    ]),
  preset('darkpad', 'Dark Pad · 暗色铺底', 'TECHNO', 'PAD', 'saw', [
      ...envP(1.5, 2, 0.7, 4), P.OSC1_DETUNE, 8, P.OSC1_LEVEL, 0.5, P.OSC2_WAVE, 3, P.OSC2_PITCH, -12,
      P.OSC2_LEVEL, 0.35, P.FILTER_CUTOFF, 1400, P.FILTER_RES, 0.35, P.FILTER_DRIVE, 0.2,
      P.FILTER_ENV_AMT, 0.3, P.LFO_WAVE, 1, P.LFO_RATE, 0.12, P.LFO_DEPTH, 0.4, P.FX_REVERB_SIZE, 0.8,
      P.FX_REVERB_MIX, 0.5, P.PATCH_GAIN, 1.808,
    ]),
  preset('marimba', 'Marimba · 马林巴', 'WORLD', 'PLUCK', 'sine', [
      ...envP(0.001, 0.35, 0, 0.5), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.8, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 12, P.OSC2_DETUNE, 2, P.OSC2_LEVEL, 0.3, P.FILTER_CUTOFF, 5000, P.FILTER_RES, 0.1,
      P.FILTER_ENV_AMT, 0.4, P.LFO_ON, 0, P.FX_REVERB_SIZE, 0.4, P.FX_REVERB_MIX, 0.3,
      P.PATCH_GAIN, 1.26,
    ]),
  preset('koto', 'Koto Pluck · 古筝拨弦', 'WORLD', 'PLUCK', 'triangle', [
      ...envP(0.001, 0.5, 0, 0.6), P.OSC1_WAVE, 1, P.OSC1_LEVEL, 0.7, P.OSC2_PITCH, 12,
      P.OSC2_LEVEL, 0.2, P.FILTER_CUTOFF, 4200, P.FILTER_RES, 0.3, P.FILTER_DRIVE, 0.1, P.LFO_ON, 0,
      P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.25, P.PATCH_GAIN, 2.136,
    ]),
  preset('pluckstack', 'Stacked Pluck · 叠加拨弦', 'FUTURE BASS', 'PLUCK', 'saw', [
      ...envP(0.001, 0.2, 0.05, 0.35), P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 3, P.OSC2_PITCH, 12,
      P.OSC2_DETUNE, 8, P.OSC2_LEVEL, 0.4, P.FILTER_CUTOFF, 6500, P.FILTER_RES, 0.4,
      P.FILTER_DRIVE, 0.25, P.FILTER_ENV_AMT, 0.7, P.LFO_RATE, 4, P.LFO_DEPTH, 0.25, P.FX_DELAY_ON, 1,
      P.FX_DELAY_MIX, 0.25, P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 3.668,
    ]),
  preset('epiano', 'Electric Piano · 电钢', 'CHILL', 'KEYS', 'sine', [
      ...envP(0.003, 0.9, 0.25, 1.1), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 1,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.3, P.FILTER_CUTOFF, 4500, P.FILTER_RES, 0.12,
      P.FILTER_DRIVE, 0.2, P.FILTER_ENV_AMT, 0.35, P.LFO_ON, 0, P.FX_REVERB_SIZE, 0.4,
      P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 0.664,
    ]),
  preset('organ', 'Drawbar Organ · 拉杆风琴', 'GOSPEL', 'KEYS', 'square', [
      ...envP(0.005, 0.05, 1, 0.08), P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.5, P.OSC2_WAVE, 3,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.4, P.FILTER_CUTOFF, 8000, P.FILTER_RES, 0.05,
      P.FILTER_ENV_AMT, 0, P.LFO_RATE, 6.5, P.LFO_DEPTH, 0.12, P.LFO_TARGET, 1, P.PATCH_GAIN, 0.28,
    ]),
  preset('clav', 'Funk Clav · 放克克拉维', 'FUNK', 'KEYS', 'square', [
      ...envP(0.001, 0.25, 0.15, 0.15), P.OSC1_WAVE, 3, P.OSC1_PW, 0.35, P.OSC1_LEVEL, 0.7,
      P.OSC2_ON, 0, P.FILTER_TYPE, 2, P.FILTER_CUTOFF, 1800, P.FILTER_RES, 0.5, P.FILTER_DRIVE, 0.3,
      P.FILTER_ENV_AMT, 0.6, P.LFO_ON, 0, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 3, P.FX_DELAY_MIX, 0.2,
      P.PATCH_GAIN, 4.503,
    ]),
  preset('glasskeys', 'Glass Keys · 玻璃键盘', 'MELODIC', 'KEYS', 'sine', [
      ...envP(0.002, 0.8, 0.05, 1.2), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 19, P.OSC2_DETUNE, 3, P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 11000,
      P.FILTER_RES, 0.1, P.FILTER_ENV_AMT, 0.2, P.LFO_ON, 0, P.FX_REVERB_SIZE, 0.7,
      P.FX_REVERB_MIX, 0.45, P.PATCH_GAIN, 1.134,
    ]),
  preset('crystalbell', 'Crystal Bell · 水晶铃', 'MELODIC', 'KEYS', 'sine', [
      ...envP(0.001, 1.4, 0, 2), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 0, P.OSC2_PITCH, 24,
      P.OSC2_DETUNE, 6, P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 16000, P.FILTER_RES, 0.05,
      P.FILTER_ENV_AMT, 0, P.LFO_ON, 0, P.FX_REVERB_SIZE, 0.85, P.FX_REVERB_MIX, 0.6,
      P.PATCH_GAIN, 1.2,
    ]),
  preset('riser', 'Noise Riser · 噪声上升', 'TRANSITION', 'FX', 'noise', [
      ...envP(2.5, 0.1, 1, 0.5), P.OSC1_WAVE, 5, P.OSC1_LEVEL, 0.6, P.OSC2_PITCH, 12,
      P.OSC2_LEVEL, 0.2, P.FILTER_CUTOFF, 800, P.FILTER_RES, 0.4, P.FILTER_DRIVE, 0.2,
      P.FILTER_ENV_AMT, 0.9, P.LFO_WAVE, 1, P.LFO_RATE, 0.3, P.LFO_DEPTH, 0.5, P.FX_REVERB_SIZE, 0.7,
      P.FX_REVERB_MIX, 0.5, P.PATCH_GAIN, 7.664,
    ]),
  preset('drone', 'Dark Drone · 暗黑长音', 'AMBIENT', 'FX', 'saw', [
      ...envP(3, 3, 1, 5), P.OSC1_PITCH, -12, P.OSC1_DETUNE, 6, P.OSC1_LEVEL, 0.5, P.OSC2_PITCH, -12,
      P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 900, P.FILTER_RES, 0.4, P.FILTER_ENV_AMT, 0.2,
      P.LFO_RATE, 0.07, P.LFO_DEPTH, 0.5, P.FX_REVERB_SIZE, 0.9, P.FX_REVERB_MIX, 0.6,
      P.PATCH_GAIN, 3.987,
    ]),
  preset('siren', 'Siren · 警笛', 'SFX', 'FX', 'square', [
      ...envP(0.01, 0.1, 0.9, 0.2), P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.5, P.OSC2_ON, 0, P.FILTER_TYPE, 1,
      P.FILTER_CUTOFF, 400, P.FILTER_RES, 0.2, P.FILTER_ENV_AMT, 0, P.LFO_WAVE, 1, P.LFO_RATE, 1.2,
      P.LFO_DEPTH, 1, P.LFO_TARGET, 1, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 0, P.FX_DELAY_MIX, 0.3,
      P.PATCH_GAIN, 0.49,
    ]),
  preset('sinelead', 'Pure Sine Lead · 纯正弦主音', 'BASIC', 'BASIC', 'sine', [
      ...envP(0.01, 0.2, 0.8, 0.3), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 0,
      P.FILTER_CUTOFF, 18000, P.FILTER_RES, 0.05, P.FILTER_ENV_AMT, 0, P.LFO_ON, 0,
      P.FX_REVERB_MIX, 0.2, P.PATCH_GAIN, 0.25,
    ]),
  preset('sawinit', 'Saw Init · 锯齿初始', 'BASIC', 'BASIC', 'saw', [
      ...envP(0.005, 0.25, 0.7, 0.3), P.OSC1_LEVEL, 0.7, P.OSC2_ON, 0, P.FILTER_CUTOFF, 12000,
      P.FILTER_RES, 0.2, P.FILTER_DRIVE, 0.1, P.FILTER_ENV_AMT, 0.2, P.LFO_ON, 0, P.FX_REVERB_ON, 0,
      P.PATCH_GAIN, 0.481,
    ]),

  // ---- expanded library (v1.1.1) ----
  // Leads: mono/legato voicing, glide, vibrato and band-pass colour.
  preset('monoglide', 'Mono Glide Lead · 单音滑音主音', 'SYNTHWAVE', 'LEAD', 'saw', [
      ...envP(0.01, 0.25, 0.7, 0.35), P.OSC1_DETUNE, 6, P.OSC2_DETUNE, -7, P.OSC2_LEVEL, 0.5,
      P.FILTER_CUTOFF, 6500, P.FILTER_RES, 0.3, P.FILTER_DRIVE, 0.25, P.FILTER_ENV_AMT, 0.45,
      P.VOICE_MODE, 2, P.GLIDE, 0.35, P.LFO_RATE, 5, P.LFO_DEPTH, 0.18, P.LFO_TARGET, 1,
      P.FX_DELAY_ON, 1, P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 0.894,
    ]),
  preset('theremin', 'Theremin Voice · 特雷门', 'CLASSIC', 'LEAD', 'sine', [
      ...envP(0.05, 0.4, 0.9, 0.6), P.OSC1_WAVE, 0, P.OSC1_DETUNE, 0, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 0,
      P.FILTER_CUTOFF, 12000, P.FILTER_RES, 0.05, P.FILTER_ENV_AMT, 0, P.VOICE_MODE, 2, P.GLIDE, 0.8,
      P.LFO_RATE, 5.5, P.LFO_DEPTH, 0.25, P.LFO_TARGET, 1, P.FX_REVERB_SIZE, 0.8, P.FX_REVERB_MIX, 0.5,
      P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1, P.FX_DELAY_MIX, 0.2, P.PATCH_GAIN, 0.458,
    ]),
  preset('acidlead', 'Acid Lead · 酸味主音', 'ACID HOUSE', 'LEAD', 'saw', [
      ...envP(0.003, 0.18, 0.25, 0.2), P.OSC1_LEVEL, 0.75, P.OSC2_ON, 0, P.FILTER_CUTOFF, 1200,
      P.FILTER_RES, 0.85, P.FILTER_DRIVE, 0.5, P.FILTER_ENV_AMT, 0.85, P.FILTER_KBD, 0,
      P.VOICE_MODE, 1, P.GLIDE, 0.12, P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 3, P.FX_DELAY_MIX, 0.25, P.PATCH_GAIN, 2.986,
    ]),
  preset('chipsaw', 'Chip Arp Lead · 芯片琶音', 'CHIPTUNE', 'LEAD', 'pulse', [
      ...envP(0.001, 0.09, 0.5, 0.08), P.OSC1_WAVE, 4, P.OSC1_PW, 0.25, P.OSC1_LEVEL, 0.7,
      P.OSC2_WAVE, 3, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 11000, P.FILTER_RES, 0.1,
      P.FILTER_DRIVE, 0, P.FILTER_ENV_AMT, 0.15, P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 3, P.FX_DELAY_MIX, 0.3, P.PATCH_GAIN, 0.419,
    ]),
  preset('formant', 'Formant Lead · 共振峰主音', 'IDM', 'LEAD', 'saw', [
      ...envP(0.02, 0.3, 0.65, 0.4), P.OSC1_DETUNE, 4, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 4,
      P.OSC2_DETUNE, -5, P.OSC2_LEVEL, 0.35, P.FILTER_TYPE, 2, P.FILTER_CUTOFF, 1600,
      P.FILTER_RES, 0.7, P.FILTER_DRIVE, 0.3, P.FILTER_ENV_AMT, 0.6, P.LFO_RATE, 0.8, P.LFO_DEPTH, 0.3,
      P.LFO2_ON, 1, P.LFO2_RATE, 5.2, P.LFO2_DEPTH, 0.12, P.LFO2_TARGET, 1, P.FX_REVERB_MIX, 0.35,
      P.PATCH_GAIN, 0.768,
    ]),

  // Basses: mono sub, FM bite, plucked and Reese-style growls.
  preset('monosub', 'Mono Sub · 单音超低', 'TECHNO', 'BASS', 'sine', [
      ...envP(0.004, 0.5, 0.85, 0.2), P.OSC1_WAVE, 0, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.85,
      P.OSC2_WAVE, 3, P.OSC2_PITCH, -12, P.OSC2_DETUNE, 5, P.OSC2_LEVEL, 0.2, P.FILTER_CUTOFF, 500,
      P.FILTER_RES, 0.15, P.FILTER_DRIVE, 0.2, P.FILTER_ENV_AMT, 0.3, P.VOICE_MODE, 2, P.GLIDE, 0.2,
      P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.295,
    ]),
  preset('fmbite', 'FM Bite Bass · FM 咬合贝斯', 'DUBSTEP', 'BASS', 'saw', [
      ...envP(0.002, 0.2, 0.35, 0.15), P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_WAVE, 3,
      P.OSC2_PITCH, -12, P.OSC2_DETUNE, 14, P.OSC2_LEVEL, 0.45, P.FILTER_CUTOFF, 900,
      P.FILTER_RES, 0.55, P.FILTER_DRIVE, 0.55, P.FILTER_ENV_AMT, 0.7, P.LFO_ON, 0, P.LFO2_ON, 1,
      P.LFO2_RATE, 7.5, P.LFO2_DEPTH, 0.35, P.LFO2_TARGET, 1, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 1.137,
    ]),
  preset('pluckbass', 'Pluck Bass · 拨弦贝斯', 'HOUSE', 'BASS', 'saw', [
      ...envP(0.001, 0.16, 0.05, 0.12), P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.75, P.OSC2_WAVE, 4,
      P.OSC2_PITCH, -12, P.OSC2_LEVEL, 0.3, P.FILTER_CUTOFF, 700, P.FILTER_RES, 0.45,
      P.FILTER_DRIVE, 0.4, P.FILTER_ENV_AMT, 0.85, P.FILTER_ENV_ATTACK, 0.001,
      P.FILTER_ENV_DECAY, 0.12, P.FILTER_ENV_SUSTAIN, 0, P.FILTER_ENV_RELEASE, 0.1, P.LFO_ON, 0,
      P.FX_REVERB_ON, 0, P.PATCH_GAIN, 3.114,
    ]),
  preset('reesegrowl', 'Reese Growl · 里斯咆哮', 'DnB', 'BASS', 'saw', [
      ...envP(0.01, 0.5, 0.9, 0.3), P.OSC1_PITCH, -12, P.OSC1_DETUNE, 26, P.OSC1_LEVEL, 0.7,
      P.OSC2_PITCH, -12, P.OSC2_DETUNE, -24, P.OSC2_LEVEL, 0.65, P.FILTER_CUTOFF, 1400,
      P.FILTER_RES, 0.35, P.FILTER_DRIVE, 0.45, P.FILTER_ENV_AMT, 0.25, P.LFO_RATE, 0.25,
      P.LFO_DEPTH, 0.2, P.FX_CHORUS_ON, 1, P.FX_CHORUS_DEPTH, 0.4, P.FX_CHORUS_RATE, 0.3,
      P.FX_CHORUS_MIX, 0.35, P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.5, P.FX_DRIVE_MIX, 0.5,
      P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.043,
    ]),

  // Pads: choir, shimmer, strings and a drifting noise bed.
  preset('angelic', 'Angelic Choir · 天使合唱', 'CINEMATIC', 'PAD', 'triangle', [
      ...envP(1.4, 1.8, 0.9, 3.5), P.OSC1_WAVE, 1, P.OSC1_DETUNE, 8, P.OSC1_LEVEL, 0.5, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.35, P.FILTER_CUTOFF, 3000, P.FILTER_RES, 0.15,
      P.FILTER_ENV_AMT, 0.2, P.LFO_RATE, 0.15, P.LFO_DEPTH, 0.25, P.FX_CHORUS_ON, 1,
      P.FX_CHORUS_DEPTH, 0.6, P.FX_CHORUS_RATE, 0.35, P.FX_CHORUS_MIX, 0.45, P.FX_REVERB_SIZE, 0.9,
      P.FX_REVERB_MIX, 0.6, P.PATCH_GAIN, 1.96,
    ]),
  preset('shimmer', 'Shimmer Pad · 微光铺底', 'AMBIENT', 'PAD', 'sine', [
      ...envP(1.8, 2.2, 0.85, 4.5), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.55, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 19, P.OSC2_DETUNE, 5, P.OSC2_LEVEL, 0.3, P.FILTER_CUTOFF, 6500, P.FILTER_RES, 0.1,
      P.FILTER_ENV_AMT, 0.15, P.LFO_RATE, 0.1, P.LFO_DEPTH, 0.3, P.LFO2_ON, 1, P.LFO2_RATE, 0.07,
      P.LFO2_DEPTH, 0.25, P.FX_REVERB_SIZE, 0.95, P.FX_REVERB_MIX, 0.65, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 1, P.FX_DELAY_FB, 0.45, P.FX_DELAY_MIX, 0.3, P.PATCH_GAIN, 1.554,
    ]),
  preset('strings', 'Analog Strings · 模拟弦乐', 'PROGRESSIVE', 'PAD', 'saw', [
      ...envP(0.9, 1.2, 0.85, 2), P.OSC1_DETUNE, 12, P.OSC1_LEVEL, 0.5, P.OSC2_DETUNE, -11,
      P.OSC2_LEVEL, 0.5, P.FILTER_CUTOFF, 3800, P.FILTER_RES, 0.12, P.FILTER_DRIVE, 0.1,
      P.FILTER_ENV_AMT, 0.3, P.LFO_RATE, 0.2, P.LFO_DEPTH, 0.2, P.FX_CHORUS_ON, 1,
      P.FX_CHORUS_RATE, 0.5, P.FX_REVERB_SIZE, 0.7, P.FX_REVERB_MIX, 0.35, P.PATCH_GAIN, 0.936,
    ]),
  preset('driftpad', 'Drift Pad · 漂移铺底', 'AMBIENT', 'PAD', 'noise', [
      ...envP(2.2, 2.5, 0.8, 5), P.OSC1_WAVE, 1, P.OSC1_DETUNE, 10, P.OSC1_LEVEL, 0.45, P.OSC2_WAVE, 5,
      P.OSC2_LEVEL, 0.12, P.FILTER_TYPE, 2, P.FILTER_CUTOFF, 1200, P.FILTER_RES, 0.3,
      P.FILTER_ENV_AMT, 0.2, P.LFO_RATE, 0.06, P.LFO_DEPTH, 0.5, P.LFO2_ON, 1, P.LFO2_RATE, 0.09,
      P.LFO2_TARGET, 3, P.FX_REVERB_SIZE, 0.95, P.FX_REVERB_MIX, 0.6, P.PATCH_GAIN, 8,
    ]),

  // Plucks: mallet, nylon, blip and harp.
  preset('kalimba', 'Kalimba · 卡林巴', 'WORLD', 'PLUCK', 'sine', [
      ...envP(0.001, 0.28, 0, 0.4), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.8, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 24, P.OSC2_DETUNE, 4, P.OSC2_LEVEL, 0.2, P.FILTER_CUTOFF, 7000, P.FILTER_RES, 0.08,
      P.FILTER_ENV_AMT, 0.3, P.LFO_ON, 0, P.FX_REVERB_SIZE, 0.5, P.FX_REVERB_MIX, 0.35,
      P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 3, P.FX_DELAY_MIX, 0.28, P.PATCH_GAIN, 1.399,
    ]),
  preset('nylon', 'Nylon Pluck · 尼龙拨弦', 'ACOUSTIC', 'PLUCK', 'triangle', [
      ...envP(0.002, 0.35, 0.05, 0.5), P.OSC1_WAVE, 1, P.OSC1_LEVEL, 0.75, P.OSC2_PITCH, 12,
      P.OSC2_DETUNE, 6, P.OSC2_LEVEL, 0.18, P.FILTER_CUTOFF, 3400, P.FILTER_ENV_AMT, 0.45, P.LFO_ON, 0,
      P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 2.228,
    ]),
  preset('blip', 'Blip Pluck · 电子点音', 'ELECTRO', 'PLUCK', 'square', [
      ...envP(0.001, 0.06, 0, 0.06), P.OSC1_WAVE, 3, P.OSC1_PW, 0.2, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 4,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.25, P.FILTER_RES, 0.3, P.FILTER_DRIVE, 0.2,
      P.FILTER_ENV_AMT, 0.6, P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 3,
      P.FX_DELAY_FB, 0.4, P.FX_DELAY_MIX, 0.3, P.PATCH_GAIN, 3.075,
    ]),
  preset('harp', 'Harp · 竖琴', 'CINEMATIC', 'PLUCK', 'triangle', [
      ...envP(0.002, 0.5, 0.02, 0.9), P.OSC1_WAVE, 1, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 5200, P.FILTER_RES, 0.1,
      P.FILTER_ENV_AMT, 0.35, P.LFO_ON, 0, P.FX_REVERB_SIZE, 0.65, P.FX_REVERB_MIX, 0.4,
      P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.25, P.PATCH_GAIN, 1.619,
    ]),

  // Keys: Rhodes, Wurly and celesta.
  preset('rhodes', 'Rhodes MkII · 电钢 MkII', 'SOUL', 'KEYS', 'sine', [
      ...envP(0.004, 1.1, 0.3, 1.3), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 1,
      P.OSC2_PITCH, 12, P.OSC2_DETUNE, 3, P.OSC2_LEVEL, 0.28, P.FILTER_CUTOFF, 4200, P.FILTER_RES, 0.1,
      P.FILTER_DRIVE, 0.18, P.FILTER_ENV_AMT, 0.3, P.LFO_ON, 0, P.FX_CHORUS_ON, 1,
      P.FX_CHORUS_DEPTH, 0.35, P.FX_CHORUS_RATE, 0.4, P.FX_CHORUS_MIX, 0.3, P.FX_REVERB_SIZE, 0.5,
      P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 0.708,
    ]),
  preset('wurli', 'Wurly · 沃利策电钢', 'SOUL', 'KEYS', 'triangle', [
      ...envP(0.003, 0.8, 0.25, 1), P.OSC1_WAVE, 1, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 3,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.2, P.FILTER_CUTOFF, 3000, P.FILTER_RES, 0.2,
      P.FILTER_DRIVE, 0.35, P.FILTER_ENV_AMT, 0.35, P.LFO_ON, 0, P.FX_DRIVE_ON, 1,
      P.FX_DRIVE_AMT, 0.35, P.FX_DRIVE_MIX, 0.45, P.FX_REVERB_SIZE, 0.4, P.FX_REVERB_MIX, 0.28,
      P.PATCH_GAIN, 0.663,
    ]),
  preset('celesta', 'Celesta · 钢片琴', 'CLASSICAL', 'KEYS', 'sine', [
      ...envP(0.001, 1.2, 0, 1.6), P.OSC1_WAVE, 0, P.OSC2_WAVE, 0, P.OSC2_PITCH, 24, P.OSC2_DETUNE, 5,
      P.OSC2_LEVEL, 0.22, P.FILTER_CUTOFF, 14000, P.FILTER_RES, 0.05, P.FILTER_ENV_AMT, 0, P.LFO_ON, 0,
      P.FX_REVERB_SIZE, 0.75, P.FX_REVERB_MIX, 0.5, P.PATCH_GAIN, 1,
    ]),

  // FX: transitions, texture and percussion.
  preset('whiteriser', 'White Riser · 白噪上升', 'TRANSITION', 'FX', 'noise', [
      ...envP(4, 0.1, 1, 0.6), P.OSC1_WAVE, 5, P.OSC1_LEVEL, 0.6, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.15,
      P.FILTER_TYPE, 1, P.FILTER_CUTOFF, 300, P.FILTER_RES, 0.35, P.FILTER_DRIVE, 0.2,
      P.FILTER_ENV_AMT, 0.95, P.FILTER_ENV_ATTACK, 4, P.FILTER_ENV_DECAY, 0.2, P.FILTER_ENV_SUSTAIN, 1,
      P.FILTER_ENV_RELEASE, 0.5, P.LFO_WAVE, 1, P.LFO_RATE, 0.2, P.LFO_DEPTH, 0.4,
      P.FX_REVERB_SIZE, 0.8, P.FX_REVERB_MIX, 0.5, P.PATCH_GAIN, 4.75,
    ]),
  preset('wind', 'Wind · 风声', 'SFX', 'FX', 'noise', [
      ...envP(1.2, 2, 0.9, 2.5), P.OSC1_WAVE, 5, P.OSC1_LEVEL, 0.5, P.OSC2_ON, 0, P.FILTER_TYPE, 2,
      P.FILTER_CUTOFF, 900, P.FILTER_RES, 0.5, P.FILTER_ENV_AMT, 0.4, P.LFO_RATE, 0.25,
      P.LFO_DEPTH, 0.6, P.LFO2_ON, 1, P.LFO2_RATE, 0.13, P.LFO2_DEPTH, 0.4, P.FX_REVERB_SIZE, 0.9,
      P.FX_REVERB_MIX, 0.55, P.PATCH_GAIN, 1.436,
    ]),
  preset('laser', 'Laser Zap · 激光', 'SFX', 'FX', 'square', [
      ...envP(0.001, 0.12, 0, 0.08), P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.6, P.OSC2_ON, 0,
      P.FILTER_RES, 0.2, P.LFO_WAVE, 3, P.LFO_RATE, 18, P.LFO_DEPTH, 0.9, P.LFO_TARGET, 1,
      P.FX_REVERB_ON, 0, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 3, P.FX_DELAY_MIX, 0.35,
      P.PATCH_GAIN, 2.511,
    ]),
  preset('gong', 'Gong · 锣', 'WORLD', 'FX', 'noise', [
      ...envP(0.005, 3.5, 0, 4), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 5, P.OSC2_LEVEL, 0.2,
      P.FILTER_TYPE, 2, P.FILTER_CUTOFF, 700, P.FILTER_RES, 0.4, P.FILTER_ENV_AMT, 0.6,
      P.FILTER_ENV_ATTACK, 0.001, P.FILTER_ENV_DECAY, 2.5, P.FILTER_ENV_SUSTAIN, 0,
      P.FILTER_ENV_RELEASE, 3, P.LFO_RATE, 1.3, P.LFO_DEPTH, 0.2, P.FX_REVERB_SIZE, 0.9,
      P.FX_REVERB_MIX, 0.6, P.PATCH_GAIN, 1.342,
    ]),

  // Basic starting points for the remaining oscillator types / voicings.
  preset('squareinit', 'Square Init · 方波初始', 'BASIC', 'BASIC', 'square', [
      ...envP(0.003, 0.2, 0.7, 0.3), P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.7, P.OSC2_ON, 0,
      P.FILTER_CUTOFF, 12000, P.FILTER_RES, 0.15, P.FILTER_DRIVE, 0.1, P.FILTER_ENV_AMT, 0.2,
      P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.337,
    ]),
  preset('pulseinit', 'Pulse Init · 脉冲初始', 'BASIC', 'BASIC', 'pulse', [
      ...envP(0.003, 0.2, 0.7, 0.3), P.OSC1_WAVE, 4, P.OSC1_PW, 0.3, P.OSC1_LEVEL, 0.7, P.OSC2_ON, 0,
      P.FILTER_CUTOFF, 12000, P.FILTER_RES, 0.15, P.FILTER_ENV_AMT, 0.2, P.LFO_ON, 0,
      P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.359,
    ]),
  // Wavetable recipes (A6.2): the PW knob picks the table, so each of these
  // shows off a different harmonic bank.
  preset('wtorgan', 'Wavetable Organ · 波表风琴', 'WAVETABLE', 'KEYS', 'wavetable', [
      ...envP(0.004, 0.2, 0.85, 0.25), P.OSC1_WAVE, 8, P.OSC1_PW, 0.05, P.OSC1_LEVEL, 0.7,
      P.OSC2_WAVE, 0, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.2, P.FILTER_RES, 0.05, P.FILTER_ENV_AMT, 0.2,
      P.LFO_ON, 0, P.FX_CHORUS_ON, 1, P.FX_CHORUS_MIX, 0.3, P.FX_REVERB_SIZE, 0.4, P.PATCH_GAIN, 0.393,
    ]),
  preset('wtvocal', 'Wavetable Vox · 波表人声', 'WAVETABLE', 'PAD', 'wavetable', [
      ...envP(0.08, 0.6, 0.8, 0.7), P.OSC1_WAVE, 8, P.OSC1_UNISON, 2, P.OSC1_SPREAD, 0.18,
      P.OSC2_WAVE, 1, P.OSC2_PITCH, -12, P.OSC2_LEVEL, 0.22, P.FILTER_CUTOFF, 4200, P.FILTER_RES, 0.15,
      P.FILTER_ENV_AMT, 0.25, P.LFO_TARGET, 1, P.LFO_DEPTH, 0.1, P.LFO_RATE, 4.2,
      P.FX_REVERB_SIZE, 0.65, P.FX_REVERB_MIX, 0.34, P.PATCH_GAIN, 0.718,
    ]),
  preset('wtglass', 'Wavetable Glass · 波表玻璃', 'WAVETABLE', 'PLUCK', 'wavetable', [
      ...envP(0.002, 0.5, 0.2, 0.8), P.OSC1_WAVE, 8, P.OSC1_PW, 0.95, P.OSC1_LEVEL, 0.7,
      P.OSC2_WAVE, 0, P.OSC2_PITCH, 12, P.OSC2_DETUNE, 5, P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 7000,
      P.FILTER_RES, 0.1, P.FILTER_ENV_AMT, 0.4, P.LFO_ON, 0, P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.2,
      P.FX_DELAY_SYNC, 1, P.FX_REVERB_SIZE, 0.6, P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 1.187,
    ]),
  preset('wtmetal', 'Wavetable Metal · 波表金属', 'WAVETABLE', 'FX', 'wavetable', [
      ...envP(0.003, 0.35, 0.4, 0.5), P.OSC1_WAVE, 8, P.OSC1_PW, 0.7, P.OSC1_LEVEL, 0.7,
      P.OSC2_WAVE, 8, P.OSC2_PW, 0.7, P.OSC2_PITCH, 7, P.OSC2_LEVEL, 0.3, P.FILTER_TYPE, 1,
      P.FILTER_CUTOFF, 1200, P.FILTER_RES, 0.35, P.LFO_ON, 0, P.FX_REVERB_SIZE, 0.7,
      P.FX_REVERB_MIX, 0.35, P.PATCH_GAIN, 2.902,
    ]),
  // ------------------------------------------------- modern / fun (2020s)
  preset('hyperpop', 'Hyperpop Lead · 超流行主音', 'HYPERPOP', 'LEAD', 'saw', [
      ...envP(0.002, 0.18, 0.85, 0.12), P.OSC1_LEVEL, 0.62, P.OSC1_UNISON, 3, P.OSC1_SPREAD, 0.4,
      P.OSC2_WAVE, 4, P.OSC2_PITCH, 12, P.OSC2_DETUNE, -8, P.OSC2_LEVEL, 0.3, P.FILTER_DRIVE, 0.35,
      P.FILTER_ENV_AMT, 0.45, P.LFO_ON, 0, P.FX_CHORUS_ON, 1, P.FX_CHORUS_MIX, 0.3,
      P.FX_REVERB_SIZE, 0.3, P.FX_REVERB_MIX, 0.18, P.PATCH_GAIN, 0.672,
    ]),
  preset('futurechord', 'Future Chord · 未来和弦', 'FUTURE BASS', 'PAD', 'saw', [
      ...envP(0.03, 0.6, 0.7, 0.5), P.OSC1_LEVEL, 0.5, P.OSC1_UNISON, 5, P.OSC1_SPREAD, 0.55,
      P.OSC2_WAVE, 3, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.22, P.FILTER_CUTOFF, 5200, P.FILTER_RES, 0.18,
      P.FILTER_DRIVE, 0.2, P.FILTER_ENV_AMT, 0.3, P.LFO_TARGET, 1, P.LFO_DEPTH, 0.12, P.LFO_RATE, 4.5,
      P.FX_CHORUS_ON, 1, P.FX_CHORUS_MIX, 0.35, P.FX_REVERB_SIZE, 0.55, P.FX_REVERB_MIX, 0.3,
      P.PATCH_GAIN, 1.103,
    ]),
  preset('synthwave', 'Synthwave Bass · 合成器波浪贝斯', 'SYNTHWAVE', 'BASS', 'saw', [
      ...envP(0.004, 0.3, 0.75, 0.12), P.OSC1_LEVEL, 0.7, P.OSC1_UNISON, 2, P.OSC1_SPREAD, 0.2,
      P.OSC2_PITCH, -12, P.OSC2_DETUNE, 6, P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 1200,
      P.FILTER_RES, 0.35, P.FILTER_DRIVE, 0.3, P.FILTER_ENV_AMT, 0.4, P.FILTER_ENV_DECAY, 0.18,
      P.LFO_ON, 0, P.VOICE_MODE, 1, P.GLIDE, 0.06, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.718,
    ]),
  preset('phonk', 'Phonk Cowbell · 暗黑牛铃', 'PHONK', 'FX', 'square', [
      ...envP(0.001, 0.12, 0.0, 0.08), P.OSC1_WAVE, 0, P.OSC1_PITCH, 24, P.OSC1_LEVEL, 0.5,
      P.OSC2_WAVE, 0, P.OSC2_PITCH, 31, P.OSC2_LEVEL, 0.42, P.FILTER_TYPE, 4, P.FILTER_CUTOFF, 2400,
      P.FILTER_RES, 0.72, P.FILTER_ENV_AMT, 0, P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 1.44,
    ]),
  preset('drill808', 'Drill 808 · 钻头低音', 'TRAP', 'BASS', 'sine', [
      ...envP(0.002, 1.1, 0.85, 0.6), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.9, P.OSC2_ON, 0,
      P.FILTER_CUTOFF, 800, P.FILTER_RES, 0.05, P.FILTER_DRIVE, 0.4, P.VOICE_MODE, 1, P.GLIDE, 0.12,
      P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.219,
    ]),
  preset('ambient', 'Ambient Bloom · 氛围绽放', 'AMBIENT', 'PAD', 'triangle', [
      ...envP(1.6, 2.0, 0.85, 2.4), P.OSC1_WAVE, 1, P.OSC1_LEVEL, 0.55, P.OSC1_UNISON, 4,
      P.OSC1_SPREAD, 0.5, P.OSC2_WAVE, 0, P.OSC2_PITCH, 12, P.OSC2_DETUNE, -4, P.OSC2_LEVEL, 0.22,
      P.FILTER_CUTOFF, 2600, P.FILTER_RES, 0.12, P.FILTER_ENV_AMT, 0.25, P.LFO_DEPTH, 0.25,
      P.LFO_RATE, 0.12, P.FX_REVERB_SIZE, 0.8, P.FX_REVERB_MIX, 0.42, P.PATCH_GAIN, 1.299,
    ]),
  preset('robotvoice', 'Robot Voice · 机器人声', 'EXPERIMENTAL', 'FX', 'saw', [
      ...envP(0.02, 0.3, 0.9, 0.2), P.OSC1_LEVEL, 0.6, P.OSC1_UNISON, 2, P.OSC1_SPREAD, 0.15,
      P.OSC2_WAVE, 5, P.OSC2_LEVEL, 0.15, P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 700, P.FILTER_RES, 0.45,
      P.LFO_DEPTH, 0.3, P.LFO_RATE, 5.2, P.LFO_WAVE, 2, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.115,
    ]),
  preset('chiplead', 'Chiptune Lead · 芯片主音', 'CHIPTUNE', 'LEAD', 'square', [
      ...envP(0.001, 0.08, 0.7, 0.05), P.OSC1_WAVE, 4, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 3,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.18, P.FILTER_CUTOFF, 15000, P.FILTER_RES, 0, P.LFO_ON, 0,
      P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.248,
    ]),
  preset('crystalglass', 'Crystal Glass · 水晶玻璃', 'CINEMATIC', 'KEYS', 'sine', [
      ...envP(0.002, 0.9, 0.25, 1.2), P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 19, P.OSC2_DETUNE, 4, P.OSC2_LEVEL, 0.3, P.FILTER_CUTOFF, 8000, P.FILTER_RES, 0.08,
      P.FILTER_ENV_AMT, 0.3, P.LFO_ON, 0, P.FX_CHORUS_ON, 1, P.FX_CHORUS_MIX, 0.25,
      P.FX_REVERB_SIZE, 0.6, P.FX_REVERB_MIX, 0.34, P.PATCH_GAIN, 0.856,
    ]),
  preset('wobblebass', 'Wobble Bass · 摇摆低音', 'DUBSTEP', 'BASS', 'saw', [
      ...envP(0.004, 0.4, 0.9, 0.15), P.OSC1_LEVEL, 0.75, P.OSC1_UNISON, 2, P.OSC1_SPREAD, 0.25,
      P.OSC2_ON, 0, P.FILTER_TYPE, 1, P.FILTER_CUTOFF, 900, P.FILTER_RES, 0.6, P.FILTER_DRIVE, 0.45,
      P.LFO_DEPTH, 0.5, P.LFO_RATE, 3, P.LFO_WAVE, 1, P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.35,
      P.FX_DRIVE_MIX, 0.4, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.22,
    ]),
  preset('monoinit', 'Mono Init · 单音初始', 'BASIC', 'BASIC', 'saw', [
      ...envP(0.005, 0.25, 0.8, 0.3), P.OSC1_LEVEL, 0.7, P.OSC2_ON, 0, P.FILTER_CUTOFF, 10000,
      P.FILTER_RES, 0.2, P.FILTER_DRIVE, 0.1, P.FILTER_ENV_AMT, 0.3, P.VOICE_MODE, 1, P.GLIDE, 0.15,
      P.LFO_ON, 0, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.54,
    ]),
  // ------------------------------------------------- engine showcase (P12.2)
  // Ten patches that exist to make P6.3a/b, P6.4 and P7.2 audible. Each one
  // uses ids that already exist — no new parameter was added for this batch —
  // and the full design note is in `docs/notes/p122-presets.md`.
  //
  // SEM dual filter. `FILTER_TYPE 6` is the state-variable multimode, and
  // `FILTER_MORPH` sweeps continuously low-pass -> band-pass -> notch ->
  // high-pass; `FILTER_ROUTING` 1/2 puts a second SEM in series or beside it.
  preset('semmorph', 'SEM Morph Pad · SEM 变形铺底', 'EXPERIMENTAL', 'PAD', 'saw', [
      ...envP(0.6, 1.4, 0.8, 2.0), P.OSC1_LEVEL, 0.5, P.OSC1_UNISON, 3, P.OSC1_SPREAD, 0.4,
      P.OSC2_WAVE, 1, P.OSC2_DETUNE, -7, P.OSC2_LEVEL, 0.3, P.FILTER_TYPE, 6, P.FILTER_MORPH, 0.25,
      P.FILTER_CUTOFF, 2400, P.FILTER_RES, 0.4, P.FILTER_ROUTING, 1, P.FILTER2_TYPE, 6,
      P.FILTER2_CUTOFF, 5200, P.FILTER2_RES, 0.2, P.LFO_RATE, 0.18, P.LFO_DEPTH, 0.6,
      P.FX_REVERB_SIZE, 0.7, P.FX_REVERB_MIX, 0.4, P.PATCH_GAIN, 4.126,
    ]),
  preset('semparabass', 'SEM Parallel Bass · SEM 并联低音', 'EXPERIMENTAL', 'BASS', 'saw', [
      ...envP(0.004, 0.28, 0.55, 0.18), P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_WAVE, 4,
      P.OSC2_PITCH, -12, P.OSC2_LEVEL, 0.25, P.FILTER_TYPE, 6, P.FILTER_MORPH, 0.1,
      P.FILTER_CUTOFF, 700, P.FILTER_RES, 0.45, P.FILTER_ROUTING, 2, P.FILTER2_TYPE, 6,
      P.FILTER2_CUTOFF, 1800, P.FILTER2_RES, 0.5, P.FILTER_BLEND, 0.42, P.LFO_RATE, 2.4,
      P.LFO_DEPTH, 0.3, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.359,
    ]),
  preset('semnotch', 'SEM Notch Drone · SEM 陷波嗡鸣', 'EXPERIMENTAL', 'FX', 'saw', [
      ...envP(0.8, 1.6, 0.75, 2.4), P.OSC1_LEVEL, 0.55, P.OSC2_WAVE, 5, P.OSC2_LEVEL, 0.15,
      P.FILTER_TYPE, 6, P.FILTER_MORPH, 0.67, P.FILTER_CUTOFF, 900, P.FILTER_RES, 0.6,
      P.FILTER_ENV_AMT, 0.8, P.FILTER_ENV_ATTACK, 1.2, P.FILTER_ENV_DECAY, 2.5, P.LFO_RATE, 0.09,
      P.LFO_DEPTH, 0.5, P.FX_REVERB_SIZE, 0.85, P.FX_REVERB_MIX, 0.5, P.PATCH_GAIN, 0.69,
    ]),
  // Bit-crusher. Chain slot 6 becomes kind 7 (`crush`) and `FX_CRUSH_ON` arms
  // it; BITS / DOWN / AA / MIX are the P6.4 quantiser controls.
  preset('crushlead', 'Crushed Lead · 位粉碎主音', 'EXPERIMENTAL', 'LEAD', 'saw', [
      ...envP(0.003, 0.22, 0.7, 0.25), P.OSC1_DETUNE, 8, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 3,
      P.OSC2_DETUNE, -9, P.OSC2_LEVEL, 0.35, P.FILTER_CUTOFF, 6500, P.FILTER_RES, 0.3,
      P.FILTER_DRIVE, 0.3, P.FX_CHAIN6, 7, P.FX_CRUSH_ON, 1, P.FX_CRUSH_BITS, 6, P.FX_CRUSH_DOWN, 8,
      P.FX_CRUSH_AA, 0.25, P.FX_CRUSH_MIX, 0.75, P.FX_DELAY_ON, 1, P.FX_DELAY_MIX, 0.2,
      P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.529,
    ]),
  preset('crushbass', 'Crushed Sub · 位粉碎低音', 'EXPERIMENTAL', 'BASS', 'sine', [
      ...envP(0.002, 0.5, 0.7, 0.3), P.OSC1_WAVE, 0, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.85,
      P.OSC2_ON, 0, P.FILTER_CUTOFF, 600, P.FILTER_DRIVE, 0.35, P.FX_CHAIN6, 7, P.FX_CRUSH_ON, 1,
      // 6 bit, not 4: a 4-bit quantiser has a 0.125 step and this patch's
      // pre-effect peak is about 0.044, so every capture rounded to zero and the
      // crusher emitted silence (only the 10 % dry leg of the mix was audible -
      // a middle C peaked at 0.0020). 6 bit puts the step at 0.03125, under the
      // signal, so the crusher actually quantises; with the 12x divider and 60 %
      // anti-aliasing it is still a hard, aliased crush.
      P.FX_CRUSH_BITS, 6, P.FX_CRUSH_DOWN, 12, P.FX_CRUSH_AA, 0.6, P.FX_CRUSH_MIX, 0.9,
      // Trimmed so the *working* crusher lands on the bank median (-40.98 dBFS
      // against a -40.87 median), not on the accidental silence.
      P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.36,
    ]),
  preset('tapecrush', 'Tape Crush Keys · 磁带粉碎键盘', 'EXPERIMENTAL', 'KEYS', 'triangle', [
      ...envP(0.004, 0.7, 0.35, 0.9), P.OSC1_WAVE, 1, P.OSC1_LEVEL, 0.7, P.OSC2_WAVE, 0,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.2, P.FILTER_CUTOFF, 4200, P.FILTER_RES, 0.12, P.FX_CHAIN6, 7,
      P.FX_CRUSH_ON, 1, P.FX_CRUSH_BITS, 10, P.FX_CRUSH_DOWN, 2, P.FX_CRUSH_AA, 0.9,
      P.FX_CRUSH_MIX, 0.45, P.FX_CHORUS_ON, 1, P.FX_CHORUS_MIX, 0.25, P.FX_REVERB_SIZE, 0.5,
      P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 0.909,
    ]),
  // Oversampling. `OVERSAMPLE` runs the saturating filter path (and the drive
  // node) at 2x and band-limits back, which is the whole point of these two:
  // the same drive without the aliases folded back into the band.
  preset('osdrive', 'Oversampled Drive · 过采样驱动', 'EXPERIMENTAL', 'LEAD', 'saw', [
      ...envP(0.004, 0.3, 0.75, 0.3), P.OSC1_DETUNE, 10, P.OSC1_LEVEL, 0.7, P.OSC2_DETUNE, -10,
      P.OSC2_LEVEL, 0.4, P.FILTER_CUTOFF, 3200, P.FILTER_RES, 0.45, P.FILTER_DRIVE, 0.85,
      P.FILTER_ENV_AMT, 0.6, P.OVERSAMPLE, 1, P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.45,
      P.FX_DRIVE_MIX, 0.5, P.FX_REVERB_SIZE, 0.4, P.FX_REVERB_MIX, 0.2, P.PATCH_GAIN, 0.129,
    ]),
  preset('osbass', 'Oversampled Sub · 过采样低音', 'EXPERIMENTAL', 'BASS', 'saw', [
      ...envP(0.003, 0.4, 0.8, 0.2), P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 0,
      P.FILTER_CUTOFF, 480, P.FILTER_RES, 0.3, P.FILTER_DRIVE, 0.9, P.FILTER_ENV_AMT, 0.45,
      P.OVERSAMPLE, 1, P.FX_REVERB_ON, 0, P.PATCH_GAIN, 0.455,
    ]),
  // In-graph modulation. `FX_GRAPH` switches the effect section from the chain
  // to the routing graph, and `FX_MOD*` edges add `depth * source` to a node's
  // input/output gain; `dst` is `1 + node * 3 + which` (18 = node 6's output).
  preset('graphpump', 'Graph Pump · 图内泵动', 'EXPERIMENTAL', 'PLUCK', 'square', [
      ...envP(0.002, 0.16, 0.3, 0.3), P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.6, P.OSC2_PITCH, 12,
      P.OSC2_LEVEL, 0.25, P.FILTER_CUTOFF, 5000, P.FILTER_RES, 0.35, P.FILTER_ENV_AMT, 0.6,
      P.FX_CHAIN6, 7, P.FX_CRUSH_ON, 1, P.FX_CRUSH_BITS, 7, P.FX_CRUSH_MIX, 0.6, P.FX_GRAPH, 1,
      P.FX_MOD1_SRC, 1, P.FX_MOD1_DST, 18, P.FX_MOD1_DEPTH, 0.85, P.LFO_WAVE, 2, P.LFO_RATE, 5.5,
      P.LFO_DEPTH, 1, P.FX_REVERB_SIZE, 0.3, P.FX_REVERB_MIX, 0.2, P.PATCH_GAIN, 1.2,
    ]),
  preset('graphswell', 'Graph Swell · 图内涌动', 'EXPERIMENTAL', 'PAD', 'wavetable', [
      ...envP(0.9, 2.0, 0.7, 2.6), P.OSC1_WAVE, 8, P.OSC1_PW, 0.35, P.OSC1_LEVEL, 0.6, P.OSC2_WAVE, 1,
      P.OSC2_LEVEL, 0.3, P.FILTER_CUTOFF, 3000, P.FILTER_RES, 0.2, P.FILTER_ENV_AMT, 0.4,
      P.FX_CHAIN5, 8, P.FX_EQ_ON, 1, P.FX_EQ_MID_GAIN, 4, P.FX_EQ_MID_FREQ, 1200, P.FX_GRAPH, 1,
      P.FX_MOD1_SRC, 3, P.FX_MOD1_DST, 18, P.FX_MOD1_DEPTH, 0.9, P.FX_MOD2_SRC, 2, P.FX_MOD2_DST, 15,
      P.FX_MOD2_DEPTH, 0.5, P.LFO2_ON, 1, P.LFO2_WAVE, 0, P.LFO2_RATE, 0.13, P.LFO2_DEPTH, 1,
      P.FX_REVERB_SIZE, 0.8, P.FX_REVERB_MIX, 0.4, P.PATCH_GAIN, 0.353,
    ]),
  // Formant vocal choir pads. 3-parallel bandpass formants modeling Ah, Oh, Ee, Oo and closed-mouth Hum.
  preset('vocalah', 'Vocal Ah Choir · 人声啊唱', 'CHOIR', 'PAD', 'saw', [
      ...envP(0.5, 0.8, 0.85, 1.8),
      P.OSC1_LEVEL, 0.65, P.OSC1_UNISON, 6, P.OSC1_SPREAD, 0.28,
      P.OSC2_ON, 1, P.OSC2_WAVE, 2, P.OSC2_LEVEL, 0.5, P.OSC2_UNISON, 4, P.OSC2_SPREAD, 0.2, P.OSC2_DETUNE, -6,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 80, P.FILTER_RES, 0.42,
      P.FILTER_KBD, 0, P.FILTER_ENV_AMT, 0,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_RATE, 5.1, P.LFO_DEPTH, 0.05,
      P.NOISE_MIX, 0.025,
      P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.6, P.FX_CHORUS_DEPTH, 0.35, P.FX_CHORUS_MIX, 0.3,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.75, P.FX_REVERB_MIX, 0.4,
      P.PATCH_GAIN, 0.323,
    ]),
  preset('vocaloh', 'Vocal Oh Choir · 人声哦唱', 'CHOIR', 'PAD', 'saw', [
      ...envP(0.55, 0.9, 0.85, 2.0),
      P.OSC1_LEVEL, 0.65, P.OSC1_UNISON, 6, P.OSC1_SPREAD, 0.3,
      P.OSC2_ON, 1, P.OSC2_WAVE, 1, P.OSC2_LEVEL, 0.4, P.OSC2_UNISON, 4, P.OSC2_SPREAD, 0.25, P.OSC2_DETUNE, -5,
      P.OSC1_SUB, 1, P.OSC1_SUB_LEVEL, 0.12,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 1504, P.FILTER_RES, 0.46,
      P.FILTER_KBD, 0, P.FILTER_ENV_AMT, 0,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_RATE, 4.9, P.LFO_DEPTH, 0.05,
      P.NOISE_MIX, 0.02,
      P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.55, P.FX_CHORUS_DEPTH, 0.35, P.FX_CHORUS_MIX, 0.32,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.8, P.FX_REVERB_MIX, 0.42,
      P.PATCH_GAIN, 0.292,
    ]),
  preset('vocalee', 'Vocal Ee Choir · 人声衣唱', 'CHOIR', 'PAD', 'saw', [
      ...envP(0.45, 0.8, 0.85, 1.9),
      P.OSC1_LEVEL, 0.65, P.OSC1_UNISON, 5, P.OSC1_SPREAD, 0.25,
      P.OSC2_ON, 1, P.OSC2_WAVE, 2, P.OSC2_LEVEL, 0.45, P.OSC2_UNISON, 4, P.OSC2_SPREAD, 0.22, P.OSC2_DETUNE, 4,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 566, P.FILTER_RES, 0.42,
      P.FILTER_KBD, 0, P.FILTER_ENV_AMT, 0,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_RATE, 5.2, P.LFO_DEPTH, 0.05,
      P.NOISE_MIX, 0.02,
      P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.65, P.FX_CHORUS_DEPTH, 0.38, P.FX_CHORUS_MIX, 0.35,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.8, P.FX_REVERB_MIX, 0.42,
      P.PATCH_GAIN, 0.22,
    ]),
  preset('vocaloo', 'Vocal Oo Choir · 人声呜唱', 'CHOIR', 'PAD', 'saw', [
      ...envP(0.6, 1.0, 0.88, 2.2),
      P.OSC1_LEVEL, 0.7, P.OSC1_UNISON, 6, P.OSC1_SPREAD, 0.3,
      P.OSC2_ON, 1, P.OSC2_WAVE, 1, P.OSC2_LEVEL, 0.4, P.OSC2_UNISON, 4, P.OSC2_SPREAD, 0.25, P.OSC2_DETUNE, -7,
      P.OSC1_SUB, 1, P.OSC1_SUB_LEVEL, 0.15,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 4000, P.FILTER_RES, 0.48,
      P.FILTER_KBD, 0, P.FILTER_ENV_AMT, 0,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_RATE, 4.8, P.LFO_DEPTH, 0.05,
      P.NOISE_MIX, 0.015,
      P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.5, P.FX_CHORUS_DEPTH, 0.35, P.FX_CHORUS_MIX, 0.35,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.82, P.FX_REVERB_MIX, 0.45,
      P.PATCH_GAIN, 0.274,
    ]),
  preset('vocalhum', 'Vocal Hum Choir · 闭口哼鸣', 'CHOIR', 'PAD', 'saw', [
      ...envP(0.6, 1.0, 0.85, 2.2),
      P.OSC1_LEVEL, 0.65, P.OSC1_UNISON, 5, P.OSC1_SPREAD, 0.25,
      P.OSC2_ON, 1, P.OSC2_WAVE, 1, P.OSC2_LEVEL, 0.45, P.OSC2_UNISON, 3, P.OSC2_SPREAD, 0.2, P.OSC2_DETUNE, -4,
      P.OSC1_SUB, 1, P.OSC1_SUB_LEVEL, 0.18,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 3800, P.FILTER_RES, 0.45,
      P.FILTER_ROUTING, 1, P.FILTER2_TYPE, 0, P.FILTER2_CUTOFF, 1150, P.FILTER2_RES, 0.2,
      P.FILTER_KBD, 0, P.FILTER_ENV_AMT, 0,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_RATE, 4.7, P.LFO_DEPTH, 0.05,
      P.NOISE_MIX, 0.025,
      P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.5, P.FX_CHORUS_DEPTH, 0.3, P.FX_CHORUS_MIX, 0.3,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.85, P.FX_REVERB_MIX, 0.48,
      P.PATCH_GAIN, 0.234,
    ]),
  // Playful creature, robot, sci-fi and meme presets.
  preset('catlead', 'Cat Lead · 喵喵主音', 'CREATURE', 'LEAD', 'saw', [
      ...envP(0.08, 0.45, 0.75, 0.3),
      P.VOICE_MODE, 2, P.GLIDE, 0.12, P.OSC1_WAVE, 2, P.OSC1_LEVEL, 0.75, P.OSC2_ON, 1, P.OSC2_WAVE, 4,
      P.OSC2_PW, 0.35, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.45, P.OSC2_DETUNE, 6, P.FILTER_TYPE, 5,
      P.FILTER_CUTOFF, 450, P.FILTER_RES, 0.65, P.FILTER_ENV_AMT, 0.7, P.FILTER_ENV_ATTACK, 0.12,
      P.FILTER_ENV_DECAY, 0.4, P.FILTER_ENV_SUSTAIN, 0.2, P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_WAVE, 0,
      P.LFO_RATE, 5.5, P.LFO_DEPTH, 0.05, P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.45, P.FX_CHORUS_DEPTH, 0.4,
      P.FX_CHORUS_MIX, 0.3, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.6, P.FX_REVERB_MIX, 0.3,
      P.PATCH_GAIN, 0.26,
    ]),
  preset('frogcroak', 'Frog Croak · 蛙鸣弹拨', 'CREATURE', 'PLUCK', 'square', [
      ...envP(0.005, 0.22, 0, 0.15),
      P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 1, P.OSC2_WAVE, 0, P.OSC2_PITCH, -12, P.OSC2_LEVEL, 0.6,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 180, P.FILTER_RES, 0.75, P.FILTER_ENV_AMT, 0.55,
      P.FILTER_ENV_ATTACK, 0.01, P.FILTER_ENV_DECAY, 0.18, P.FILTER_ENV_SUSTAIN, 0, P.FX_DRIVE_ON, 1,
      P.FX_DRIVE_AMT, 0.3, P.FX_DRIVE_MIX, 0.4, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.5,
      P.FX_REVERB_MIX, 0.25, P.PATCH_GAIN, 0.501,
    ]),
  preset('spacesingers', 'Space Singers · 太空歌姬', 'SPACE', 'PAD', 'saw', [
      ...envP(0.8, 1.2, 0.85, 2.8),
      P.OSC1_LEVEL, 0.6, P.OSC1_UNISON, 7, P.OSC1_SPREAD, 0.4, P.OSC2_ON, 1, P.OSC2_WAVE, 2,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.35, P.OSC2_UNISON, 5, P.OSC2_SPREAD, 0.35, P.OSC2_DETUNE, 8,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 200, P.FILTER_RES, 0.45, P.LFO_ON, 1, P.LFO_TARGET, 0,
      P.LFO_WAVE, 0, P.LFO_RATE, 0.25, P.LFO_DEPTH, 0.45, P.LFO2_ON, 1, P.LFO2_TARGET, 1, P.LFO2_WAVE, 1,
      P.LFO2_RATE, 5.4, P.LFO2_DEPTH, 0.06, P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.4, P.FX_CHORUS_DEPTH, 0.5,
      P.FX_CHORUS_MIX, 0.45, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.92, P.FX_REVERB_MIX, 0.55,
      P.PATCH_GAIN, 0.696,
    ]),
  preset('robotdroid', 'Robot Droid · 赛博达雷克', 'ROBOT', 'FX', 'square', [
      ...envP(0.01, 0.25, 0.9, 0.15),
      P.OSC1_WAVE, 3, P.OSC1_LEVEL, 0.7, P.OSC2_ON, 1, P.OSC2_WAVE, 0, P.OSC2_PITCH, 19, P.OSC2_LEVEL, 0.5,
      P.OSC_RING, 0.6, P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 800, P.FILTER_RES, 0.6, P.FX_CRUSH_ON, 1,
      P.FX_CRUSH_BITS, 7, P.FX_CRUSH_DOWN, 3, P.FX_CRUSH_MIX, 0.4, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1,
      P.FX_DELAY_FB, 0.35, P.FX_DELAY_MIX, 0.25, P.PATCH_GAIN, 0.231,
    ]),
  preset('birdchirp', 'Bird Chirp · 电子翠鸟', 'CREATURE', 'FX', 'sine', [
      ...envP(0.005, 0.18, 0.05, 0.12),
      P.OSC1_WAVE, 0, P.OSC1_PITCH, 12, P.OSC1_LEVEL, 0.85, P.OSC2_ON, 1, P.OSC2_WAVE, 1, P.OSC2_PITCH, 24,
      P.OSC2_LEVEL, 0.35, P.FILTER_TYPE, 2, P.FILTER_CUTOFF, 2200, P.FILTER_RES, 0.45, P.FILTER_KBD, 1,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_WAVE, 1, P.LFO_RATE, 16, P.LFO_DEPTH, 0.22, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 1, P.FX_DELAY_FB, 0.35, P.FX_DELAY_MIX, 0.25, P.FX_REVERB_ON, 1,
      P.FX_REVERB_SIZE, 0.45, P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 6.145,
    ]),
  preset('alienpopgun', 'Alien Popgun · 异星泡泡枪', 'ALIEN', 'FX', 'sine', [
      ...envP(0.001, 0.18, 0, 0.12),
      P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.85, P.OSC2_ON, 1, P.OSC2_WAVE, 3, P.OSC2_PITCH, 24, P.OSC2_LEVEL, 0.3,
      P.FILTER_TYPE, 4, P.FILTER_CUTOFF, 1200, P.FILTER_RES, 0.82, P.FILTER_ENV_AMT, 0.8,
      P.FILTER_ENV_ATTACK, 0.001, P.FILTER_ENV_DECAY, 0.12, P.FILTER_ENV_SUSTAIN, 0, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 2, P.FX_DELAY_FB, 0.5, P.FX_DELAY_MIX, 0.4, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.5,
      P.FX_REVERB_MIX, 0.3, P.PATCH_GAIN, 0.307,
    ]),
  preset('santaho', 'Santa Ho Ho · 圣诞老人', 'MEME', 'FX', 'square', [
      ...envP(0.02, 0.5, 0.9, 0.2),
      P.OSC1_WAVE, 2, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.75, P.OSC2_ON, 1, P.OSC2_WAVE, 3, P.OSC2_PITCH, -12,
      P.OSC2_LEVEL, 0.45, P.OSC2_DETUNE, 4, P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 1500, P.FILTER_RES, 0.55,
      P.FILTER_ENV_AMT, 0.2, P.FILTER_ENV_ATTACK, 0.03, P.FILTER_ENV_DECAY, 0.2, P.FILTER_ENV_SUSTAIN, 0.5,
      P.LFO_ON, 1, P.LFO_TARGET, 2, P.LFO_WAVE, 2, P.LFO_RATE, 3.2, P.LFO_DEPTH, 0.85, P.FX_REVERB_ON, 1,
      P.FX_REVERB_SIZE, 0.65, P.FX_REVERB_MIX, 0.35, P.PATCH_GAIN, 0.291,
    ]),
  preset('alienchatter', 'Alien Chatter · 外星碎碎念', 'ALIEN', 'FX', 'saw', [
      ...envP(0.01, 0.3, 0.85, 0.2),
      P.OSC1_WAVE, 2, P.OSC1_LEVEL, 0.7, P.OSC2_ON, 1, P.OSC2_WAVE, 4, P.OSC2_PW, 0.25, P.OSC2_PITCH, 12,
      P.OSC2_LEVEL, 0.4, P.OSC2_DETUNE, -7, P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 600, P.FILTER_RES, 0.65,
      P.LFO_ON, 1, P.LFO_TARGET, 0, P.LFO_WAVE, 2, P.LFO_RATE, 9.5, P.LFO_DEPTH, 0.65, P.LFO2_ON, 1,
      P.LFO2_TARGET, 1, P.LFO2_WAVE, 2, P.LFO2_RATE, 4.8, P.LFO2_DEPTH, 0.15, P.FX_CRUSH_ON, 1,
      P.FX_CRUSH_BITS, 8, P.FX_CRUSH_DOWN, 4, P.FX_CRUSH_MIX, 0.35, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1,
      P.FX_DELAY_FB, 0.3, P.FX_DELAY_MIX, 0.2, P.PATCH_GAIN, 0.162,
    ]),
  preset('monstergrowl', 'Monster Growl · 异星咆哮', 'CREATURE', 'BASS', 'saw', [
      ...envP(0.12, 0.8, 0.8, 0.5),
      P.VOICE_MODE, 1, P.GLIDE, 0.08, P.OSC1_WAVE, 2, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.85,
      P.OSC1_UNISON, 5, P.OSC1_SPREAD, 0.25, P.OSC2_ON, 1, P.OSC2_WAVE, 2, P.OSC2_PITCH, -12,
      P.OSC2_LEVEL, 0.7, P.OSC2_UNISON, 4, P.OSC2_SPREAD, 0.2, P.OSC2_DETUNE, 8, P.OSC1_SYNC, 1,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 750, P.FILTER_RES, 0.5, P.FILTER_ENV_AMT, 0.4,
      P.FILTER_ENV_ATTACK, 0.15, P.FILTER_ENV_DECAY, 0.6, P.FILTER_ENV_SUSTAIN, 0.6, P.FX_DRIVE_ON, 1,
      P.FX_DRIVE_AMT, 0.3, P.FX_DRIVE_MIX, 0.35, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.65,
      P.FX_REVERB_MIX, 0.35, P.PATCH_GAIN, 0.183,
    ]),
  preset('talkingbass', 'Talking Bass · 说话贝斯', 'DUBSTEP', 'BASS', 'saw', [
      ...envP(0.005, 0.35, 0.75, 0.2),
      P.VOICE_MODE, 2, P.GLIDE, 0.05, P.OSC1_WAVE, 2, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 1,
      P.OSC2_WAVE, 4, P.OSC2_PW, 0.3, P.OSC2_PITCH, -12, P.OSC2_LEVEL, 0.6, P.OSC2_DETUNE, 6,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 300, P.FILTER_RES, 0.6, P.FILTER_ENV_AMT, 0.65,
      P.FILTER_ENV_ATTACK, 0.02, P.FILTER_ENV_DECAY, 0.25, P.FILTER_ENV_SUSTAIN, 0.15, P.LFO_ON, 1,
      P.LFO_TARGET, 0, P.LFO_RATE, 3.5, P.LFO_DEPTH, 0.4, P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.25,
      P.FX_DRIVE_MIX, 0.3, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.35, P.FX_REVERB_MIX, 0.2,
      P.PATCH_GAIN, 0.192,
    ]),
  // Iconic essential synthesizer presets (vintage, cinematic, acoustic, modern).
  preset('whalesong', 'Whale Song · 深海座头鲸', 'NATURE', 'FX', 'sine', [
      ...envP(0.4, 1.2, 0.8, 1.8),
      P.VOICE_MODE, 2, P.GLIDE, 0.22, P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.9, P.OSC2_ON, 1, P.OSC2_WAVE, 1,
      P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.35, P.OSC2_DETUNE, 6, P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 420,
      P.FILTER_RES, 0.45, P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_WAVE, 0, P.LFO_RATE, 0.45, P.LFO_DEPTH, 0.08,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.95, P.FX_REVERB_MIX, 0.55, P.PATCH_GAIN, 0.152,
    ]),
  preset('analogbrass', 'Analog Brass · 经典模拟铜管', 'VINTAGE', 'LEAD', 'saw', [
      ...envP(0.045, 0.8, 0.75, 0.35),
      P.OSC1_WAVE, 2, P.OSC1_LEVEL, 0.75, P.OSC1_UNISON, 3, P.OSC1_SPREAD, 0.2, P.OSC2_ON, 1, P.OSC2_WAVE, 2,
      P.OSC2_LEVEL, 0.65, P.OSC2_DETUNE, 10, P.FILTER_TYPE, 0, P.FILTER_CUTOFF, 1100, P.FILTER_RES, 0.28,
      P.FILTER_DRIVE, 0.15, P.FILTER_ENV_AMT, 0.62, P.FILTER_ENV_ATTACK, 0.05, P.FILTER_ENV_DECAY, 0.55,
      P.FILTER_ENV_SUSTAIN, 0.45, P.FILTER_ENV_RELEASE, 0.35, P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.5,
      P.FX_CHORUS_DEPTH, 0.35, P.FX_CHORUS_MIX, 0.3, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.55,
      P.FX_REVERB_MIX, 0.25, P.PATCH_GAIN, 0.582,
    ]),
  preset('bladerunner', 'Blade Runner · 银翼主音', 'CINEMATIC', 'LEAD', 'saw', [
      ...envP(0.18, 1.2, 0.85, 1.4),
      P.OSC1_WAVE, 2, P.OSC1_LEVEL, 0.7, P.OSC1_UNISON, 4, P.OSC1_SPREAD, 0.3, P.OSC2_ON, 1, P.OSC2_WAVE, 2,
      P.OSC2_LEVEL, 0.65, P.OSC2_DETUNE, 12, P.FILTER_TYPE, 0, P.FILTER_CUTOFF, 750, P.FILTER_RES, 0.42,
      P.FILTER_ENV_AMT, 0.52, P.FILTER_ENV_ATTACK, 0.28, P.FILTER_ENV_DECAY, 1.1, P.FILTER_ENV_SUSTAIN, 0.7,
      P.FILTER_ENV_RELEASE, 1.2, P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_WAVE, 0, P.LFO_RATE, 4.8,
      P.LFO_DEPTH, 0.05, P.FX_CHORUS_ON, 1, P.FX_CHORUS_RATE, 0.4, P.FX_CHORUS_DEPTH, 0.45,
      P.FX_CHORUS_MIX, 0.35, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 2, P.FX_DELAY_FB, 0.4, P.FX_DELAY_MIX, 0.3,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.88, P.FX_REVERB_MIX, 0.45, P.PATCH_GAIN, 0.948,
    ]),
  preset('dxsolidbass', 'DX Solid Bass · DX7金属电贝斯', '80S', 'BASS', 'sine', [
      ...envP(0.001, 0.32, 0.15, 0.15),
      P.VOICE_MODE, 1, P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.85, P.OSC1_SUB, 1, P.OSC1_SUB_LEVEL, 0.4,
      P.OSC2_ON, 1, P.OSC2_WAVE, 0, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.75, P.OSC_FM, 0.45, P.FILTER_TYPE, 0,
      P.FILTER_CUTOFF, 3200, P.FILTER_RES, 0.2, P.FILTER_ENV_AMT, 0.45, P.FILTER_ENV_ATTACK, 0.001,
      P.FILTER_ENV_DECAY, 0.18, P.FILTER_ENV_SUSTAIN, 0.1, P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.18,
      P.FX_DRIVE_MIX, 0.25, P.PATCH_GAIN, 1.206,
    ]),
  preset('cinemaabraam', 'Cinema Braam · 盗梦空间轰鸣', 'CINEMATIC', 'FX', 'saw', [
      ...envP(0.08, 1.4, 0.7, 1.6),
      P.VOICE_MODE, 1, P.GLIDE, 0.05, P.OSC1_WAVE, 2, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.8, P.OSC1_UNISON, 7,
      P.OSC1_SPREAD, 0.4, P.OSC1_SUB, 1, P.OSC1_SUB_LEVEL, 0.45, P.OSC2_ON, 1, P.OSC2_WAVE, 2,
      P.OSC2_PITCH, -24, P.OSC2_LEVEL, 0.65, P.OSC2_UNISON, 5, P.OSC2_SPREAD, 0.35, P.OSC2_DETUNE, 8,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 450, P.FILTER_RES, 0.55, P.FILTER_ROUTING, 1, P.FILTER2_TYPE, 0,
      P.FILTER2_CUTOFF, 1600, P.FILTER2_RES, 0.35, P.FILTER2_DRIVE, 0.35, P.FX_DRIVE_ON, 1,
      P.FX_DRIVE_AMT, 0.55, P.FX_DRIVE_MIX, 0.5, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.92,
      P.FX_REVERB_MIX, 0.5, P.PATCH_GAIN, 0.015,
    ]),
  preset('retroarp', 'Stranger Arp · 怪奇物语琶音', 'RETROWAVE', 'PLUCK', 'pulse', [
      ...envP(0.005, 0.32, 0.15, 0.22),
      P.OSC1_WAVE, 4, P.OSC1_PW, 0.35, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 1, P.OSC2_WAVE, 2, P.OSC2_LEVEL, 0.5,
      P.OSC2_DETUNE, 6, P.FILTER_TYPE, 0, P.FILTER_CUTOFF, 1100, P.FILTER_RES, 0.42, P.FILTER_ENV_AMT, 0.58,
      P.FILTER_ENV_ATTACK, 0.005, P.FILTER_ENV_DECAY, 0.22, P.FILTER_ENV_SUSTAIN, 0.05, P.FX_CHORUS_ON, 1,
      P.FX_CHORUS_RATE, 0.35, P.FX_CHORUS_DEPTH, 0.4, P.FX_CHORUS_MIX, 0.35, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 1, P.FX_DELAY_FB, 0.4, P.FX_DELAY_MIX, 0.3, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.55,
      P.FX_REVERB_MIX, 0.22, P.PATCH_GAIN, 2.108,
    ]),
  preset('panflute', 'Ethereal Flute · 空灵排箫', 'ORGANIC', 'LEAD', 'triangle', [
      ...envP(0.08, 0.4, 0.8, 0.35),
      P.OSC1_WAVE, 1, P.OSC1_LEVEL, 0.85, P.OSC2_ON, 1, P.OSC2_WAVE, 0, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.35,
      P.NOISE_MIX, 0.14, P.FILTER_TYPE, 2, P.FILTER_CUTOFF, 1800, P.FILTER_RES, 0.35, P.FILTER_KBD, 1,
      P.FILTER_ENV_AMT, 0.3, P.FILTER_ENV_ATTACK, 0.08, P.FILTER_ENV_DECAY, 0.35, P.FILTER_ENV_SUSTAIN, 0.65,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_WAVE, 0, P.LFO_RATE, 5.2, P.LFO_DEPTH, 0.04, P.FX_DELAY_ON, 1,
      P.FX_DELAY_SYNC, 2, P.FX_DELAY_FB, 0.35, P.FX_DELAY_MIX, 0.25, P.FX_REVERB_ON, 1,
      P.FX_REVERB_SIZE, 0.85, P.FX_REVERB_MIX, 0.45, P.PATCH_GAIN, 1.68,
    ]),
  preset('acidreso', 'Acid Squelch · 303尖啸酸音', 'ACID', 'BASS', 'saw', [
      ...envP(0.002, 0.22, 0, 0.12),
      P.VOICE_MODE, 2, P.GLIDE, 0.06, P.OSC1_WAVE, 2, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.85,
      P.FILTER_TYPE, 0, P.FILTER_CUTOFF, 450, P.FILTER_RES, 0.85, P.FILTER_DRIVE, 0.3, P.FILTER_ENV_AMT, 0.8,
      P.FILTER_ENV_ATTACK, 0.002, P.FILTER_ENV_DECAY, 0.18, P.FILTER_ENV_SUSTAIN, 0, P.FX_DRIVE_ON, 1,
      P.FX_DRIVE_AMT, 0.4, P.FX_DRIVE_MIX, 0.45, P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1, P.FX_DELAY_FB, 0.3,
      P.FX_DELAY_MIX, 0.2, P.PATCH_GAIN, 1.408,
    ]),
  preset('dxepiano', 'FM Tine Piano · 80年代FM电钢', '80S', 'KEYS', 'sine', [
      ...envP(0.003, 1.2, 0.35, 0.55),
      P.OSC1_WAVE, 0, P.OSC1_LEVEL, 0.85, P.OSC2_ON, 1, P.OSC2_WAVE, 0, P.OSC2_PITCH, 14, P.OSC2_LEVEL, 0.55,
      P.OSC_FM, 0.36, P.FILTER_TYPE, 1, P.FILTER_CUTOFF, 4200, P.FILTER_RES, 0.15, P.FILTER_ENV_AMT, 0.35,
      P.FILTER_ENV_ATTACK, 0.002, P.FILTER_ENV_DECAY, 0.75, P.FILTER_ENV_SUSTAIN, 0.3, P.FX_CHORUS_ON, 1,
      P.FX_CHORUS_RATE, 0.45, P.FX_CHORUS_DEPTH, 0.55, P.FX_CHORUS_MIX, 0.45, P.FX_REVERB_ON, 1,
      P.FX_REVERB_SIZE, 0.65, P.FX_REVERB_MIX, 0.32, P.PATCH_GAIN, 1.281,
    ]),
  preset('cinemapad', 'Cosmic Void · 浩瀚星空铺底', 'CINEMATIC', 'PAD', 'saw', [
      ...envP(1.8, 2.5, 0.9, 3.2),
      P.OSC1_WAVE, 2, P.OSC1_PITCH, -12, P.OSC1_LEVEL, 0.7, P.OSC1_UNISON, 6, P.OSC1_SPREAD, 0.45,
      P.OSC2_ON, 1, P.OSC2_WAVE, 1, P.OSC2_LEVEL, 0.6, P.OSC2_UNISON, 4, P.OSC2_SPREAD, 0.35,
      P.OSC2_DETUNE, 7, P.FILTER_TYPE, 6, P.FILTER_CUTOFF, 650, P.FILTER_RES, 0.4, P.FILTER_MORPH, 0.3,
      P.LFO_ON, 1, P.LFO_TARGET, 0, P.LFO_RATE, 0.08, P.LFO_DEPTH, 0.32, P.LFO2_ON, 1, P.LFO2_TARGET, 1,
      P.LFO2_RATE, 0.15, P.LFO2_DEPTH, 0.03, P.FX_PHASER_ON, 1, P.FX_PHASER_RATE, 0.12, P.FX_PHASER_FB, 0.4,
      P.FX_PHASER_MIX, 0.3, P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.96, P.FX_REVERB_MIX, 0.65,
      P.PATCH_GAIN, 6.482,
    ]),
  // Fun vocalized speech, wah-wah, street, and martial arts presets.
  preset('wahwah', 'Wah-Wah · 放克哇哇', 'FUNK', 'LEAD', 'saw', [
      ...envP(0.025, 0.45, 0.4, 0.25),
      P.OSC1_WAVE, 2, P.OSC1_LEVEL, 0.8, P.OSC2_ON, 1, P.OSC2_WAVE, 4, P.OSC2_PW, 0.25,
      P.OSC2_LEVEL, 0.45, P.OSC2_DETUNE, 7, P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 420, P.FILTER_RES, 0.72,
      P.FILTER_ENV_AMT, 0.75, P.FILTER_ENV_ATTACK, 0.05, P.FILTER_ENV_DECAY, 0.32, P.FILTER_ENV_SUSTAIN, 0.15,
      P.LFO_ON, 1, P.LFO_TARGET, 0, P.LFO_WAVE, 1, P.LFO_RATE, 3.8, P.LFO_DEPTH, 0.3,
      P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.22, P.FX_DRIVE_MIX, 0.3,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.45, P.FX_REVERB_MIX, 0.25,
      P.PATCH_GAIN, 0.248,
    ]),
  preset('hiphopyo', 'Hip-Hop Yo · 街头哟吼', 'HIPHOP', 'FX', 'saw', [
      ...envP(0.015, 0.45, 0.1, 0.18),
      P.VOICE_MODE, 1, P.OSC1_WAVE, 2, P.OSC1_LEVEL, 0.85, P.OSC1_SUB, 1, P.OSC1_SUB_LEVEL, 0.35,
      P.OSC2_ON, 1, P.OSC2_WAVE, 4, P.OSC2_PW, 0.32, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.45, P.OSC2_DETUNE, 5,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 380, P.FILTER_RES, 0.78, P.FILTER_ENV_AMT, 0.65,
      P.FILTER_ENV_ATTACK, 0.02, P.FILTER_ENV_DECAY, 0.25, P.FILTER_ENV_SUSTAIN, 0.05,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_WAVE, 3, P.LFO_RATE, 1.8, P.LFO_DEPTH, 0.08,
      P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.28, P.FX_DRIVE_MIX, 0.35,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.55, P.FX_REVERB_MIX, 0.32,
      P.PATCH_GAIN, 0.497,
    ]),
  preset('vocalniubi', 'Vocal Niubi · 赛博牛逼', 'MEME', 'FX', 'saw', [
      ...envP(0.04, 0.65, 0.2, 0.25),
      P.VOICE_MODE, 1, P.GLIDE, 0.06, P.OSC1_WAVE, 2, P.OSC1_LEVEL, 0.85,
      P.OSC2_ON, 1, P.OSC2_WAVE, 3, P.OSC2_PW, 0.3, P.OSC2_PITCH, 12, P.OSC2_LEVEL, 0.5, P.OSC2_DETUNE, 8,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 550, P.FILTER_RES, 0.7, P.FILTER_ENV_AMT, 0.55,
      P.FILTER_ENV_ATTACK, 0.06, P.FILTER_ENV_DECAY, 0.35, P.FILTER_ENV_SUSTAIN, 0.25,
      P.LFO_ON, 1, P.LFO_TARGET, 0, P.LFO_WAVE, 1, P.LFO_RATE, 3.2, P.LFO_DEPTH, 0.45,
      P.FX_CRUSH_ON, 1, P.FX_CRUSH_BITS, 9, P.FX_CRUSH_DOWN, 2, P.FX_CRUSH_MIX, 0.25,
      P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.25, P.FX_DRIVE_MIX, 0.3,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.6, P.FX_REVERB_MIX, 0.3,
      P.PATCH_GAIN, 0.329,
    ]),
  preset('bruceleekiai', 'Bruce Lee · 功夫啊哒', 'MARTIAL', 'FX', 'saw', [
      ...envP(0.01, 0.5, 0.15, 0.2),
      P.VOICE_MODE, 1, P.GLIDE, 0.08, P.OSC1_WAVE, 2, P.OSC1_PITCH, 12, P.OSC1_LEVEL, 0.85,
      P.OSC2_ON, 1, P.OSC2_WAVE, 4, P.OSC2_PW, 0.2, P.OSC2_PITCH, 24, P.OSC2_LEVEL, 0.55, P.OSC2_DETUNE, 12,
      P.FILTER_TYPE, 5, P.FILTER_CUTOFF, 1200, P.FILTER_RES, 0.75, P.FILTER_ENV_AMT, 0.65,
      P.FILTER_ENV_ATTACK, 0.04, P.FILTER_ENV_DECAY, 0.25, P.FILTER_ENV_SUSTAIN, 0.1,
      P.LFO_ON, 1, P.LFO_TARGET, 1, P.LFO_WAVE, 3, P.LFO_RATE, 2.5, P.LFO_DEPTH, 0.14,
      P.FX_DRIVE_ON, 1, P.FX_DRIVE_AMT, 0.45, P.FX_DRIVE_MIX, 0.45,
      P.FX_DELAY_ON, 1, P.FX_DELAY_SYNC, 1, P.FX_DELAY_FB, 0.35, P.FX_DELAY_MIX, 0.25,
      P.FX_REVERB_ON, 1, P.FX_REVERB_SIZE, 0.7, P.FX_REVERB_MIX, 0.35,
      P.PATCH_GAIN, 0.157,
    ]),
];

/**
 * Per-patch loudness trims.
 *
 * Measured, not guessed: every factory preset is rendered through the same
 * phrase and its RMS compared, then each patch carries the gain that brings it
 * to the median level (capped so a patch's peak never runs into the limiter, and
 * so no patch is boosted absurdly). Factory presets used to span 47 dB, which
 * made changing patch feel like changing the volume knob; `preset-loudness`
 * keeps them honest.
 *
 * The trim is applied as `patchGain`, which is deliberately not a UI control:
 * the player's own master volume must not move when the patch changes. It lives
 * in the patch's own pair list as `PATCH_GAIN`, right next to the parameters it
 * was measured against, and `presetParams` only has to merge over the defaults.
 */
