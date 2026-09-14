#!/usr/bin/env node
/**
 * Roll the live site back to a retained release — and *prove* it landed.
 *
 *   npm run rollback                          # list what is retained
 *   npm run rollback -- 2.0.3                 # dry run (the default): plan + live read
 *   npm run rollback -- 2.0.3 --apply         # actually deploy the retained snapshot
 *   npm run rollback -- 2.0.3 --check-only    # read-only: is v2.0.3 what is live?
 *   npm run rollback -- --self-test           # hermetic checks of the window + the hash gate
 *
 * Two decisions worth stating up front.
 *
 * 1. **A rollback is a forward deploy of old bytes.** The Worker serves static
 *    assets, and every asset is content-hashed, so the current deployment does
 *    not contain the old `assets/index-<hash>.js` at all. The only honest
 *    rollback is "upload the old tree again". `--cf-rollback <version-id>` uses
 *    Cloudflare's own version history instead (no re-upload) when that is
 *    available and known; it is opt-in because the target then lives in a remote
 *    list we cannot checksum ahead of time.
 * 2. **`--dry-run` is the default, not an extra flag.** The failure path is
 *    exercised locally (`--self-test`, and `--expect-index` against a mirror),
 *    never by pointing production somewhere wrong. `--apply` additionally
 *    demands either `--yes` or an interactive confirmation.
 *
 * Files: `scripts/lib/retained.mjs` (store + verifier), `scripts/lib/release-env.mjs`
 * (site + token). The store, the policy and the PWA consequences are documented
 * in `docs/notes/release.md`.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  KEEP_VERSIONS,
  compareVersions,
  defaultStore,
  fetchLiveIndexHash,
  fetchLiveSwCache,
  findVersion,
  formatStore,
  indexHashOf,
  keepVersionsFromEnv,
  materializeSite,
  pickRollbackTarget,
  planPrune,
  readManifest,
  readStoreSchema,
  recordVersion,
  retainVersion,
  schemaRollbackRisk,
  sha256File,
  sortVersions,
  stripV,
  swCacheOf,
  verifyLive,
  versionDir,
  writeManifest,
  writeRollbackConfig,
} from './lib/retained.mjs';
import { cloudflareToken, resolveSite } from './lib/release-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ arguments

const VALUE_FLAGS = new Set(['site', 'store', 'expect-index', 'attempts', 'delay', 'keep', 'cf-rollback']);
const argv = process.argv.slice(2);
const flags = {
  apply: false,
  dryRun: false,
  checkOnly: false,
  selfTest: false,
  force: false,
  yes: false,
  quiet: false,
};
const values = { site: '', store: '', expectIndex: '', attempts: '', delay: '', keep: '', cfRollback: '' };
let target = '';

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const long = arg.replace(/^--/, '');
  if (VALUE_FLAGS.has(long)) {
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      console.error(`[rollback] FAIL — ${arg} needs a value`);
      process.exit(2);
    }
    values[long === 'expect-index' ? 'expectIndex' : long === 'cf-rollback' ? 'cfRollback' : long] = value;
    i += 1;
    continue;
  }
  if (arg.startsWith('--')) {
    const name = long.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    if (!(name in flags)) {
      console.error(`[rollback] FAIL — unknown flag ${arg}`);
      process.exit(2);
    }
    flags[name] = true;
    continue;
  }
  if (target) {
    console.error(`[rollback] FAIL — more than one version given (${target}, ${arg})`);
    process.exit(2);
  }
  target = arg;
}

const site = resolveSite({ ...process.env, ...(values.site ? { GS1_SITE: values.site } : {}) });
const store = values.store ? resolve(root, values.store) : defaultStore(root);
const dryRun = !flags.apply;
const log = (...parts) => {
  if (!flags.quiet) console.log(...parts);
};
const step = (name) => console.log(`\n[rollback] ▸ ${name}`);

let failed = null;
const fail = (message) => {
  failed = message;
  throw new Error(message);
};

/**
 * Numeric flags, with the trap spelled out: an absent `--attempts` is the empty
 * string, and `Number('')` is 0 — a loop over `attempts` would then run zero
 * times and report "unreachable" instead of trying once.
 */
