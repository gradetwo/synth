import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from './App';
import { store } from '@/state/store';

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
      '演奏键盘',
      '重置布局',
      '启动音频引擎',
    ]) {
      expect(html, marker).toContain(marker);
    }
  });

  it('renders English after switching language', () => {
    store.toggleLang();
    try {
      const html = renderToString(<App />);
      expect(html).toContain('Start Audio Engine');
      expect(html).toContain('Presets');
    } finally {
      store.toggleLang();
    }
  });
});
