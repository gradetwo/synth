#!/usr/bin/env node
/**
 * The rollback drill: deploy a candidate → check the live hash → roll back →
 * check again → report.
 *
 *   npm run rollback:drill                      # dry run (the default)
 *   npm run rollback:drill -- --apply --yes     # the real thing (needs a token)
 *   npm run rollback:drill -- --expect-index deadbeef   # rehearse the *red* path
 *
 * What a dry run actually does — it is not just a print:
 *
 *   · packages/uses the current `dist/` as the candidate (real bytes),
 *   · retains it into a **throwaway** store under `.tmp/rollback-drill/`, so the
 *     retention record + prune path runs for real without touching
 *     `release/retained/`,
 *   · materialises the rollback target from its snapshot and verifies every
 *     file against the pin,
 *   · generates the rollback `wrangler.toml` and runs
 *     `wrangler deploy --dry-run` on it (compile + read the assets dir, no
 *     upload, no token),
 *   · and *prints* the two production commands it would run.
 *
 * Everything that would touch production is printed, never executed, unless
 * `--apply` is given. `--expect-index <hash>` turns the otherwise-printed live
 * verification into a real read-only check, which is how the failure path is
 * demonstrated locally: give it a hash that is not live and the drill exits 1.
 *
 * The store, the policy and the PWA consequences: `docs/notes/release.md`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultStore,
  fetchLiveIndexHash,
  formatStore,
  indexHashOf,
  keepVersionsFromEnv,
  pickRollbackTarget,
  readManifest,
  readStoreSchema,
  recordVersion,
  retainVersion,
  sortVersions,
  stripV,
  verifyLive,
} from './lib/retained.mjs';
import { resolveSite } from './lib/release-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VALUE_FLAGS = new Set(['site', 'store', 'to', 'expect-index', 'candidate-version']);
const argv = process.argv.slice(2);
const flags = { apply: false, yes: false, skipPackage: false, quiet: false };
const values = { site: '', store: '', to: '', expectIndex: '', candidateVersion: '' };
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const long = arg.replace(/^--/, '');
  if (VALUE_FLAGS.has(long)) {
    values[long === 'expect-index' ? 'expectIndex' : long === 'candidate-version' ? 'candidateVersion' : long] = argv[i + 1];
    i += 1;
    continue;
  }
  if (arg.startsWith('--')) {
    const name = long.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    if (!(name in flags)) {
      console.error(`[drill] FAIL — unknown flag ${arg}`);
      process.exit(2);
    }
    flags[name] = true;
    continue;
  }
  console.error(`[drill] FAIL — unexpected argument ${arg}`);
  process.exit(2);
}

const site = resolveSite({ ...process.env, ...(values.site ? { GS1_SITE: values.site } : {}) });
const store = values.store ? resolve(root, values.store) : defaultStore(root);
const sandboxStore = resolve(root, '.tmp', 'rollback-drill', 'retained');
const dryRun = !flags.apply;
const log = (...parts) => {
  if (!flags.quiet) console.log(...parts);
};
const step = (name) => console.log(`\n[drill] ▸ ${name}`);

let failed = null;
const fail = (message) => {
  failed = message;
  throw new Error(message);
};

function run(cmd, args, { env = {} } = {}) {
  log(`[drill]   $ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.error) fail(`${cmd} could not run — ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} exited ${result.status}`);
}

/** A step that changes production: printed in a dry run, run with `--apply`. */
function mutating(what, cmd, args) {
  if (dryRun) {
    log(`[drill]   MUTATING (dry run: not executed) $ ${cmd} ${args.join(' ')}`);
    return;
  }
  log(`[drill]   ${what}`);
  run(cmd, args);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const candidateVersion = stripV(values.candidateVersion || pkg.version);
const distIndex = resolve(root, 'dist', 'index.html');
const candidateTar = resolve(root, 'release', `gs1-synth-${candidateVersion}.tar.gz`);

async function main() {
  step(`drill${dryRun ? ' (dry run — the default)' : ' --apply: THIS TOUCHES PRODUCTION'}`);
  log(`[drill]   candidate: v${candidateVersion} from dist/`);
  log(`[drill]   site: ${site}`);
  log(`[drill]   real store (read): ${store}`);
  log(`[drill]   rehearsal store (this run): ${sandboxStore}`);

  if (!existsSync(distIndex)) fail('no dist/index.html — run `npm run build` first');
  const candidateHash = indexHashOf(readFileSync(distIndex, 'utf8'));
  if (!candidateHash) fail('dist/index.html has no assets/index-*.js');
  log(`[drill]   candidate shell: ${candidateHash}`);

  // ---------------------------------------------------------------- 1. package

  step('1/7 package the candidate');
  const distMtime = statSync(distIndex).mtimeMs;
  const upToDate = existsSync(candidateTar) && statSync(candidateTar).mtimeMs >= distMtime;
  if (flags.skipPackage) {
    log('[drill]   (--skip-package: reusing the artifact already in release/)');
  } else if (dryRun && upToDate) {
    log(`[drill]   (dry run: release/gs1-synth-${candidateVersion}.tar.gz is newer than dist/ — skipping the rebuild)`);
  } else {
    run('npm', ['run', 'package']);
  }
  if (!existsSync(candidateTar)) fail(`expected ${candidateTar} — run \`npm run package\``);

  // ------------------------------------------- 2. retention, in a throwaway store

  step('2/7 rehearse retention (throwaway store)');
  rmSync(sandboxStore, { recursive: true, force: true });
  const entry = retainVersion({
    store: sandboxStore,
    version: candidateVersion,
    distDir: resolve(root, 'dist'),
    tarPath: candidateTar,
    storeSchema: readStoreSchema(root),
  });
  const recorded = recordVersion({ store: sandboxStore, entry, action: 'release', keep: keepVersionsFromEnv(), log: (m) => log(`[drill]   ${m}`) });
  log(formatStore(recorded.manifest).split('\n').map((l) => `[drill] ${l.replace('[retained]', '')}`).join('\n'));

  // ------------------------------------------------------------ 3. pick the target

  step('3/7 pick the rollback target');
  const realManifest = readManifest(store, { keep: keepVersionsFromEnv() });
  let target = values.to ? stripV(values.to) : '';
  let targetStore = store;
  let selfRollback = false;
  if (target) {
    log(`[drill]   --to v${target} (from ${store})`);
  } else {
    const candidate = pickRollbackTarget(realManifest.versions, { candidateVersion, candidateHash });
    if (candidate) {
      target = candidate.version;
      log(`[drill]   newest retained version that is not the candidate: v${target} (${candidate.indexHash})`);
    } else {
      target = candidateVersion;
      targetStore = sandboxStore;
      log('[drill]   the real store has no other version yet — rehearsing a self-rollback of the candidate');
      log('[drill]   against the throwaway store (after the first real release this picks the previous version)');
      log('[drill]   (a self-rollback is a no-op by definition, so the rehearsal passes --force)');
      selfRollback = true;
    }
  }
  const rollbackArgs = [
    resolve(root, 'scripts', 'rollback.mjs'),
    target,
    '--store',
    targetStore,
    '--site',
    site,
    ...(selfRollback ? ['--force'] : []),
    ...(flags.yes ? ['--yes'] : []),
  ];
  // The injected expectation belongs to the *verification* step, not to the
  // rollback plan: `rollback.mjs --apply` refuses --expect-index outright, and
  // feeding it to the dry run would only misprint which hash it expects.
  const checkArgs = [
    resolve(root, 'scripts', 'rollback.mjs'),
    target,
    '--check-only',
    '--store',
    targetStore,
    '--site',
    site,
    ...(values.expectIndex ? ['--expect-index', values.expectIndex] : []),
  ];

  // ------------------------------------------------- 4. deploy the candidate

  step('4/7 deploy the candidate (mutating)');
  mutating(`deploying v${candidateVersion}`, 'npx', ['wrangler', 'deploy']);

  // ------------------------------------------------- 5. check the candidate

  step('5/7 check the live shell is the candidate');
  if (dryRun) {
    log(`[drill]   READ-ONLY CHECK (not run in a dry run: the candidate was not deployed) — ${site}/?cb=… must name assets/index-${candidateHash}.js`);
  } else {
    // Checked here rather than through `rollback.mjs --check-only`, which needs
    // a *store entry*: the candidate is the build in flight, and the store does
    // not have it until the release records it.
    const verdict = await verifyLive({
      site,
      expectedHash: candidateHash,
      attempts: 6,
      delayMs: 5000,
      log: (m) => log(`[drill] ${m.replace('[retained]', '')}`),
    });
    if (!verdict.ok) fail(`the candidate never went live: last ${verdict.live || verdict.error || 'none'}`);
  }

  // ------------------------------------------------------- 6. roll back

  step(`6/7 roll back to v${target} (mutating)`);
  if (dryRun) {
    // The rollback script's own dry run is non-mutating, and it does the real
    // work: verify the snapshot against the pin, generate the config and run
    // `wrangler deploy --dry-run` on it.
    run('node', rollbackArgs);
  } else {
    if (!flags.yes) log('[drill]   (rollback.mjs will ask for confirmation unless --yes is passed)');
    run('node', [...rollbackArgs, '--apply']);
  }

  // ----------------------------------------------------------- 7. verify again

  step('7/7 check the live shell is the rollback target (read-only)');
  if (dryRun && !values.expectIndex) {
    log(`[drill]   READ-ONLY CHECK (run after a real drill): node scripts/rollback.mjs ${target} --check-only --store ${targetStore} --site ${site}`);
  } else {
    // With --expect-index this is a real check, so a wrong hash reds the drill.
    run('node', checkArgs);
  }

  // ------------------------------------------------------------------ report

  step('report');
  let liveHash = '';
  try {
    liveHash = await fetchLiveIndexHash(site);
    log(`[drill]   live now: ${liveHash}`);
  } catch (error) {
    log(`[drill]   live now: unreachable — ${error.message}`);
  }
  log(`[drill]   candidate v${candidateVersion} shell ${candidateHash}`);
  log(`[drill]   target    v${target} (store ${targetStore})`);
  log(`[drill]   retained (real store): ${sortVersions(realManifest.versions).map((e) => `v${e.version}`).join(', ') || '(empty)'}`);
  log('[drill]   what only a real run can prove: the upload reaches the edge, and the service worker');
  log('[drill]   clients are then offered is the rolled-back one (the banner linkage rollback.mjs checks).');
  if (dryRun) {
    log('[drill]   to do it for real: npm run rollback:drill -- --apply --yes   (needs CLOUDFLARE_API_TOKEN)');
  }
  console.log(`\n[drill] PASS — ${dryRun ? 'dry run: nothing was deployed' : 'drill complete'}`);
}

try {
  await main();
} catch (error) {
  if (!failed) failed = error.message;
  console.error(`\n[drill] FAIL — ${failed}`);
  process.exit(1);
}
