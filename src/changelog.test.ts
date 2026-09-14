import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CHANGELOG, CURRENT_VERSION, SHIPPED_CHANGELOG_LIMIT, releaseDateLabel, type Release } from './changelog';
import { CHANGELOG_ARCHIVE } from './changelog-archive';

/**
 * The shipped list is capped (P141): one more release costs one more entry, not
 * another ~1.2 KB of permanently shipped payload. The archive keeps the rest of
 * the history, and the tests below prove the cap did not lose anything.
 */

/**
 * Reading release notes out of a source file, or out of a git revision.
 *
 * The file is parsed with the TypeScript compiler instead of a regex so a note
 * that contains `version:` or a `'` cannot confuse the reader.
 */
function initializerOf(source: string, name: string): ts.Expression {
  const file = ts.createSourceFile('changelog.ts', source, ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find((d) => d.name.getText(file) === name);
    if (declaration?.initializer) return declaration.initializer;
  }
  throw new Error(`could not find ${name} in the source`);
}

const literalOf = (node: ts.Node): ts.ArrayLiteralExpression => {
  if (ts.isArrayLiteralExpression(node)) return node;
  if (ts.isAsExpression(node) && ts.isArrayLiteralExpression(node.expression)) return node.expression;
  throw new Error(`not an array literal: ${ts.SyntaxKind[node.kind]}`);
};

/**
 * The *value* of a string literal, not its source text: notes contain escaped
 * apostrophes (`file\'s`), and comparing the raw token against the runtime
 * string would fail on a difference that does not exist.
 */
const stringOf = (node: ts.Expression): string => {
  if (!ts.isStringLiteral(node)) throw new Error(`not a string literal: ${ts.SyntaxKind[node.kind]}`);
  return node.text;
};

const property = (object: ts.ObjectLiteralExpression, name: string): ts.Expression => {
  const found = object.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name,
  );
  if (!found) throw new Error(`missing property ${name} at ${object.pos}`);
  return found.initializer;
};

const releaseOf = (element: ts.Expression): Release => {
  if (!ts.isObjectLiteralExpression(element)) throw new Error('changelog element is not an object literal');
  const items = literalOf(property(element, 'items'));
  return {
    version: stringOf(property(element, 'version')),
    date: stringOf(property(element, 'date')),
    kind: stringOf(property(element, 'kind')) as Release['kind'],
    items: items.elements.map((pair) => {
      const [zh, en] = literalOf(pair).elements.map((part) => stringOf(part));
      return [zh, en] as [string, string];
    }),
  };
};

/**
 * The full history as the **previous release tag** carried it.
 *
 * The anchor has to be something that does not move while the release notes are
 * being written, and `HEAD` is exactly the wrong one: the release commit *is*
 * the commit that adds the new entry, so a `HEAD`-based reference makes this
 * file's own losslessness check fail the moment it is committed. P141's first
 * version did that — the tests passed in the tree they were written in and went
 * red on the commit that shipped them.
 *
 * A tag is a fixed point instead: while a release is being prepared the latest
 * tag is the release before it, which is precisely the history the new notes
 * have to extend. The check is stronger than "nothing was dropped": the working
 * history must be the tag's history, entry for entry and field for field, with
 * the new head prepended — a reworded note, a reordered release or a
 * half-copied entry fails, not just a missing one.
 */
function taggedHistory(): Release[] {
  const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8' }).trim();
  const at = (file: string): string | null => {
    try {
      return execFileSync('git', ['show', `${tag}:${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // The archive exists only from the split onwards; older tags have no file.
      return null;
    }
  };
  const head = at('src/changelog-head.ts');
  const shipped = at('src/changelog.ts');
  if (!head || !shipped) throw new Error(`could not read the release history at ${tag}`);
  const archive = at('src/changelog-archive.ts');
  return [
    releaseOf(initializerOf(head, 'CHANGELOG_HEAD')),
    // The head is the first element and a reference, not an object literal.
    ...literalOf(initializerOf(shipped, 'CHANGELOG')).elements.slice(1).map(releaseOf),
    ...(archive ? literalOf(initializerOf(archive, 'CHANGELOG_ARCHIVE')).elements.map(releaseOf) : []),
  ];
}

const PREVIOUS = taggedHistory();
/** Newest first, so the previous release's head is the first entry. */
const PREVIOUS_HEAD = PREVIOUS[0].version;


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
   * The losslessness proof: the shipped releases and the archive, entry for
   * entry and field for field, are the previous tag's history with the new head
   * prepended. `taggedHistory()` explains why the reference is a tag and not
   * `HEAD`.
   *
   * The previous release's own entry is allowed to be in either place -- still
   * only a head (the notes are written before the cap is applied) or already
   * rotated in at the top of the shipped list -- but where it appears it has to
   * be verbatim, so a hand-copied entry is compared too.
   */
  it('shipped + archived is the previous tag\'s history, with the new head in front', () => {
    const working = [...CHANGELOG.slice(1), ...CHANGELOG_ARCHIVE];
    for (const entry of working.filter((release) => release.version === PREVIOUS_HEAD)) {
      expect(entry).toEqual(PREVIOUS[0]);
    }
    expect(working.filter((release) => release.version !== PREVIOUS_HEAD)).toEqual(PREVIOUS.slice(1));
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
   * The archive must stay out of the bundle, so no runtime module may import it
   * — least of all the lazily loaded changelog panel, which would put the whole
   * history back into a shipped chunk. Only the test file above may reach it.
   */
  it('is imported by nothing that runs', () => {
    const importers = runtimeSources('src').filter((file) => {
      if (file.endsWith('changelog-archive.ts')) return false;
      return /from\s+'[^']*changelog-archive'/.test(readFileSync(file, 'utf8'));
    });
    expect(importers).toEqual([]);
  });

  it('formats dates for both languages', () => {
    expect(releaseDateLabel('2026-09-10', 'zh')).toBe('2026 年 9 月 10 日');
    expect(releaseDateLabel('2026-09-10', 'en')).toBe('2026-09-10');
  });
});
