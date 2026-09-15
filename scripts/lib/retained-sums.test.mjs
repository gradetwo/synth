import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseChecksums, verifyReleaseSums, writeReleaseSums } from './retained.mjs';

/**
 * §一.20⑧: `release/SHA256SUMS` used to describe one version — whichever was
 * packaged last — while the rollback store kept five. The fix is
 * `writeReleaseSums` (shared by `package.mjs` and `release.mjs`), and these
 * cases are its proof: the retained snapshots are in the manifest, the store's
 * non-artefact files are not, and the manifest's own re-hash actually rejects a
 * file whose bytes changed.
 */

const hashOf = (text) => createHash('sha256').update(text).digest('hex');

describe('release/SHA256SUMS covers every retained snapshot (§一.20⑧)', () => {
  const roots = [];
  const makeRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'gs1-sums-'));
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("lists this release's artefacts and every retained snapshot, oldest first", () => {
    const root = makeRoot();
    const release = join(root, 'release');
    const store = join(release, 'retained');
    mkdirSync(join(store, '2.1.3'), { recursive: true });
    mkdirSync(join(store, '2.1.4'), { recursive: true });
    // The store's other files are pins, not artefacts: `sha256.txt` covers that
    // version's site files (which `materializeSite` re-checks) and must not leak
    // into the top-level manifest as if it were a downloadable.
    writeFileSync(join(store, '2.1.3', 'sha256.txt'), 'whatever\n');
    writeFileSync(join(store, '2.1.3', 'index.html'), '<html></html>');
    writeFileSync(join(store, '2.1.3', 'gs1-synth-2.1.3.tar.gz'), 'tar-old');
    writeFileSync(join(store, '2.1.4', 'gs1-synth-2.1.4.tar.gz'), 'tar-new');
    writeFileSync(join(release, 'gs1-synth-2.1.4.zip'), 'zip');

    const { count, path } = writeReleaseSums({ root, extra: [join(release, 'gs1-synth-2.1.4.zip')] });

    expect(path).toBe(join(release, 'SHA256SUMS'));
    expect(count).toBe(3);
    const entries = parseChecksums(readFileSync(path, 'utf8'));
    expect(entries.map((entry) => entry.path)).toEqual([
      'release/gs1-synth-2.1.4.zip',
      'release/retained/2.1.3/gs1-synth-2.1.3.tar.gz',
      'release/retained/2.1.4/gs1-synth-2.1.4.tar.gz',
    ]);
    expect(entries.map((entry) => entry.sha256)).toEqual([hashOf('zip'), hashOf('tar-old'), hashOf('tar-new')]);
  });

  it('works before the store exists (the first release after this batch)', () => {
    const root = makeRoot();
    const release = join(root, 'release');
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'gs1-synth-2.1.4.tar.gz'), 'tar');
    expect(writeReleaseSums({ root, extra: [join(release, 'gs1-synth-2.1.4.tar.gz')] }).count).toBe(1);
  });

  it('rejects a snapshot whose bytes changed after the manifest was written', () => {
    const root = makeRoot();
    const release = join(root, 'release');
    const snapshot = join(release, 'retained', '2.1.4', 'gs1-synth-2.1.4.tar.gz');
    mkdirSync(join(release, 'retained', '2.1.4'), { recursive: true });
    writeFileSync(snapshot, 'pinned');
    writeReleaseSums({ root, extra: [snapshot] });
    // The writer's self-check ran against the pinned bytes; change them and ask
    // the verifier again. This is the assertion, not a log line.
    writeFileSync(snapshot, 'tampered');
    expect(() => verifyReleaseSums({ root, path: join(release, 'SHA256SUMS') })).toThrow(
      /gs1-synth-2\.1\.4\.tar\.gz does not match the manifest/,
    );
  });

  it('rejects a manifest that lists a file which is gone', () => {
    const root = makeRoot();
    const release = join(root, 'release');
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'gs1-synth-2.1.4.zip'), 'zip');
    writeReleaseSums({ root, extra: [join(release, 'gs1-synth-2.1.4.zip')] });
    rmSync(join(release, 'gs1-synth-2.1.4.zip'));
    expect(() => verifyReleaseSums({ root, path: join(release, 'SHA256SUMS') })).toThrow(
      /is listed but does not exist/,
    );
  });

  it('refuses an empty manifest instead of calling it verified', () => {
    const root = makeRoot();
    const release = join(root, 'release');
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'SHA256SUMS'), '\n');
    expect(() => verifyReleaseSums({ root, path: join(release, 'SHA256SUMS') })).toThrow(/is empty/);
  });
});
