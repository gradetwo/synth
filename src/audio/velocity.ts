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
