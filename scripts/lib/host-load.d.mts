/**
 * Types for `host-load.mjs`, the shared timing criteria (P14.2).
 *
 * `tsconfig.app.json` compiles `src/` with `allowJs` off, and
 * `src/fuzz.test.ts` imports the same module the two scripts use — that import
 * is the point of the batch, so it gets a declaration instead of a copy. The
 * shipped code is the `.mjs` next to this file; this only describes it.
 */

/** The probe's reading on this machine when idle, in µs. */
export declare const PROBE_REFERENCE_US: number;
/** How many times the idle reference means "the process is being starved". */
export declare const PROBE_LOADED_FACTOR: number;

/** `/proc/loadavg`'s 1-minute value against the core count. */
export declare function hostLoad(): { load: number; cpus: number; busy: boolean };

/** A DSP-independent probe of how much CPU this process is actually getting, in µs. */
export declare function cpuProbe(): number;

/**
 * Whether a wall-clock reading from this run can be judged.
 *
 * `reason` is null when trusted, otherwise a one-line explanation to print next
 * to the reading it invalidates. Honours `GS1_TIMING_HOST=busy|idle` (the load
 * signal) and `GS1_TIMING_PROBE_US=<n>` (the starvation signal) for self-proof
 * only; unset means real measurement.
 */
export declare function timingTrust(): {
  trusted: boolean;
  reason: string | null;
  load: number;
  cpus: number;
  probeUs: number;
};
