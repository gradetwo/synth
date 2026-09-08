import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectInputMode, getInputMode, haptic, setInputMode } from './useInputMode';

describe('input mode', () => {
  afterEach(() => {
    setInputMode('mouse');
    vi.unstubAllGlobals();
  });

  it('defaults to mouse without touch capability', () => {
    expect(detectInputMode()).toBe('mouse');
    expect(getInputMode()).toBe('mouse');
  });

  it('detects touch from maxTouchPoints', () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    expect(detectInputMode()).toBe('touch');
  });

  it('detects touch from a coarse pointer', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    expect(detectInputMode()).toBe('touch');
  });

  it('switches modes and notifies once per change', () => {
    setInputMode('touch');
    expect(getInputMode()).toBe('touch');
    setInputMode('touch');
    expect(getInputMode()).toBe('touch');
    setInputMode('mouse');
    expect(getInputMode()).toBe('mouse');
  });

  it('does not vibrate for mouse input', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    haptic();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('vibrates for touch input when supported', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    setInputMode('touch');
    haptic(7);
    expect(vibrate).toHaveBeenCalledWith(7);
  });

  it('survives devices without a vibration motor', () => {
    vi.stubGlobal('navigator', {});
    setInputMode('touch');
    expect(() => haptic()).not.toThrow();
  });
});
