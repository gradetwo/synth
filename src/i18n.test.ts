import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getLang,
  hasCopy,
  hasCoreCopy,
  hasKey,
  isFullyLoaded,
  loadAllStrings,
  localizeName,
  moduleKeyCount,
  setLang,
  t,
} from './i18n';
import {
  AUDIO_STRINGS,
  DOCS_STRINGS,
  FLOW_STRINGS,
  FX_STRINGS,
  PLAYER_STRINGS,
  ROLL_STRINGS,
  DRAWER_STRINGS,
  SETTINGS_STRINGS,
  SOURCES_STRINGS,
} from './i18n-panels';
import type { StringTable } from './i18n';

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

/**
 * The lazy tables, paired with the key list each module declares next to its
 * copy. They are imported statically *here* — and only here — so the guard can
 * see both halves without the production entry graph ever reaching them.
 */
const MODULES: Array<{ name: string; table: StringTable }> = [
  { name: 'i18n-panels:FX_STRINGS', table: FX_STRINGS },
  { name: 'i18n-panels:ROLL_STRINGS', table: ROLL_STRINGS },
  { name: 'i18n-panels:PLAYER_STRINGS', table: PLAYER_STRINGS },
  { name: 'i18n-panels:SOURCES_STRINGS', table: SOURCES_STRINGS },
  { name: 'i18n-panels:SETTINGS_STRINGS', table: SETTINGS_STRINGS },
  { name: 'i18n-panels:DRAWER_STRINGS', table: DRAWER_STRINGS },
  { name: 'i18n-panels:AUDIO_STRINGS', table: AUDIO_STRINGS },
  { name: 'i18n-panels:DOCS_STRINGS', table: DOCS_STRINGS },
  { name: 'i18n-panels:FLOW_STRINGS', table: FLOW_STRINGS },
];

/* ------------------------------------------------------------------ the eager graph */

const resolveId = (spec: string, fromFile: string): string | null => {
  let path: string;
  if (spec.startsWith('@/')) path = resolve('src', spec.slice(2));
  else if (spec.startsWith('.')) path = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [`${path}.ts`, `${path}.tsx`, join(path, 'index.ts'), join(path, 'index.tsx'), path]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      /* keep trying */
    }
  }
  return null;
};

/** Every file reachable from an entry by static (non-dynamic) imports. */
function eagerGraph(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const staticImport = /^import\s+(?!\()[\s\S]*?from\s+'([^']+)'/gm;
    let match: RegExpExecArray | null;
    while ((match = staticImport.exec(source))) {
      const id = resolveId(match[1], file);
      if (id && !seen.has(id)) queue.push(id);
    }
  }
  return seen;
}

/**
 * A very small fixture for the walker itself: without it, a broken import
 * reader would make the "eager files only use core keys" test vacuously green,
 * which is the failure mode this guard exists to prevent.
 */

describe('i18n', () => {
  beforeAll(async () => {
    await loadAllStrings();
  });

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

  it('loads every lazy table, so hasCopy covers the whole dictionary', () => {
    expect(isFullyLoaded()).toBe(true);
    for (const { table } of MODULES) {
      for (const key of Object.keys(table)) expect(hasCopy(key), `${key} has no copy`).toBe(true);
    }
    // `isFullyLoaded()` compares sizes, so it would also pass if a lazy key had
    // been duplicated into the core table by accident. The ownership test below
    // is what forbids that; this one only proves the tables arrived.
    expect(moduleKeyCount()).toBeGreaterThan(200);
  });

  it('declares every key exactly once, with both languages, next to its copy', () => {
    const owners = new Map<string, string>();
    for (const { name, table } of MODULES) {
      for (const [key, value] of Object.entries(table)) {
        expect(value, `${name} ${key} is not a pair`).toHaveLength(2);
        expect(value[0].length, `${name} ${key} has an empty Chinese string`).toBeGreaterThan(0);
        expect(value[1].length, `${name} ${key} has an empty English string`).toBeGreaterThan(0);
        expect(owners.has(key), `${key} is declared in ${owners.get(key)} and ${name}`).toBe(false);
        owners.set(key, name);
      }
    }
    // No lazy key may also live in the core table: that was the one real way to
    // fake the gzip saving this split is for, and it is invisible otherwise.
    for (const { table } of MODULES) {
      for (const key of Object.keys(table)) expect(hasCoreCopy(key), `${key} is both core and lazy`).toBe(false);
    }
  });

  /**
   * The guard P10.2's `verify-ci` was hardened in the same spirit for: the
   * coverage test above only knows what it can `hasKey()`, so if the walker that
   * decides "first screen" ever breaks, this test would go quietly green while
   * panels render key names. It asserts its own plumbing first.
   */
  it('has every statically referenced key in the dictionary', () => {
    const missing = new Set<string>();
    let scanned = 0;
    for (const file of walk('src')) {
      scanned += 1;
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const match of source.matchAll(/\bt\('([^']+)'/g)) {
        if (!hasKey(match[1])) missing.add(match[1]);
      }
    }
    expect(scanned, 'the source walker found nothing').toBeGreaterThan(50);
    expect([...missing]).toEqual([]);
  });

  it('the eager import graph is real before it is trusted', () => {
    const graph = eagerGraph([resolve('src/main.tsx')]);
    expect(graph.size, 'the eager graph collapsed to nothing').toBeGreaterThan(20);
    expect([...graph].some((file) => file.endsWith('App.tsx'))).toBe(true);
    // A statically imported panel is in; a `lazy(() => import(…))` one is not.
    // This is exactly the distinction the assertion below depends on.
    expect([...graph].some((file) => file.endsWith('panels/layout.tsx'))).toBe(true);
    expect([...graph].some((file) => file.endsWith('PlayerPanel.tsx'))).toBe(false);
    expect([...graph].some((file) => file.endsWith('i18n.player.ts'))).toBe(false);
  });

  it('every first-screen file only uses core keys', () => {
    const graph = eagerGraph([resolve('src/main.tsx')]);
    const lazyKeys = new Set(MODULES.flatMap(({ table }) => Object.keys(table)));
    // Two eager files read copy that is not in the core, on purpose: the
    // imported-wavetable and sampler rows render inside the always-mounted
    // module grid but their text belongs to the `sources` module. They are
    // gated by `useStringsReady()`, so until that table has been registered
    // they render nothing rather than a key name. Any *other* eager file doing
    // this is the regression this test exists to catch.
    const GATED = [
      'src/components/SettingsDrawer.tsx',
      'src/components/UserWavePicker.tsx',
      'src/components/UserSamplePicker.tsx',
    ];
    const violations: string[] = [];
    for (const file of graph) {
      const relative = file.replace(`${process.cwd()}/`, '');
      if (GATED.includes(relative)) continue;
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const match of source.matchAll(/\bt\('([^']+)'/g)) {
        if (lazyKeys.has(match[1])) violations.push(`${relative} uses ${match[1]}`);
      }
    }
    expect(violations).toEqual([]);
    // The exception list is not a loophole: both files must actually call the
    // gate, so a later edit cannot drop it and keep this test green.
    for (const file of GATED) {
      expect(readFileSync(file, 'utf8'), `${file} lost its string gate`).toContain('useStringsReady(');
    }
  });

  it('switches language with both tables already in memory', async () => {
    setLang('zh');
    await loadAllStrings();
    setLang('en');
    expect(t('player.title')).toBe('Player');
    expect(t('fxg.title')).toBe('Effect routing');
    expect(t('roll.title')).toBe('Piano roll');
    setLang('zh');
  });
});
