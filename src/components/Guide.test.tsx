import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Guide } from './Guide';
import { setLang } from '@/i18n';

describe('Guide', () => {
  it('renders the manual in Chinese', () => {
    setLang('zh');
    const html = renderToString(<Guide open onClose={() => undefined} />);
    expect(html).toContain('使用指南');
    expect(html).toContain('合成器基础');
    expect(html).toContain('合成器简史');
    expect(html).toContain('合成器分类');
    expect(html).toContain('模块原理详解');
    expect(html).toContain('傅里叶');
    expect(html).toContain('新手教学');
    expect(html).toContain('使用帮助');
    expect(html).toContain('从零捏一个音色');
  });

  it('renders the manual in English', () => {
    setLang('en');
    try {
      const html = renderToString(<Guide open onClose={() => undefined} />);
      expect(html).toContain('Synthesis basics');
      expect(html).toContain('A short history');
      expect(html).toContain('Synthesizer taxonomy');
      expect(html).toContain('How the modules work');
      expect(html).toContain('Fourier');
      expect(html).toContain('Build a sound from scratch');
      expect(html).toContain('Getting started');
      expect(html).toContain('Usage help');
    } finally {
      setLang('zh');
    }
  });

  it('stays hidden when closed', () => {
    setLang('zh');
    const html = renderToString(<Guide open={false} onClose={() => undefined} />);
    expect(html).toContain('guide');
    expect(html).not.toContain('guide open');
  });
});
