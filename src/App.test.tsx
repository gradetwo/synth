import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App shell', () => {
  it('renders every panel without crashing', () => {
    const html = renderToString(<App />);
    for (const marker of [
      'GROOVE',
      'OSC 1',
      'OSC 2',
      'FILTER',
      'AMP ENV',
      'LFO',
      'MOD MATRIX',
      'REVERB',
      'DELAY',
      'SCOPE',
      'SPECTRUM',
      'MONITOR',
      '启动音频引擎',
    ]) {
      expect(html, marker).toContain(marker);
    }
  });
});