const numeric = (raw, fallback, { min = 0 } = {}) => {
  if (raw === '' || raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) fail(`expected a number >= ${min}, got "${raw}"`);
  return n;
};

function run(cmd, args, { capture = false, env = {} } = {}) {
  log(`[rollback]   $ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.error) fail(`${cmd} could not run — ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} exited ${result.status}`);
  return capture ? (result.stdout ?? '') : '';
}

/**
 * The one thing a rollback cannot do by itself, said out loud every time.
 *
 * This is not decoration: the update banner is raised by the *service worker*
 * finding a new worker, and the banner's headline is the running build's own
 * `CHANGELOG_HEAD` — so a client on the rolled-back-from build is told
 * "v<its own version> is ready", i.e. it advertises the version we just
 * removed, while the activation actually lands on the rollback target. See
 * `docs/notes/release.md` §回滚与更新横幅.
 */
function pwaNote(entry) {
  log('[rollback] what this does on the client side (PWA / service worker):');
  log(`[rollback]   · new visitors and reloads: served v${entry.version} (shell ${entry.indexHash}) immediately —`);
  log('[rollback]     the worker fetches the shell with cache:no-store, so a reload never reuses the old index.html,');
  log('[rollback]     and the hashed assets it points at are not in the old cache, so they come from the network.');
  log(`[rollback]   · a session whose page is still the newer build and is never reloaded: the rolled-back sw.js`);
  log(`[rollback]     (${entry.swCache}) is a different worker, so the browser installs it as *waiting* and the update`);
  log(`[rollback]     banner appears; tapping 立即更新 activates v${entry.version} and reloads once.`);
  log('[rollback]   · on that banner the version comes from the *running* bundle, so a client on the newer build is');
  log('[rollback]     told "v<newer> · …" — the very version being rolled back — while the action lands on the');
  log(`[rollback]     rollback target v${entry.version}. Do not read the banner label as the version it will install.`);
  log('[rollback]   · offline clients keep their own build until they are online again; nothing server-side reaches them.');
  log(`[rollback]   · there is no push channel here, so "everyone is back on v${entry.version}" is only true of new`);
  log('[rollback]     visitors plus whoever reloads or taps the banner. See docs/notes/release.md.');
}

// -------------------------------------------------------------------- self-test

/** A fake release line for the pure retention checks. */
const mkEntry = (version, minutes) => ({
  version,
  indexHash: `hash${version.replace(/\./g, '')}`,
  swCache: `gs1-cache${version.replace(/\./g, '')}`,
  retainedAt: new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString(),
});

/**
 * Hermetic checks: no network, no production, no store outside `.tmp/`.
 *
 * Covered: the retention window (keep 5, never prune the current version), the
 * `GS1_KEEP_VERSIONS` guard, the real `index.html`/`sw.js` shapes, retention and
 * pruning against a throwaway store, snapshot materialisation and both of its
 * pin checks, and the live-hash gate against a loopback server — green *and*
 * red, so the gate is shown to judge rather than to print.
 */
async function selfTest() {
  const sandbox = resolve(root, '.tmp', 'rollback-selftest');
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });
  const dist = join(sandbox, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const shell = (hash) =>
    `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-${hash}.js"></script></head></html>`;
  const worker = (cache) => `const CACHE = 'gs1-${cache}';\nself.addEventListener('install', () => {});\n`;

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // 1. The window itself, including the current-version protection.
  const seven = ['2.0.1', '2.0.2', '2.0.3', '2.0.4', '2.0.5', '2.0.6', '2.0.7'].map(mkEntry);
  const window = planPrune(seven, 5, { current: { version: '2.0.7' } });
  check(
    'keep=5 prunes exactly the two oldest',
    [...window.pruned.map((e) => e.version)].sort().join() === '2.0.1,2.0.2' && window.kept.length === 5,
    `kept ${window.kept.map((e) => e.version).join()}`,
  );
  const relic = planPrune(seven, 2, { current: { version: '2.0.1' } });
  check(
    'the current version is never pruned, even outside the window',
    relic.kept.some((e) => e.version === '2.0.1') && relic.kept.length === 3 && relic.pruned.length === 4,
    `kept ${relic.kept.map((e) => e.version).join()} / pruned ${relic.pruned.length}`,
  );
  check('fewer versions than the window => prune nothing', planPrune(seven.slice(0, 3), 5, { current: null }).pruned.length === 0);
  check('pickRollbackTarget skips the candidate', pickRollbackTarget(seven, { candidateVersion: '2.0.7' })?.version === '2.0.6');

  check('GS1_KEEP_VERSIONS default is the fixed policy', keepVersionsFromEnv({}) === KEEP_VERSIONS, `N=${KEEP_VERSIONS}`);  check('GS1_KEEP_VERSIONS overrides it', keepVersionsFromEnv({ GS1_KEEP_VERSIONS: '3' }) === 3);
  check(
    'a rollback across a storage-schema bump is flagged',
    schemaRollbackRisk({ version: '2.0.3', storeSchema: 3 }, { version: '2.0.4', storeSchema: 4 }).risky === true,
  );
  check(
    'a rollback inside one schema is not flagged',
    schemaRollbackRisk({ version: '2.0.3', storeSchema: 4 }, { version: '2.0.4', storeSchema: 4 }).risky === false,
  );
  check(
    'an unrecorded schema is "unknown", not a silent pass',
    schemaRollbackRisk({ version: '2.0.3' }, { version: '2.0.4', storeSchema: 4 }).unknown === true,
  );
  check('readStoreSchema reads this checkout', Number.isInteger(readStoreSchema(root)) && readStoreSchema(root) >= 1, `schema ${readStoreSchema(root)}`);
  let rejected = 0;
  for (const bad of ['0', '-1', '5o', '51', '2.5']) {
    try {
      keepVersionsFromEnv({ GS1_KEEP_VERSIONS: bad });
    } catch {
      rejected += 1;
    }
  }
  check('a bad GS1_KEEP_VERSIONS is rejected, not clamped', rejected === 5, `${rejected}/5 rejected`);

  // 2. The parsers, against the exact shapes the build emits.
  check('indexHashOf reads the built shell', indexHashOf(shell('BB9zSzLw')) === 'BB9zSzLw');
  check('swCacheOf reads the generated worker', swCacheOf(worker('22dd6465919d')) === 'gs1-22dd6465919d');
  check('indexHashOf refuses a page that is not this app', indexHashOf('<html>hello</html>') === '');

  // 3. Retain a real snapshot, then record + prune for real in the sandbox store.
  writeFileSync(join(dist, 'index.html'), shell('hash207'));
  writeFileSync(join(dist, 'sw.js'), worker('cache207'));
  writeFileSync(join(dist, 'assets', 'index-hash207.js'), '// 2.0.7\n');
  const tarPath = join(sandbox, 'gs1-synth-2.0.7.tar.gz');
  execFileSync('tar', ['-czf', tarPath, '-C', dist, '.'], { stdio: 'inherit' });

  const storeDir = join(sandbox, 'retained');
  const entry = retainVersion({ store: storeDir, version: '2.0.7', distDir: dist, tarPath });
  check('retain pins the shell and the worker', entry.indexHash === 'hash207' && entry.swCache === 'gs1-cache207');
  check('retain stores a snapshot whose hash is pinned', entry.tarSha256 === sha256File(join(versionDir(storeDir, '2.0.7'), entry.tar)));

  const freshStore = join(sandbox, 'fresh');
  recordVersion({ store: freshStore, entry, action: 'release', keep: 5, dryRun: true, log: () => {} });
  check('a dry run writes no manifest', !existsSync(join(freshStore, 'index.json')));

  // Seed a full store by hand, then let the real prune path delete the two
  // oldest version directories.
  const pruneStore = join(sandbox, 'prunable');
  for (const old of seven.slice(0, 6)) mkdirSync(versionDir(pruneStore, old.version), { recursive: true });
  writeManifest(pruneStore, {
    schema: 1,
    keep: 5,
    current: { version: '2.0.6', indexHash: 'hash206', swCache: 'gs1-cache206', at: '', action: 'release' },
    versions: seven.slice(0, 6),
    events: [],
  });
  const pruned = recordVersion({ store: pruneStore, entry, action: 'release', keep: 5, dryRun: false, log: () => {} });
  check(
    'recording a release prunes to the window',
    pruned.manifest.versions.length === 5 && [...pruned.pruned.map((e) => e.version)].sort().join() === '2.0.1,2.0.2',
    `kept ${pruned.manifest.versions.length}, pruned ${pruned.pruned.map((e) => e.version).join()}`,
  );
  check(
    'pruning really deletes the old directories and keeps the current one',
    !existsSync(versionDir(pruneStore, '2.0.1')) && !existsSync(versionDir(pruneStore, '2.0.2')) && existsSync(versionDir(pruneStore, '2.0.6')),
  );
  check('the recorded current is the release just made', pruned.manifest.current.version === '2.0.7');

  // 4. Materialise the retained snapshot and prove both pin checks.
  const siteDir = join(sandbox, 'site');
  const materialised = materializeSite({ store: storeDir, entry, dest: siteDir, log: (m) => console.log(`  · ${m.replace('[retained] ', '')}`) });
  check('materialise verifies the shell against the pin', materialised.indexHash === entry.indexHash);
  const configPath = join(sandbox, 'wrangler.rollback.toml');
  writeRollbackConfig({ repoRoot: root, version: entry.version, siteDir, outPath: configPath });
  const config = readFileSync(configPath, 'utf8');
  check(
    'the rollback config retargets [assets] and keeps the worker name',
    config.includes(`directory = "${siteDir}"`) && config.includes('name = "shiny-sky-9ea0"'),
  );

  const tarInStore = join(versionDir(storeDir, entry.version), entry.tar);
  const originalTar = readFileSync(tarInStore);
  writeFileSync(tarInStore, Buffer.concat([originalTar, Buffer.from('tampered')]));
  let tarCaught = false;
  try {
    materializeSite({ store: storeDir, entry, dest: join(sandbox, 'site-badtar'), log: () => {} });
  } catch (error) {
    tarCaught = /snapshot hash .* != pinned/.test(error.message);
  }
  writeFileSync(tarInStore, originalTar);
  check('a tampered snapshot is refused before it is extracted', tarCaught);

  writeFileSync(join(versionDir(storeDir, entry.version), 'sha256.txt'), `${'0'.repeat(64)}  index.html\n`);
  let pinCaught = false;
  try {
    materializeSite({ store: storeDir, entry, dest: join(sandbox, 'site-badpin'), log: () => {} });
  } catch (error) {
    pinCaught = /does not match its pin/.test(error.message);
  }
  // (The corrupted pin is left behind on purpose — the sandbox is deleted below.)
  check('a store whose per-file pin does not match is refused', pinCaught);

  // 5. The live-hash gate, against a loopback server: green and red.
  let served = shell('LIVEHASH1');
  const server = createServer((req, res) => {
    if (req.url.startsWith('/sw.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end(worker('livecache'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(served);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const liveSite = `http://127.0.0.1:${server.address().port}`;
  try {
    check('fetchLiveIndexHash reads the loopback shell', (await fetchLiveIndexHash(liveSite)) === 'LIVEHASH1');
    check('fetchLiveSwCache reads the loopback worker', (await fetchLiveSwCache(liveSite)) === 'gs1-livecache');
    const green = await verifyLive({ site: liveSite, expectedHash: 'LIVEHASH1', attempts: 2, delayMs: 0, log: () => {} });
    check('the gate passes on the expected hash', green.ok);
    check('the gate reports every attempt', green.attempts === 1, `attempts ${green.attempts}`);
    const red = await verifyLive({ site: liveSite, expectedHash: 'deadbeef', attempts: 2, delayMs: 0, log: () => {} });
    check('the gate fails on a wrong hash', !red.ok && red.live === 'LIVEHASH1');

    // The same gate through the real CLI. This is the check that catches flag
    // plumbing bugs (an absent `--attempts` used to become 0 attempts, i.e. a
    // green check that never asked the site anything).
    //
    // Spawned asynchronously on purpose: this process is also the loopback
    // server, and `spawnSync` would block the event loop that has to answer the
    // child's request — a deadlock, discovered the first time this ran.
    writeManifest(storeDir, {
      schema: 1,
      keep: 5,
      current: { version: entry.version, indexHash: entry.indexHash, swCache: entry.swCache, at: '', action: 'release' },
      versions: [entry],
      events: [],
    });
    served = shell(entry.indexHash);
    const cli = (extra) =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(import.meta.url), entry.version, '--check-only', '--store', storeDir, '--site', liveSite, ...extra],
          { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('close', (status) => resolve({ status, stderr }));
      });
    const cliGreen = await cli([]);
    check('the CLI check-only exits 0 when the live shell matches', cliGreen.status === 0, `status ${cliGreen.status} ${cliGreen.stderr.trim()}`);
    const cliRed = await cli(['--expect-index', 'deadbeef']);
    check('the CLI check-only exits non-zero on a wrong hash', cliRed.status === 1, `status ${cliRed.status}`);

    served = '<html>Cloudflare request metadata</html>';
    let notApp = false;
    try {
      await fetchLiveIndexHash(liveSite);
    } catch (error) {
      notApp = /carried no assets/.test(error.message);
    }
    check('a page that is not this app is refused, not read as "ok"', notApp);
  } finally {
    server.close();
  }

  const bad = results.filter((r) => !r.ok);
  rmSync(sandbox, { recursive: true, force: true });
  console.log(`\n[rollback] self-test: ${results.length - bad.length}/${results.length} checks passed`);
  if (bad.length) {
    console.error(`[rollback] FAIL — self-test: ${bad.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  console.log('[rollback] PASS (self-test, hermetic: no network, no store outside .tmp/)');
}

// ----------------------------------------------------------------------- main

async function confirm(target) {
  if (flags.yes) return;
  if (!process.stdin.isTTY) fail('--apply without --yes, and stdin is not a TTY — refusing to guess');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`[rollback] really deploy v${target.version} to ${site}? type the version to confirm: `);
  rl.close();
  if (stripV(answer.trim()) !== stripV(target.version)) fail('confirmation did not match the version');
}

async function main() {
  if (flags.selfTest) {
    if (flags.apply) fail('--self-test does not deploy anything; drop --apply');
    return selfTest();
  }
  if (flags.apply && flags.dryRun) fail('--apply and --dry-run contradict each other');
  if (flags.apply && flags.checkOnly) fail('--apply and --check-only contradict each other');
  if (flags.expectIndex && flags.apply) {
    fail('--expect-index is a failure-injection knob: it would deploy and then fail by construction');
  }

  const keep = values.keep ? Number(values.keep) : keepVersionsFromEnv();
  if (!Number.isInteger(keep) || keep < 1 || keep > 50) fail(`--keep must be an integer in 1…50, got ${values.keep}`);
  const manifest = readManifest(store, { keep });

  if (!target && !flags.checkOnly) {
    // Listing is a real answer, not an error: it is the first thing a human runs.
    log(formatStore(manifest));
    console.log('\n[rollback] pass a version to plan a rollback, e.g. `npm run rollback -- <version>`');
    console.log('[rollback] PASS (list only)');
    return;
  }
  if (!target) fail('--check-only needs a version');

  step(`rollback to v${stripV(target)}${dryRun ? ' (dry run)' : ''}`);
  log(formatStore(manifest));
  log(`[rollback] store ${store}`);

  const entry = findVersion(manifest, target);
  if (!entry) {
    const available = sortVersions(manifest.versions).map((e) => `v${e.version}`).join(', ') || '(none)';
    fail(
      `v${stripV(target)} is not in the retained store — rollback-able: ${available}. Pruned versions are gone; re-release that version instead.`,
    );
  }
  if (values.cfRollback && dryRun) log('[rollback] --cf-rollback was given; a dry run only plans, so it is not used here');

  // The expected shell hash: the pin from the store, or an explicit override
  // (how the drill rehearses the *red* path without touching production).
  const expectedHash = values.expectIndex || entry.indexHash;

  step('read the live site (read-only)');
  let liveHash = '';
  try {
    liveHash = await fetchLiveIndexHash(site);
    const liveSw = await fetchLiveSwCache(site).catch(() => '');
    log(`[rollback]   ${site} is serving shell ${liveHash}${liveSw ? ` (sw ${liveSw})` : ''}`);
  } catch (error) {
    log(`[rollback]   could not read ${site} — ${error.message}`);
  }

  if (flags.checkOnly) {
    const verdict = await verifyLive({
      site,
      expectedHash,
      attempts: numeric(values.attempts, 1, { min: 1 }),
      delayMs: numeric(values.delay, 0),
      log: (m) => log(m.replace('[retained]', '[rollback]')),
    });
    if (!verdict.ok) {
      fail(`live shell ${verdict.live || verdict.error || '(unreachable)'} != expected ${expectedHash}`);
    }
    console.log(`\n[rollback] PASS — ${site} serves the v${entry.version} build (${expectedHash})`);
    return;
  }

  if (liveHash && liveHash === entry.indexHash && !flags.force) {
    fail(`v${entry.version} is already live (${liveHash}); there is nothing to roll back to. Re-run with --force to re-deploy it anyway.`);
  }
  // The store's own idea of "current" is only a note: the live read above is the
  // authority, and this record is stale by construction in exactly the case a
  // rollback matters most — something else was deployed (a candidate, a failed
  // release) without being recorded. Making it fatal blocked the drill, which
  // rolls back to a version the store legitimately still calls current.
  if (manifest.current && stripV(manifest.current.version) === entry.version && manifest.current.indexHash === entry.indexHash) {
    log(`[rollback] note: the store records v${entry.version} as current — live is ${liveHash || '(unreadable)'}, so that record is stale`);
  }
  if (manifest.current && compareVersions(entry.version, manifest.current.version) > 0) {
    log(`[rollback] note: v${entry.version} is *newer* than the recorded current v${manifest.current.version} — this is a roll-forward, not a rollback`);
  }

  // The one rollback that can destroy user work. `src/state/persist.ts` reads a
  // document whose `schema` is newer than the build's own `SCHEMA_VERSION` as
  // null, so a client that already ran the newer build comes up on *defaults*
  // after this rollback — not on a slightly older view of its project.
  const liveEntry = manifest.current ? findVersion(manifest, manifest.current.version) : null;
  const risk = schemaRollbackRisk(entry, liveEntry);
  if (risk.unknown) log(`[rollback] note: ${risk.detail} — the storage-schema check cannot be made`);
  if (risk.risky) {
    if (!flags.force) {
      fail(
        `${risk.detail}. If you are sure nobody has used v${liveEntry.version} — or that the bump was purely additive — re-run with --force.`,
      );
    }
    log(`[rollback] WARNING (forced): ${risk.detail}`);
  }

  const siteDir = join(root, '.tmp', 'retained-site', entry.version);
  const configPath = join(root, '.tmp', 'retained-site', `${entry.version}.wrangler.toml`);

  if (values.cfRollback) {
    step(`rollback via Cloudflare version ${values.cfRollback}`);
    log('[rollback]   (no re-upload: Cloudflare activates that worker version, assets included)');
    if (dryRun) {
      log(`[rollback]   $ npx wrangler rollback ${values.cfRollback} -y`);
    } else {
      await confirm(entry);
      const token = cloudflareToken();
      if (!token) fail('deploy: CLOUDFLARE_API_TOKEN is neither exported nor in a shell profile');
      run('npx', ['wrangler', 'rollback', values.cfRollback, '-y'], { env: { CLOUDFLARE_API_TOKEN: token } });
    }
  } else {
    step('verify the retained snapshot and build its deploy config');
    const materialised = materializeSite({ store, entry, dest: siteDir, log: (m) => log(m.replace('[retained]', '[rollback] ')) });
    writeRollbackConfig({ repoRoot: root, version: entry.version, siteDir: materialised.dir, outPath: configPath });
    log(`[rollback]   config ${configPath} → assets ${materialised.dir}`);
    // `wrangler deploy --dry-run` compiles and *reads the assets directory*
    // without uploading and without a token, so the snapshot's deployability is
    // checked even in a dry run.
    run('npx', ['wrangler', 'deploy', '-c', configPath, '--dry-run']);

    step(`deploy v${entry.version} to Cloudflare`);
    if (dryRun) {
      log(`[rollback]   $ npx wrangler deploy -c ${configPath}   (dry run: not deployed)`);
    } else {
      await confirm(entry);
      const token = cloudflareToken();
      if (!token) fail('deploy: CLOUDFLARE_API_TOKEN is neither exported nor in a shell profile');
      run('npx', ['wrangler', 'deploy', '-c', configPath], { env: { CLOUDFLARE_API_TOKEN: token } });
    }
  }

  if (dryRun) {
    step('live check (skipped: dry run)');
    log(`[rollback]   would poll ${site}/?cb=… for assets/index-${expectedHash}.js (6 attempts, 5 s apart)`);
    log(`[rollback]   would then require ${site}/sw.js to carry sw ${entry.swCache}`);
    pwaNote(entry);
    log(`[rollback] to actually do it: npm run rollback -- ${entry.version} --apply`);
    console.log(`\n[rollback] PASS — dry run for v${entry.version} (nothing was deployed)`);
    return;
  }

  step(`check the live shell (expect ${expectedHash})`);
  const verdict = await verifyLive({
    site,
    expectedHash,
    attempts: numeric(values.attempts, 6, { min: 1 }),
    delayMs: numeric(values.delay, 5000),
    log: (m) => log(m.replace('[retained]', '[rollback]')),
  });
  if (!verdict.ok) {
    fail(`live check: ${site} never served assets/index-${expectedHash}.js (last: ${verdict.live || verdict.error || 'none'})`);
  }

  step('check the live service worker (banner linkage)');
  let liveSw = '';
  try {
    liveSw = await fetchLiveSwCache(site);
  } catch (error) {
    fail(`sw check: could not read ${site}/sw.js — ${error.message}`);
  }
  if (liveSw !== entry.swCache) {
    // Without this, a rollback can be live for new visitors while every
    // installed client keeps the old worker *and never raises the banner* —
    // i.e. it silently fails for exactly the people it is for.
    fail(`sw check: live sw.js carries ${liveSw || '(none)'}, expected ${entry.swCache} — installed clients would not see an update`);
  }
  log(`[rollback]   ✓ live sw.js carries ${liveSw}`);

  step('record the rollback');
  const recorded = recordVersion({ store, entry, action: 'rollback', from: manifest.current?.version ?? null, keep, log: (m) => log(m) });
  log(`[rollback]   ${formatStore(recorded.manifest).split('\n')[0]}`);

  pwaNote(entry);
  console.log(`\n[rollback] PASS — v${entry.version} is live (${expectedHash})`);
}

try {
  await main();
} catch (error) {
  if (!failed) failed = error.message;
  console.error(`\n[rollback] FAIL — ${failed}`);
  process.exit(1);
}
