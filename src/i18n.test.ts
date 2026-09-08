import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getLang, hasKey, localizeName, setLang, t } from './i18n';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (
      /\.(tsx|ts)$/.test(entry.name) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx') &&
      entry.name !== 'i18n.ts'
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('i18n', () => {
  it('translates and interpolates in both languages', () => {
    setLang('zh');
    expect(t('app.start')).toBe('启动音频引擎');
    expect(t('top.midiError', { msg: 'x' })).toBe('MIDI 错误：x');
    setLang('en');
    expect(t('app.start')).toBe('Start Audio Engine');
    expect(t('top.midiError', { msg: 'x' })).toBe('MIDI error: x');
    expect(getLang()).toBe('en');
    setLang('zh');
  });

  it('shows only the English part of a bilingual name in EN', () => {
    setLang('zh');
    expect(localizeName('Crystal Pluck · 晶体拨弦')).toBe('Crystal Pluck · 晶体拨弦');
    setLang('en');
    expect(localizeName('Crystal Pluck · 晶体拨弦')).toBe('Crystal Pluck');
    expect(localizeName('No separator')).toBe('No separator');
    setLang('zh');
  });

  it('falls back to the key for unknown keys', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('has every statically referenced key in the dictionary', () => {
    const missing = new Set<string>();
    for (const file of walk('src')) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bt\('([^']+)'/g)) {
        if (!hasKey(match[1])) missing.add(match[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
