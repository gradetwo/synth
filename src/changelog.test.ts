import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGELOG, CURRENT_VERSION, SHIPPED_CHANGELOG_LIMIT, releaseDateLabel, type Release } from './changelog';
import { CHANGELOG_ARCHIVE } from './changelog-archive';

/**
 * The shipped list is capped (P141): one more release costs one more entry, not
 * another ~1.2 KB of permanently shipped payload. The archive keeps the rest of
 * the history, and the tests below prove the cap did not lose anything.
 */

/**
 * The frozen reference: the complete history as it was *before* the 30-entry
 * cap, in `src/changelog-history.fixture.ts`.
 *
 * It is a fixture rather than something read out of git on purpose, and that
 * has now been learned twice. P141's first version compared against
 * `git show HEAD:...`, which is the file the release commit changes, so its own
 * losslessness check went red the moment it was committed. The follow-up
 * compared against `git describe --tags`, which is exact -- and fails in CI,
 * because `actions/checkout` fetches one commit and no tags, so the suite would
 * have died on `git describe` rather than on a release note.
 *
 * The invariant that needs no git and survives the rotation: the frozen history
 * must be a **suffix** of the shipped list plus the archive. Prepending the
 * outgoing head (which is what a release does) leaves the tail alone, while
 * dropping, reordering, rewording or inserting anything anywhere else shifts
 * the window and fails.
 */
import { CHANGELOG_HISTORY } from './changelog-history.fixture';

/** Newest first, so `compareVersions(b, a)` sorts descending. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

/**
 * The versions newer than the frozen history: what has been rotated in since
 * the cap landed. Newest first, unique, and older than the fixture's head.
 */
function rotatedIn(): Release[] {
  const working = [...CHANGELOG.slice(1), ...CHANGELOG_ARCHIVE];
  return working.slice(0, working.length - CHANGELOG_HISTORY.length);
}


/** Source files that run in the app: tests are allowed to import the archive. */
function runtimeSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) runtimeSources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('changelog data', () => {
  it('lists releases newest first, without duplicates', () => {
    const versions = CHANGELOG.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) => compareVersions(b, a));
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
    for (const release of [...CHANGELOG, ...CHANGELOG_ARCHIVE]) {
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

  it('ships exactly the cap behind the head, and keeps the rest in the archive', () => {
    // `CHANGELOG` is the head reference plus the newest `LIMIT - 1` releases:
    // the cap counts what the panel lists, head included.
    expect(CHANGELOG).toHaveLength(SHIPPED_CHANGELOG_LIMIT);
    expect(CHANGELOG_ARCHIVE.length).toBeGreaterThan(0);
    // The archive picks up exactly where the shipped list stops: its first
    // release is older than the last shipped one, and (below) it is the next
    // entry of the same history rather than a second, overlapping list.
    const shipped = CHANGELOG[CHANGELOG.length - 1].version.split('.').map(Number);
    const archived = CHANGELOG_ARCHIVE[0].version.split('.').map(Number);
    const older =
      archived[0] - shipped[0] || archived[1] - shipped[1] || archived[2] - shipped[2];
    expect(older, `${CHANGELOG_ARCHIVE[0].version} should be older than ${CHANGELOG[CHANGELOG.length - 1].version}`).toBeLessThan(0);
  });

  /**
   * The losslessness proof: the frozen pre-cap history is a suffix of the
   * shipped list plus the archive, entry for entry and field for field.
   *
   * A release prepends the outgoing head to that list and takes the oldest
   * entry into the archive, which leaves the tail untouched -- so this survives
   * the rotation without needing to be re-pinned, while a dropped entry, a
   * reworded note, a reordered release or an insertion anywhere still shifts
   * the window.
   */
  it('shipped + archived still ends with the frozen pre-cap history', () => {
    const working = [...CHANGELOG.slice(1), ...CHANGELOG_ARCHIVE];
    expect(working.length).toBeGreaterThanOrEqual(CHANGELOG_HISTORY.length);
    expect(working.slice(working.length - CHANGELOG_HISTORY.length)).toEqual(CHANGELOG_HISTORY);
  });

  /**
   * ...and the part in front of it -- everything rotated in since the cap
   * landed -- is newest-first, has no duplicates, and joins onto the fixture
   * without a gap.
   */
  it('what has been rotated in since the cap is newest-first and contiguous', () => {
    const added = rotatedIn();
    const versions = added.map((release) => release.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort((a, b) => compareVersions(b, a));
    expect(versions).toEqual(sorted);
    if (added.length > 0) {
      const oldest = added[added.length - 1].version;
      expect(
        compareVersions(oldest, CHANGELOG_HISTORY[0].version),
        `${oldest} should be newer than the frozen head ${CHANGELOG_HISTORY[0].version}`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The cap's guard, and the reason it is a constant rather than a bare `30`:
   * appending a release to `changelog.ts` without moving the oldest shipped one
   * into the archive leaves 31 releases and this test fails on the spot. It is
   * what keeps the payload bounded instead of "capped once, in P141".
   */
  it('refuses a shipped list above the cap', () => {
    const releaseCount = CHANGELOG.length;
    const over = releaseCount > SHIPPED_CHANGELOG_LIMIT;
    expect(
      over,
      over
        ? `changelog.ts holds ${releaseCount} releases (cap ${SHIPPED_CHANGELOG_LIMIT}): move the oldest into changelog-archive.ts`
        : '',
    ).toBe(false);
    expect(releaseCount, 'the head entry is always shipped').toBeGreaterThan(0);
    expect(releaseCount).toBe(SHIPPED_CHANGELOG_LIMIT);
  });

  /**
   * The archive and the frozen fixture must stay out of the bundle, so no
   * runtime module may import either — least of all the lazily loaded changelog
   * panel, which would put the whole history back into a shipped chunk. Only
   * the test file above may reach them.
   */
  it('is imported by nothing that runs', () => {
    const guarded = ['changelog-archive', 'changelog-history.fixture'];
    const importers = runtimeSources('src').filter((file) => {
      if (guarded.some((name) => file.endsWith(`${name}.ts`))) return false;
      return new RegExp(`from\\s+'[^']*(${guarded.join('|')})'`).test(readFileSync(file, 'utf8'));
    });
    expect(importers).toEqual([]);
  });

  it('formats dates for both languages', () => {
    expect(releaseDateLabel('2026-09-10', 'zh')).toBe('2026 年 9 月 10 日');
    expect(releaseDateLabel('2026-09-10', 'en')).toBe('2026-09-10');
  });
});
