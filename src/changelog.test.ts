import { describe, expect, it } from 'vitest';
import { CHANGELOG, CURRENT_VERSION, releaseDateLabel } from './changelog';

describe('changelog data', () => {
  it('lists releases newest first, without duplicates', () => {
    const versions = CHANGELOG.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
    });
    expect(versions).toEqual(sorted);
  });

  it('leads with the version this build reports', () => {
    // `dev` builds (no __APP_VERSION__) skip the check; every packaged build
    // must document itself.
    if (CURRENT_VERSION === 'dev') return;
    expect(CHANGELOG[0].version).toBe(CURRENT_VERSION);
    expect(CHANGELOG.filter((r) => r.version === CURRENT_VERSION)).toHaveLength(1);
  });

  it('gives every entry both languages, a date and at least one item', () => {
    for (const release of CHANGELOG) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.items.length).toBeGreaterThan(0);
      for (const [zh, en] of release.items) {
        expect(zh.trim().length).toBeGreaterThan(8);
        expect(en.trim().length).toBeGreaterThan(8);
        // A Chinese entry that is mostly ASCII means the pair got swapped.
        expect(/[\u4e00-\u9fff]/.test(zh)).toBe(true);
      }
    }
  });

  it('formats dates for both languages', () => {
    expect(releaseDateLabel('2026-09-10', 'zh')).toBe('2026 年 9 月 10 日');
    expect(releaseDateLabel('2026-09-10', 'en')).toBe('2026-09-10');
  });
});
