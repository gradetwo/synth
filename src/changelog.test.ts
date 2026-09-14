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
 * The complete pre-split history, read from the tree as it was *before* the
 * split. Deriving it from git rather than snapshotting it means the comparison
 * below is a real lossless-move check: if a later edit drops, reorders or
 * rewrites an archived entry, the two lists stop matching.
 *
 * The file is parsed with the TypeScript compiler instead of a regex so a note
 * that contains `version:` or a `'` cannot confuse the reader.
 */
function originalHistory(): Release[] {
  const source = execFileSync('git', ['show', 'HEAD:src/changelog.ts'], { encoding: 'utf8' });
  const file = ts.createSourceFile('changelog.ts', source, ts.ScriptTarget.Latest, true);

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
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(file) === name,
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

  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find((d) => d.name.getText(file) === 'CHANGELOG');
    if (!declaration?.initializer) continue;
    // The head is the first element and a reference, not an object literal; it
    // is pinned to `CHANGELOG[0]` by the "leads with the version" test above.
    return literalOf(declaration.initializer)
      .elements.slice(1)
      .map((element) => releaseOf(element));
  }
  throw new Error('could not find the pre-split CHANGELOG array in git');
}

const ORIGINAL = originalHistory();

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

  it('ships exactly the newest 30 releases behind the head, and archives the rest', () => {
    // `CHANGELOG` carries the head reference plus the newest 30 releases;
    // `ORIGINAL` lists the releases only (its first element is a reference to
    // the head, which the tests above pin to `CHANGELOG[0]`).
    expect(CHANGELOG).toHaveLength(SHIPPED_CHANGELOG_LIMIT + 1);
    expect(CHANGELOG_ARCHIVE).toHaveLength(ORIGINAL.length - SHIPPED_CHANGELOG_LIMIT);
    // The first archived release is the one right after the last shipped one.
    expect(CHANGELOG_ARCHIVE[0]).toEqual(ORIGINAL[SHIPPED_CHANGELOG_LIMIT]);
  });

  /**
   * The move's proof: the shipped releases and the archive, entry for entry and
   * field for field, in order, are the list the app shipped before the cap. A
   * dropped archived entry, a rewritten note or a reordered release all fail
   * here.
   */
  it('shipped + archived is the complete, unchanged history', () => {
    expect([...CHANGELOG.slice(1), ...CHANGELOG_ARCHIVE]).toEqual(ORIGINAL);
  });

  /**
   * The cap's guard, and the reason it is a constant rather than a bare `30`:
   * appending a release to `changelog.ts` without moving the oldest shipped one
   * into the archive leaves 31 releases and this test fails on the spot. It is
   * what keeps the payload bounded instead of "capped once, in P141".
   */
  it('refuses a shipped list above the cap', () => {
    const releaseCount = CHANGELOG.length - 1;
    const over = releaseCount > SHIPPED_CHANGELOG_LIMIT;
    expect(
      over,
      over
        ? `changelog.ts holds ${releaseCount} releases (cap ${SHIPPED_CHANGELOG_LIMIT}): move the oldest into changelog-archive.ts`
        : '',
    ).toBe(false);
    expect(releaseCount, 'the head entry is always shipped').toBeGreaterThan(0);
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
