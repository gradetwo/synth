#!/usr/bin/env node
/**
 * The retained-version store shared by `release.mjs`, `rollback.mjs` and the
 * rollback drill (P12.4).
 *
 * Why a store and not "Cloudflare keeps the old deployment":
 *
 *   The Worker serves *static assets* (`wrangler.toml` → `[assets] directory =
 *   "./dist"`). Every file is content-hashed, so a new deploy does not overwrite
 *   an old file — it stops serving it. The one file that is *not* hashed is
 *   `index.html`, and it is the pointer: it names `assets/index-<hash>.js`. A
 *   rollback therefore needs the *whole* old tree (shell + everything it points
 *   at), not just the old HTML, or the app boots into 404s and starts silently
 *   (that failure mode is written up in `src/pwa/register.ts`).
 *
 *   Cloudflare's own version history can also roll back (`wrangler rollback`),
 *   but it is a remote, opaque list: we cannot assert ahead of time that the
 *   version we want is still there, and we cannot checksum what it would serve.
 *   Keeping our own copy of every release makes the rollback target a *local,
 *   checksummed* fact. `rollback.mjs` still offers the Cloudflare path as an
 *   opt-in fast path for "just go back one deployment".
 *
 * Store layout (default `release/retained/`, which is gitignored):
 *
 *   <store>/index.json                              — manifest (schema below)
 *   <store>/<version>/index.html                    — the shell pin
 *   <store>/<version>/sw.js                         — the service-worker pin
 *   <store>/<version>/sha256.txt                    — "<sha256>  <path>" per site file
 *   <store>/<version>/gs1-synth-<version>.tar.gz    — the full site snapshot
 *
 * **Retention policy (fixed here, overridable only for a one-off):** keep the
 * newest `KEEP_VERSIONS` (5) releases, prune the rest *only* after a release has
 * actually reached the live site, and never prune the version recorded as
 * `current`. The user-facing wording lives in `docs/notes/release.md`.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

/**
 * How many releases stay rollback-able.
 *
 * Five is the P12.4 policy: enough to cover "the last two or three releases
 * broke something for someone" plus the release in flight, small enough that the
 * store stays a few MB. It is a *constant on purpose* — the tooling must not
 * silently drift to "keep everything" (disk) or "keep one" (no way back).
 * `GS1_KEEP_VERSIONS` exists for a deliberate one-off, and a value outside 1…50
 * is rejected rather than clamped, so a typo cannot quietly disable pruning.
 */
export const KEEP_VERSIONS = 5;

/** Newest manifest schema this module writes; `readManifest` refuses anything newer. */
export const MANIFEST_SCHEMA = 1;

export const MANIFEST_NAME = 'index.json';

/** The default store: `<repo>/release/retained`. */
export const defaultStore = (root) => resolve(root, 'release', 'retained');

/** The `gs1-<hash>` cache name baked into a generated `sw.js`. */
export function swCacheOf(swSource) {
  return swSource.match(/'gs1-[A-Za-z0-9]+'/)?.[0]?.replace(/'/g, '') ?? '';
}

/** The `assets/index-<hash>.js` the shell points at — the live-build fingerprint. */
export function indexHashOf(html) {
  return html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? '';
}

/** Numeric x.y.z compare, so `2.0.10 > 2.0.9` and pre-release strings never sort as newer. */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export const stripV = (version) => String(version).replace(/^v/, '');

/**
 * The retention window, from `GS1_KEEP_VERSIONS` or the constant above.
 *
 * Rejected rather than clamped: this value decides how much history is
 * destroyed, and `"5o"` silently becoming 5 hides the typo that produced it.
 */
export function keepVersionsFromEnv(env = process.env) {
  const raw = env.GS1_KEEP_VERSIONS;
  if (raw == null || raw === '') return KEEP_VERSIONS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error(`GS1_KEEP_VERSIONS must be an integer in 1…50, got "${raw}"`);
  }
  return n;
}

