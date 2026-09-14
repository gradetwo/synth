/**
 * The write boundary.
 *
 * `docs/LLM-INTERFACE.md` §5 is explicit: a tool may write only the caller's
 * output path and never `src/`, never `release/`. The safest reading of that is
 * narrower than "the caller's path": **everything lands under `.tmp/mcp/`**, and
 * a requested path that escapes it is refused rather than clamped. A caller
 * that wants a file elsewhere is asking for something this server does not do.
 *
 * Reads are confined to the repository root for the same reason: `gs1.analyze`
 * can read a WAV the tools just wrote, not `/etc/passwd`.
 */
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { TMP_DIR, ROOT } from './data.mjs';
import { ERRORS, fail } from './errors.mjs';

/** Resolve and confine an output path under `.tmp/mcp/`. Creates the parent. */
export function resolveOutputPath(requested, defaultName) {
  const target = requested ? resolve(ROOT, requested) : resolve(TMP_DIR, defaultName);
  const rel = relative(TMP_DIR, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw fail(ERRORS.PATH, 'output path must stay inside .tmp/mcp/', {
      field: 'outPath',
      requested: requested ?? null,
      allowedRoot: '.tmp/mcp/',
    });
  }
  mkdirSync(dirname(target), { recursive: true });
  return target;
}

/** Resolve and confine a read path to the repository. */
export function resolveReadPath(requested, field = 'wavPath') {
  const target = resolve(ROOT, requested);
  const rel = relative(ROOT, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw fail(ERRORS.PATH, 'read path must stay inside the repository', {
      field,
      requested,
      allowedRoot: '.',
    });
  }
  return target;
}

/** A path as the tools report it: repository-relative, forward slashes. */
export function repoPath(absolute) {
  return relative(ROOT, absolute).split('\\').join('/');
}
