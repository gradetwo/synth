import { describe, expect, it } from 'vitest';
import { sanitiseToast } from './Toast';

describe('toast markup', () => {
  it('keeps the bold tags the messages are written with', () => {
    expect(sanitiseToast('已导入 <b>saw.wav</b>')).toBe('已导入 <b>saw.wav</b>');
  });

  it('strips anything else a file name might carry', () => {
    expect(sanitiseToast('<img src=x onerror=alert(1)>.wav')).toBe('.wav');
    expect(sanitiseToast('a<b>c</b><script>bad()</script>')).toBe('a<b>c</b>bad()');
  });

  it('leaves ordinary names alone', () => {
    expect(sanitiseToast('vocal-cycle (1).wav')).toBe('vocal-cycle (1).wav');
  });
});
