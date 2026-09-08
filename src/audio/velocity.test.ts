import { describe, expect, it } from 'vitest';
import { FIXED_VELOCITY, VELOCITY_CEIL, VELOCITY_FLOOR, velocityFromY } from './velocity';

describe('touch velocity', () => {
  it('ignores the strike position in fixed mode', () => {
    expect(velocityFromY(0, 100, 200, 'fixed')).toBe(FIXED_VELOCITY);
    expect(velocityFromY(199, 100, 200, 'fixed')).toBe(FIXED_VELOCITY);
  });

  it('maps the key top to the floor and the bottom to full velocity', () => {
    expect(velocityFromY(100, 100, 200, 'touch')).toBeCloseTo(VELOCITY_FLOOR, 6);
    expect(velocityFromY(300, 100, 200, 'touch')).toBeCloseTo(VELOCITY_CEIL, 6);
    expect(velocityFromY(200, 100, 200, 'touch')).toBeCloseTo(
      (VELOCITY_FLOOR + VELOCITY_CEIL) / 2,
      6,
    );
  });

  it('clamps strikes outside the key', () => {
    expect(velocityFromY(0, 100, 200, 'touch')).toBe(VELOCITY_FLOOR);
    expect(velocityFromY(999, 100, 200, 'touch')).toBe(VELOCITY_CEIL);
  });

  it('falls back to the fixed velocity for a zero-height key', () => {
    expect(velocityFromY(50, 0, 0, 'touch')).toBe(FIXED_VELOCITY);
  });
});
