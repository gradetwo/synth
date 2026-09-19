import { describe, expect, it } from 'vitest';
import { shapeVelocity, VELOCITY_CURVES, velocityCurveLabel, velocityFromY } from './velocity';

describe('velocity curves', () => {
  it('leaves linear input alone and clamps the range', () => {
    expect(shapeVelocity(0.42, 'linear')).toBeCloseTo(0.42, 6);
    expect(shapeVelocity(-1, 'linear')).toBe(0);
    expect(shapeVelocity(2, 'linear')).toBe(1);
    expect(shapeVelocity(Number.NaN, 'linear')).toBeGreaterThan(0);
  });

  it('makes soft playing louder and hard playing quieter', () => {
    // The point of the two curves: the same light touch reads differently.
    expect(shapeVelocity(0.3, 'soft')).toBeGreaterThan(0.45);
    expect(shapeVelocity(0.3, 'hard')).toBeLessThan(0.2);
    // Both keep the ends of the range exact.
    for (const curve of ['soft', 'hard'] as const) {
      expect(shapeVelocity(0, curve)).toBe(0);
      expect(shapeVelocity(1, curve)).toBe(1);
    }
  });

  it('is monotonic for every curve', () => {
    for (const curve of VELOCITY_CURVES) {
      let previous = -1;
      for (let v = 0; v <= 1.0001; v += 0.05) {
        const shaped = shapeVelocity(v, curve.id);
        expect(shaped, `${curve.id} at ${v}`).toBeGreaterThanOrEqual(previous);
        previous = shaped;
      }
    }
  });

  it('keeps the touch-position mapping and labels available', () => {
    // The existing touch mapping still has to work: a low strike is a hard hit.
    expect(velocityFromY(100, 0, 100, 'touch')).toBeGreaterThan(velocityFromY(0, 0, 100, 'touch'));
    expect(velocityFromY(50, 0, 100, 'fixed')).toBeCloseTo(0.9, 6);
    expect(velocityCurveLabel('soft', 'zh')).toBe('柔和');
    expect(velocityCurveLabel('nope', 'en')).toBe('Linear');
  });
});
