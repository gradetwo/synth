import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastBody, toastSegments } from './Toast';

describe('toast markup', () => {
  it('keeps the bold spans the messages are written with', () => {
    expect(toastSegments('已导入 <b>saw.wav</b>')).toEqual([
      { bold: false, text: '已导入 ' },
      { bold: true, text: 'saw.wav' },
    ]);
  });

  it('carries anything else a file name might have as plain text', () => {
    expect(toastSegments('<img src=x onerror=alert(1)>.wav')).toEqual([
      { bold: false, text: '<img src=x onerror=alert(1)>.wav' },
    ]);
    expect(toastSegments('a<b>c</b><script>bad()</script>')).toEqual([
      { bold: false, text: 'a' },
      { bold: true, text: 'c' },
      { bold: false, text: '<script>bad()</script>' },
    ]);
  });

  it('leaves ordinary names alone', () => {
    expect(toastSegments('vocal-cycle (1).wav')).toEqual([{ bold: false, text: 'vocal-cycle (1).wav' }]);
  });

  it('renders markup as escaped text, with only <b> as an element', () => {
    const html = renderToString(<ToastBody segments={toastSegments('a<b>c</b><script>bad()</script>')} />);
    expect(html).toBe('a<b>c</b>&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });
});
