/**
 * Touch velocity mapping.
 *
 * A finger has no pressure signal on iOS (the Vibration API and `Touch.force`
 * are both unavailable in Safari), so the strike position stands in for
 * dynamics: the lower you hit a key, the harder the note. The floor keeps
 * light taps audible instead of silent.
 */

export const VELOCITY_FLOOR = 0.35;
export const VELOCITY_CEIL = 1;
export const FIXED_VELOCITY = 0.9;

export function velocityFromY(
  clientY: number,
  top: number,
  height: number,
  mode: 'fixed' | 'touch',
): number {
  if (mode !== 'touch' || height <= 0) return FIXED_VELOCITY;
  const rel = Math.min(1, Math.max(0, (clientY - top) / height));
  return VELOCITY_FLOOR + (VELOCITY_CEIL - VELOCITY_FLOOR) * rel;
}

// ------------------------------------------------------------------- curves
//
// A controller or a touchscreen rarely produces the distribution a player
// wants: light touches come out too quiet to sit in a mix, or every hit lands
// near full scale. The curve reshapes a live velocity before it reaches the
// engine. Song playback is deliberately *not* shaped — a curve must not rewrite
// a performance.

export type VelocityCurve = 'linear' | 'soft' | 'hard';

export interface VelocityCurveInfo {
  id: VelocityCurve;
  name: [string, string];
  hint: [string, string];
}

export const VELOCITY_CURVES: VelocityCurveInfo[] = [
  { id: 'linear', name: ['线性', 'Linear'], hint: ['原样，不做处理', 'unshaped'] },
  { id: 'soft', name: ['柔和', 'Soft'], hint: ['轻触更容易出声', 'light touches come out louder'] },
  { id: 'hard', name: ['强硬', 'Hard'], hint: ['需要更用力才有动态', 'more control at the top'] },
];

/** Reshape a live velocity (0..1); values outside the range are clamped. */
export function shapeVelocity(velocity: number, curve: VelocityCurve): number {
  const v = Math.min(1, Math.max(0, Number.isFinite(velocity) ? velocity : FIXED_VELOCITY));
  switch (curve) {
    case 'soft':
      // 0.3 becomes 0.49: a light touch is heard without slamming the key.
      return Math.pow(v, 0.6);
    case 'hard':
      // 0.6 becomes 0.44: the top of the range has to be intended.
      return Math.pow(v, 1.6);
    case 'linear':
    default:
      return v;
  }
}

export function velocityCurveLabel(id: string, lang: 'zh' | 'en'): string {
  const curve = VELOCITY_CURVES.find((entry) => entry.id === id) ?? VELOCITY_CURVES[0];
  return curve.name[lang === 'zh' ? 0 : 1];
}
