#!/usr/bin/env node
/**
 * Rotate the release notes: move the outgoing head into the shipped list and
 * the oldest shipped entry into the archive.
 *
 * A release adds one entry to `src/changelog-head.ts`, and the cap in
 * `src/changelog.ts` (`SHIPPED_CHANGELOG_LIMIT = 30`, head included) means
 * something has to leave for it. The move is mechanical but fiddly -- it is two
 * blocks of multi-kilobyte prose and a comma -- and doing it by hand produced
 * both of the mistakes this file exists to prevent: a dropped `]` on the array
 * (which esbuild caught) and an off-by-one that left 31 entries against a
 * documented 30 (which the test caught).
 *
 *   node scripts/changelog-rotate.mjs                        # rotate, then write the new head
 *   node scripts/changelog-rotate.mjs --dry-run              # print what would move
 *
 * Order matters, and it is: **rotate first, then overwrite
 * `src/changelog-head.ts` with the new entry, then run the tests.** Between the
 * two steps the outgoing entry is both the head and the first shipped literal,
 * and `changelog.test.ts`'s duplicate and "leads with the current version"
 * checks reject that on purpose (correctly: the panel would list it twice). The
 * losslessness check tolerates it, but those two do not, so the two edits are
 * one operation and nothing should run in between. Verified end to end:
 * rotating and writing a new head leaves all eight changelog tests green (given
 * a matching version in `package.json`).
 *
 * The TypeScript parser does the finding, not a regex: the notes contain
 * `version:` and apostrophes, and the last thing this should do is guess where
 * an entry ends.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const SHIPPED = resolve(root, 'src/changelog.ts');
const ARCHIVE = resolve(root, 'src/changelog-archive.ts');
const HEAD = resolve(root, 'src/changelog-head.ts');

const die = (message) => {
  console.error(`[rotate] ${message}`);
  process.exit(1);
};

/** The initializer expression of `name`, with the source file it was parsed from. */
function initializer(source, name) {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find((d) => d.name.getText(file) === name);
    if (declaration?.initializer) return { file, node: declaration.initializer };
  }
  throw new Error(`could not find ${name}`);
}

const versionOf = (text) => /version: '([^']+)'/.exec(text)?.[1] ?? '(unknown)';

const headSource = readFileSync(HEAD, 'utf8');
const shippedSource = readFileSync(SHIPPED, 'utf8');
const archiveSource = readFileSync(ARCHIVE, 'utf8');

const head = initializer(headSource, 'CHANGELOG_HEAD');
const headText = headSource.slice(head.node.getStart(head.file), head.node.getEnd());

const list = initializer(shippedSource, 'CHANGELOG');
if (!ts.isArrayLiteralExpression(list.node)) die('CHANGELOG is not an array literal');
const elements = list.node.elements.map((element) =>
  shippedSource.slice(element.getStart(list.file), element.getEnd()),
);
const [headReference, ...literals] = elements;
if (!headReference) die('CHANGELOG has no head reference');
if (literals.length === 0) die('CHANGELOG has nothing to rotate');

const headVersion = versionOf(headText);
const shippedVersions = literals.map(versionOf);
if (shippedVersions.includes(headVersion)) {
  die(
    `the head (${headVersion}) is already in the shipped list: this release was rotated once already, ` +
      'or the new head was written without rotating. Nothing changed.',
  );
}

const dropped = literals[literals.length - 1];
const kept = literals.slice(0, -1);
if (kept.length + 1 !== literals.length) die('internal: rotation did not keep the shipped count');

// CHANGELOG = [head reference, outgoing head, ...the rest, minus the oldest]
const arrayStart = shippedSource.indexOf('[', list.node.getStart(list.file));
const arrayEnd = list.node.getEnd(list.file);
const rendered = [`  ${headReference},`, `  ${headText},`, ...kept.map((text) => `  ${text},`)].join('\n');
// `arrayEnd` is one past the `]`, so slice from `arrayEnd - 1` to keep it.
const nextShipped = `${shippedSource.slice(0, arrayStart + 1)}\n${rendered}\n${shippedSource.slice(arrayEnd - 1)}`;

// CHANGELOG_ARCHIVE = [the dropped entry, ...what was there]
const archive = initializer(archiveSource, 'CHANGELOG_ARCHIVE');
if (!ts.isArrayLiteralExpression(archive.node)) die('CHANGELOG_ARCHIVE is not an array literal');
const archiveStart = archiveSource.indexOf('[', archive.node.getStart(archive.file));
const nextArchive =
  archiveSource.slice(0, archiveStart + 1) +
  `\n  ${dropped},\n` +
  archiveSource.slice(archiveStart + 1).replace(/^\n/, '');

console.log(`[rotate] head        ${headVersion} -> stays a reference until you rewrite changelog-head.ts`);
console.log(`[rotate] starts shipping ${headVersion}`);
console.log(`[rotate] archives    ${versionOf(dropped)}`);
console.log(`[rotate] shipped literals after: ${kept.length + 1}, archive entries: ${archive.node.elements.length + 1}`);

if (dryRun) {
  console.log('[rotate] DRY RUN — nothing written');
  process.exit(0);
}

writeFileSync(SHIPPED, nextShipped);
writeFileSync(ARCHIVE, nextArchive);
console.log(`[rotate] wrote src/changelog.ts (${kept.length + 2} entries: head reference + ${kept.length + 1} literals) and src/changelog-archive.ts`);
console.log('[rotate] now rewrite src/changelog-head.ts with the new release, then run "npx vitest run src/changelog.test.ts"');
