import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from './App';
import { store } from '@/state/store';

/** Force the viewport module to classify the (jsdom) screen for this test. */
function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

describe('App shell', () => {
  it('renders every panel without crashing on desktop', () => {
    setViewport(1440, 900);
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

  it('tablets start with the compact monitor strip', () => {
    setViewport(768, 1024);
    const html = renderToString(<App />);
    expect(html).toContain('NOTE');
    expect(html).toContain('VU');
    expect(html).not.toContain('SPECTRUM');
  });

  it('renders English after switching language', () => {
    setViewport(1440, 900);
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
