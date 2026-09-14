/**
 * One set of timing criteria, shared by every gate that reads a wall clock.
 *
 * Three gates in this repo assert on wall-clock time: `scripts/bench.mjs`
 * (sustained load), `scripts/verify-audio.mjs` (the worst-case block) and
 * `src/fuzz.test.ts` (the parser budget). Until P14.2 only the first had a load
 * probe, and the other two failed on a busy host in a way that looked exactly
 * like a DSP regression — the third full sweep spent hours on "232 % of the
 * quantum" and "6001 ms of 4000" readings that were the host, not the engine.
 * A gate that answers "whose fault is this" differently in each file is worse
 * than one gate, so the two functions below live here now and all three import
 * them. `bench.mjs`'s thresholds and output did not move: this is a move, not a
 * rewrite (see the note at the bottom of the file for the self-proof).
 *
 * Two independent signals, because a busy host can slip past either one: the
 * load average, and how starved this process's own CPU is (the probe). What is
 * **not** a signal: how long the workload itself takes — that is the thing
 * under test, and using it as its own excuse is how a gate turns itself off
 * when the engine gets heavier (P9.1b's post-mortem is in `cpuProbe` below).
 *
 * Layer: Node only, no browser, no wasm.
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';

/**
 * How busy the host is, relative to its cores.
 *
 * The numbers here are wall-clock times of a real-time workload, so they are
 * only meaningful on a machine that is not oversubscribed. Run on a loaded
 * host — another container, a build, a thermal throttle — and every block
 * "misses the deadline" while the DSP has not changed at all, which is exactly
 * what a gate must not report as a regression. When that is the case the timing
 * checks are reported as inconclusive, and the correctness ones still run.
 */
export function hostLoad() {
  try {
    const [one, , ] = readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    const cpus = os.cpus().length || 1;
    // Half the cores, not three quarters. The line is where wall-clock numbers
    // stop being decidable, and it was measured: the same 16-voice scene reads
    // p50 1169 µs (44 %) at load ~2 on this 8-core box and 1621 µs (61 %) at
    // load 5.8 — a 38 % swing from the host alone, which is the size of the
    // regression this gate exists to catch. At 72 % occupancy the number simply
    // is not about the DSP, so the timing checks say so instead of guessing.
    return { load: Number(one), cpus, busy: Number(one) > cpus * 0.5 };
  } catch {
    return { load: 0, cpus: 1, busy: false };
  }
}

/**
 * A DSP-independent probe of how much CPU this process is actually getting.
 *
 * P9.1b replaced the old `mean > 450 µs` heuristic with this, because that
 * number was calibrated when the whole engine measured ~250 µs on an idle host:
 * once the band-limited oscillators pushed the same scene to ~1400 µs, the gate
 * read the engine's own legitimate cost as "host is oversubscribed" and
 * silently downgraded every timing assertion to `skipped` (caught by the parent
 * in `.tmp/p91b-bench-long2.log`: `PASS (correctness only)` at loadavg 2.7/8).
 * A gate that stops gating when the workload gets heavier is worse than no gate.
 *
 * The probe is a fixed loop with no wasm and no allocation, so its wall time
 * tracks the scheduler and the clock, not the DSP. `PROBE_REFERENCE_US` is what
 * it measures on this machine when idle; several times that means the process is
 * being starved (or throttled) and wall-clock DSP timings cannot be trusted. The
 * engine's own cost never enters this decision.
 */
export const PROBE_REFERENCE_US = 1600;
export const PROBE_LOADED_FACTOR = 4;
export function cpuProbe() {
  const runs = [];
  for (let r = 0; r < 7; r++) {
    const t0 = process.hrtime.bigint();
    let x = 1.0;
    for (let i = 0; i < 300_000; i++) x = x * 1.0000001 + 0.0000001;
    if (!Number.isFinite(x)) throw new Error('probe went non-finite');
    runs.push(Number(process.hrtime.bigint() - t0) / 1000);
  }
  // The minimum, not the mean: this probe answers "how fast *can* this process
  // run", and a scheduler slice landing mid-loop only ever makes a run slower.
  runs.sort((a, b) => a - b);
  return runs[0];
}

/**
 * Whether a wall-clock reading from this run can be judged at all.
 *
 * Returns `{ trusted, reason, load, cpus, probeUs }`: `reason` is null when
 * trusted, and otherwise a one-line explanation meant to be printed next to the
 * reading it invalidates. Both `hostLoad()` and `cpuProbe()` above are called
 * here — a gate that only samples the load average misses a process that is
 * being starved on an otherwise quiet box, and vice versa.
 *
 * The same two `GS1_TIMING_*` overrides as the repo's `GS1_BOOT_BUDGET_MS`:
 * an escape hatch for **self-proof and rehearsal only**, never a way to make a
 * real reading pass. `GS1_TIMING_HOST=busy|idle` forces the verdict in either
 * direction (`idle` also overrides the probe, which is how the "the gate still
 * fires" proof runs on a loaded dev box); `GS1_TIMING_PROBE_US=<n>` substitutes
 * a probe reading, which is how "the process is starved" is rehearsed without
 * starving it. Unset — which is every real run — both signals are measured.
 */
export function timingTrust() {
  const host = hostLoad();
  const forced = process.env.GS1_TIMING_HOST;
  const forcedProbe = process.env.GS1_TIMING_PROBE_US;
  const probeUs = forcedProbe ? Number(forcedProbe) : cpuProbe();
  const loadLine = `load ${host.load.toFixed(1)} on ${host.cpus} cpus`;
  const probeLine = `cpu probe ${probeUs.toFixed(0)} µs vs ${PROBE_REFERENCE_US} µs idle`;
  let reason = null;
  if (forced === 'busy') reason = `forced busy by GS1_TIMING_HOST (${loadLine}, ${probeLine})`;
  else if (forced === 'idle') reason = null;
  else if (host.busy) reason = `host is busy: ${loadLine} is over 0.5 × ${host.cpus} cpus`;
  else if (probeUs > PROBE_REFERENCE_US * PROBE_LOADED_FACTOR) {
    reason = `process is starved: ${probeLine} is over ${PROBE_LOADED_FACTOR} × the idle reference`;
  }
  return { trusted: reason === null, reason, load: host.load, cpus: host.cpus, probeUs };
}
