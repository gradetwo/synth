/**
 * The session's engine state.
 *
 * P13.3 adds the first tools that **change** the instrument: `patch.set`,
 * `patch.random`, `preset.apply`, `sample.import`, `wavetable.import`. A tool
 * call needs somewhere for that change to live, and `docs/LLM-INTERFACE.md` §4.2
 * treats these as operations on "the synth", not one-shot arguments. So the
 * server's context carries one mutable record:
 *
 *   * `patch`     — the current patch payload (params/params2/routes/routing
 *                   plus the canonical share code), written by `patch.set`,
 *                   `patch.random` and `preset.apply`, read by `patch.get`,
 *                   `render`, `analyze` and `gate` when they are given no
 *                   explicit `patch`/`presetId`;
 *   * `sample`    — the imported sampler source, written by `sample.import`;
 *   * `wavetable` — the imported single cycle, written by `wavetable.import`.
 *
 * **Why an import is replayed rather than simply left in the core.** Every
 * `gs1.render`/`gs1.gate` starts from `initCore()`, a brand-new wasm instance
 * with a new engine — that is what makes the same call byte-identical twice
 * (§5). A fresh instance has no imported sample, so `installInstrument()`
 * replays the session's sample and cycle into it before the first block, which
 * is exactly what the browser's `installUserSample()`/`installUserWavetable()`
 * do after a reload. The state therefore lives in the session, and the core is
 * always a pure function of it.
 *
 * **A fresh session per pass.** `resetSession()` clears the record and swaps in
 * a new wasm instance, so the golden session's second pass starts from the same
 * engine the first one did rather than from whatever the first pass left in the
 * arena. Without it, `sample.import` would report a different `poolBytes` on the
 * second pass (the pool is reused, so the delta is zero) and the two passes
 * could not be compared byte-for-byte.
 */
import { initCore, importSample, importWavetableCycle } from '../../scripts/lib/render-core.mjs';
import { ERRORS, fail } from './errors.mjs';

/** An empty session: the default patch, no imported instrument, nothing to undo. */
export function createSession() {
  return { patch: null, sample: null, wavetable: null, history: [] };
}

/**
 * How many patches a session can step back through.
 *
 * The stack holds the *replaced* patch, `null` included — "there was no session
 * patch" is a state worth returning to. 32 is well past what a single agent turn
 * needs and still a fixed, tiny bound.
 */
export const UNDO_LIMIT = 32;

/**
 * Record the patch a mutating call is about to replace.
 *
 * The app has its own undo/redo stack, but nothing in the tool surface exposed
 * one: `patch.set` overwrote the session and an agent that got a morph wrong had
 * no way back. This is that way back, and it is deliberately a snapshot of what
 * `patch.set`/`patch.random`/`preset.apply`/`patch.morph` replaced, not a diff —
 * a diff would have to be replayed to be trusted.
 */
export function pushUndo(session, previous) {
  const history = (session.history ??= []);
  history.push(previous ?? null);
  if (history.length > UNDO_LIMIT) history.shift();
  return history.length;
}

/** The patch to restore, or `undefined` when there is nothing left to undo. */
export function popUndo(session) {
  const history = session.history ?? [];
  return history.pop();
}

/** Clear the state and give the process a brand-new wasm engine. */
export function resetSession(ctx) {
  ctx.session = createSession();
  initCore();
  return ctx.session;
}

/**
 * Replay the session's imported instrument into the live core.
 *
 * Called by every entry point that builds a fresh engine (`renderChannels`,
 * `settledFloor`) right after `initCore()`. A refusal here cannot be the
 * caller's fault — the import already passed the same check — so it is reported
 * as an internal `E_IMPORT` rather than silently dropped.
 */
export function installInstrument(session) {
  const installed = [];
  if (session?.wavetable) {
    const code = importWavetableCycle(session.wavetable.cycle);
    if (code !== 0) {
      throw fail(ERRORS.IMPORT, `the session's wavetable was refused on replay (code ${code})`, {
        note: codeName(code),
        importCode: code,
        source: 'session',
      });
    }
    installed.push('wavetable');
  }
  if (session?.sample) {
    const code = importSample(session.sample.samples, session.sample.sampleRate);
    if (code !== 0) {
      throw fail(ERRORS.IMPORT, `the session's sample was refused on replay (code ${code})`, {
        note: codeName(code),
        importCode: code,
        source: 'session',
      });
    }
    installed.push('sample');
  }
  return installed;
}

/**
 * The P9.8 import verdicts, in one place. `gs_sample_import` and
 * `gs_wavetable_import` share the first four; only the sampler can answer 4
 * (`SampleError::NoRoom`), because only its mipmap asks the arena for a block
 * big enough to fail.
 */
export const IMPORT_CODES = { 0: 'ok', 1: 'short', 2: 'silent', 3: 'notFinite', 4: 'noRoom' };

/** The name of a numeric import code; an unknown code stays a number. */
export function codeName(code) {
  return IMPORT_CODES[code] ?? `code${code}`;
}