export const versionDir = (store, version) => join(store, stripV(version));
export const manifestPath = (store) => join(store, MANIFEST_NAME);

export const emptyManifest = (keep) => ({
  schema: MANIFEST_SCHEMA,
  keep,
  current: null,
  versions: [],
  events: [],
});

/**
 * Read the manifest.
 *
 * A missing file is a fresh store (the first release after this batch). A file
 * that exists but does not parse is an *error*: treating it as "fresh" would
 * silently drop the record of every version we promised to keep, and the next
 * prune would then see nothing to protect.
 */
export function readManifest(store, { keep = KEEP_VERSIONS } = {}) {
  const path = manifestPath(store);
  if (!existsSync(path)) return emptyManifest(keep);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`retained: ${path} is not valid JSON — ${error.message}`);
  }
  if ((parsed.schema ?? 0) > MANIFEST_SCHEMA) {
    throw new Error(`retained: ${path} has schema ${parsed.schema}, newer than this tooling (${MANIFEST_SCHEMA})`);
  }
  return {
    ...emptyManifest(keep),
    ...parsed,
    keep: parsed.keep ?? keep,
    versions: Array.isArray(parsed.versions) ? parsed.versions : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

export function writeManifest(store, manifest) {
  mkdirSync(store, { recursive: true });
  writeFileSync(manifestPath(store), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Newest first; ties broken by `retainedAt`, then by version number. */
export function sortVersions(versions) {
  return [...versions].sort((a, b) => {
    const byTime = String(b.retainedAt ?? '').localeCompare(String(a.retainedAt ?? ''));
    if (byTime !== 0) return byTime;
    return compareVersions(b.version, a.version);
  });
}

export function findVersion(manifest, spec) {
  const want = stripV(spec);
  return manifest.versions.find((entry) => stripV(entry.version) === want) ?? null;
}

/**
 * Which entries survive the window — pure, so the self-test can prove the
 * off-by-one is not there.
 *
 * Keeps the newest `keep` by retention time and always keeps `current` (the
 * version we would need to get back to if the *next* release is the bad one),
 * and returns the rest for deletion.
 */
export function planPrune(versions, keep, { current = null } = {}) {
  const sorted = sortVersions(versions);
  const currentVersion = current ? stripV(current.version ?? '') : '';
  const kept = [];
  const pruned = [];
  for (const entry of sorted) {
    const isCurrent = stripV(entry.version) === currentVersion;
    if (kept.length < keep || isCurrent) kept.push(entry);
    else pruned.push(entry);
  }
  if (pruned.length && kept.length < keep) {
    // Unreachable for keep >= 1 (kept only grows once it reaches the window);
    // it is the assertion that "delete more than the window allows" can never
    // become reachable by a later edit.
    throw new Error(`retained: refusing to prune ${pruned.length} versions with only ${kept.length} kept (keep=${keep})`);
  }
  return { kept, pruned };
}

/**
 * The version a drill should roll back to: the newest retained version that is
 * not the candidate and does not serve the same shell. Comparing the *hash* as
 * well as the version string covers a candidate that was never recorded.
 */
export function pickRollbackTarget(versions, { candidateVersion = '', candidateHash = '' } = {}) {
  return (
    sortVersions(versions).find(
      (entry) =>
        stripV(entry.version) !== stripV(candidateVersion) &&
        (!candidateHash || entry.indexHash !== candidateHash),
    ) ?? null
  );
}

export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * The localStorage document schema this checkout writes, or null if it cannot
 * be read.
 *
 * Recorded with every retained release because rolling *back* across a schema
 * bump is the one rollback that can destroy user work: `src/state/persist.ts`
 * reads a document whose `schema` is newer than the build's `SCHEMA_VERSION` as
 * `null`, i.e. the app comes up with defaults instead of the project the user
 * saved with the newer build. Recording the number turns that from a paragraph
 * in a document into a check `rollback.mjs` can actually make.
 */
export function readStoreSchema(repoRoot) {
  try {
    const text = readFileSync(join(repoRoot, 'src', 'state', 'persist.ts'), 'utf8');
    const value = text.match(/export const SCHEMA_VERSION\s*=\s*(\d+)/)?.[1];
    return value ? Number(value) : null;
  } catch {
    return null;
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Every site file with its sha256 — the pin the rollback re-checks after extraction. */
export function checksumTree(dir) {
  return walk(dir)
    .map((file) => ({
      path: relative(dir, file).split('\\').join('/'),
      sha256: sha256File(file),
      bytes: statSync(file).size,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function parseChecksums(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha256, ...rest] = line.split(/\s+/);
      return { sha256, path: rest.join(' ') };
    });
}

const sumsText = (files) => `${files.map((f) => `${f.sha256}  ${f.path}`).join('\n')}\n`;

/**
 * Copy one release into the store.
 *
 * `tarPath` is the artifact `npm run package` already produced — the store does
 * not re-zip the site, it keeps the exact bytes that were packaged and
 * checksummed, so "what we would roll back to" and "what we shipped" are the
 * same file. Returns the manifest entry (the caller records it).
 */
export function retainVersion({ store, version, distDir, tarPath, storeSchema = null, now = new Date() }) {
  const v = stripV(version);
  const dir = versionDir(store, v);
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const sw = readFileSync(join(distDir, 'sw.js'), 'utf8');
  const indexHash = indexHashOf(html);
  const swCache = swCacheOf(sw);
  if (!indexHash) throw new Error(`retained: ${distDir}/index.html has no assets/index-*.js`);
  if (!swCache) throw new Error(`retained: ${distDir}/sw.js has no gs1-* cache id`);
  if (!existsSync(tarPath)) throw new Error(`retained: missing package artifact ${tarPath}`);

  const files = checksumTree(distDir);
  const tar = basename(tarPath);
  const existingPin = join(dir, 'index.html');
  const previous = existsSync(existingPin) ? indexHashOf(readFileSync(existingPin, 'utf8')) : null;
  if (previous && previous !== indexHash) {
    // Same version number, different build: allowed (a re-run after a failed
    // release), but it rewrites history, so say so loudly.
    console.warn(`[retained] v${v} was already retained with shell ${previous}; overwriting with ${indexHash}`);
  }

  mkdirSync(dir, { recursive: true });
  copyFileSync(join(distDir, 'index.html'), join(dir, 'index.html'));
  copyFileSync(join(distDir, 'sw.js'), join(dir, 'sw.js'));
  writeFileSync(join(dir, 'sha256.txt'), sumsText(files));
  copyFileSync(tarPath, join(dir, tar));

  return {
    version: v,
    indexHash,
    swCache,
    storeSchema,
    retainedAt: now.toISOString(),
    tar,
    tarSha256: sha256File(join(dir, tar)),
    tarBytes: statSync(join(dir, tar)).size,
    siteFiles: files.length,
    siteBytes: files.reduce((sum, f) => sum + f.bytes, 0),
  };
}

/**
 * Record a release (or a rollback) in the manifest and prune the window.
 *
 * `action: 'release'` makes `version` the new current; `action: 'rollback'`
 * moves `current` back to an already-retained version. Both append an event, so
 * the store can answer "what is live, and how did it get there" without reading
 * the site. Pruning happens *here* — i.e. only on a release that has already
 * reached the live site (see `release.mjs`), never on a dry run.
 */
export function recordVersion({
  store,
  entry,
  action,
  from = null,
  keep = KEEP_VERSIONS,
  now = new Date(),
  dryRun = false,
  log = () => {},
}) {
  const manifest = readManifest(store, { keep });
  const versions = sortVersions([
    ...manifest.versions.filter((e) => stripV(e.version) !== stripV(entry.version)),
    { ...entry, retainedAt: entry.retainedAt ?? now.toISOString() },
  ]);
  const merged = {
    ...manifest,
    keep,
    versions,
    current: {
      version: stripV(entry.version),
      indexHash: entry.indexHash,
      swCache: entry.swCache,
      at: now.toISOString(),
      action,
    },
    events: [
      ...manifest.events,
      { at: now.toISOString(), action, version: stripV(entry.version), indexHash: entry.indexHash, from },
    ].slice(-50),
  };
  const { kept, pruned } = planPrune(merged.versions, keep, { current: merged.current });
  if (!dryRun) {
    writeManifest(store, { ...merged, versions: kept });
    for (const gone of pruned) {
      const dir = versionDir(store, gone.version);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const gone of pruned) log(`[retained] prune v${gone.version} (outside the newest ${keep})`);
  return { manifest: { ...merged, versions: kept }, pruned, kept };
}

/**
 * Re-materialise a retained release into `dest`, then prove the bytes are the
 * ones we pinned.
 *
 * The extraction is checked file by file against `sha256.txt` rather than only
 * spot-checking `index.html`: a truncated tar or a half-written store otherwise
 * deploys a site that *looks* right (right shell hash) while an asset 404s.
 */
export function materializeSite({ store, entry, dest, log = () => {} }) {
  const dir = versionDir(store, entry.version);
  const tar = join(dir, entry.tar);
  if (!existsSync(tar)) throw new Error(`retained: v${entry.version} has no snapshot at ${tar}`);
  const actualTar = sha256File(tar);
  if (actualTar !== entry.tarSha256) {
    throw new Error(`retained: v${entry.version} snapshot hash ${actualTar} != pinned ${entry.tarSha256}`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-xzf', tar, '-C', dest], { stdio: 'inherit' });
  const pinned = parseChecksums(readFileSync(join(dir, 'sha256.txt'), 'utf8'));
  const actual = checksumTree(dest);
  const byPath = new Map(actual.map((f) => [f.path, f.sha256]));
  const wrong = pinned.filter((f) => byPath.get(f.path) !== f.sha256);
  const extra = actual.filter((f) => !pinned.some((p) => p.path === f.path));
  if (wrong.length || extra.length) {
    const detail = [...wrong.map((f) => `changed ${f.path}`), ...extra.map((f) => `extra ${f.path}`)]
      .slice(0, 5)
      .join(', ');
    throw new Error(`retained: v${entry.version} extraction does not match its pin (${detail})`);
  }
  const htmlHash = indexHashOf(readFileSync(join(dest, 'index.html'), 'utf8'));
  if (htmlHash !== entry.indexHash) {
    throw new Error(
      `retained: v${entry.version} extracted shell points at ${htmlHash || '(none)'}, pinned ${entry.indexHash}`,
    );
  }
  log(`[retained] v${entry.version}: ${actual.length} files verified against the pin`);
  return { dir: dest, indexHash: htmlHash };
}

/** Timeout-bearing fetch options; `AbortSignal.timeout` is missing on very old Node. */
const opts = (timeoutMs) => ({
  headers: { 'cache-control': 'no-cache' },
  signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
});

/**
 * Ask the live site which build it is serving.
 *
 * The cache-busting query is the same trick `release.mjs` uses, and it matters:
 * the CDN will happily hand back an old `index.html`, which is exactly the
 * failure this whole file exists to detect.
 */
export async function fetchLiveIndexHash(site, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const url = `${site}/?cb=${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const res = await fetchImpl(url, opts(timeoutMs));
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const hash = indexHashOf(await res.text());
  if (!hash) throw new Error(`${url} carried no assets/index-*.js (is this really the app?)`);
  return hash;
}

export async function fetchLiveSwCache(site, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const url = `${site}/sw.js?cb=${Date.now()}`;
  const res = await fetchImpl(url, opts(timeoutMs));
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return swCacheOf(await res.text());
}

/**
 * Poll until the live shell matches `expectedHash`.
 *
 * Returns a verdict instead of throwing so each caller chooses its exit path,
 * and reports every attempt — the log is where "the edge was four attempts
 * behind" becomes visible.
 */
export async function verifyLive({
  site,
  expectedHash,
  attempts = 6,
  delayMs = 5000,
  fetchImpl = fetch,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = () => {},
}) {
  let live = '';
  let error = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (delayMs) await wait(delayMs);
    try {
      live = await fetchLiveIndexHash(site, { fetchImpl });
      error = '';
    } catch (err) {
      live = '';
      error = err.message;
    }
    const ok = live === expectedHash;
    log(
      `[retained]   attempt ${attempt}/${attempts}: live ${live || (error ? `(error: ${error})` : '(none)')} ${ok ? '== ' : '!= '} expected ${expectedHash}`,
    );
    if (ok) return { ok: true, live, attempts: attempt, error: '' };
  }
  return { ok: false, live, attempts, error };
}

/**
 * The `wrangler.toml` a rollback deploys with.
 *
 * Rollback is "deploy the retained bytes at the root", not "overwrite `dist/`
 * and hope to rebuild it later": the generated config points `[assets]` at the
 * extracted snapshot and keeps everything else (the worker `name` above all)
 * from the checked-in file. It is written *next to* the snapshot, never inside
 * it, or `wrangler` would upload the config as a site asset.
 */
export function writeRollbackConfig({ repoRoot, version, siteDir, outPath }) {
  const source = readFileSync(join(repoRoot, 'wrangler.toml'), 'utf8');
  const withDir = source.replace(/^(\s*directory\s*=\s*).*$/m, (_m, prefix) => `${prefix}"${siteDir}"`);
  if (withDir === source) throw new Error('retained: wrangler.toml has no [assets] directory line to retarget');
  writeFileSync(outPath, `# generated by scripts/rollback.mjs for v${stripV(version)} — do not edit\n${withDir}`);
  return outPath;
}

/**
 * Would rolling back to `target` move backwards across a storage-schema bump?
 *
 * Pure, so the self-test can pin both directions. `unknown` is its own answer:
 * a release retained before the schema was recorded gets a note rather than a
 * silent pass.
 */
export function schemaRollbackRisk(target, liveEntry) {
  if (!target || !liveEntry) return { risky: false, unknown: false, detail: '' };
  if (target.storeSchema == null || liveEntry.storeSchema == null) {
    return {
      risky: false,
      unknown: true,
      detail: `v${target.version} was retained without a storage schema${
        liveEntry.storeSchema != null ? `, the live v${liveEntry.version} writes schema ${liveEntry.storeSchema}` : ''
      }`,
    };
  }
  if (target.storeSchema >= liveEntry.storeSchema) return { risky: false, unknown: false, detail: '' };
  return {
    risky: true,
    unknown: false,
    detail: `v${target.version} reads localStorage schema ${target.storeSchema}, while the live v${liveEntry.version} writes schema ${liveEntry.storeSchema}; a client that stored a document with the newer build reads it back as *defaults* (persist.ts returns null when schema > SCHEMA_VERSION)`,
  };
}

export function formatStore(manifest) {
  const lines = [
    `[retained] keep newest ${manifest.keep}; current ${
      manifest.current ? `v${manifest.current.version} (${manifest.current.indexHash})` : '(none recorded)'
    }`,
  ];
  if (!manifest.versions.length) lines.push('[retained]   store is empty');
  for (const entry of sortVersions(manifest.versions)) {
    const current = manifest.current?.version === entry.version ? ' ← current' : '';
    lines.push(
      `[retained]   v${String(entry.version).padEnd(9)} shell ${String(entry.indexHash).padEnd(12)} sw ${String(
        entry.swCache,
      ).padEnd(12)} schema ${String(entry.storeSchema ?? '?').padEnd(2)} ${(entry.siteBytes / 1024)
        .toFixed(0)
        .padStart(4)} KB  ${entry.retainedAt}${current}`,
    );
  }
  return lines.join('\n');
}
