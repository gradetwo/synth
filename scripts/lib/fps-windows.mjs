#!/usr/bin/env node
/**
 * The frame-rate line `e2e/performance.spec.ts` prints, and its readers:
 * `scripts/release.mjs` (which echoes it into the release log) and the unit test
 * next to this file.
 *
 * Shape — keep it stable, because `release.mjs` fails a release whose
 * performance run does not print it in this shape:
 *
 *   [fps] <load> best <b> worst <w> of [w1, w2, …] fps
 *
 * Why the *worst* window is in the line (§一.20⑥): the assertion stays
 * best-of-five, and that is deliberate — host load can only make a single 800 ms
 * window slower, never faster, so the best window is the closest thing to the
 * app's own cost (the same rule `scripts/bench.mjs` uses for its machine probe,
 * and the reason the floor is read from the best window at all). But
 * best-of-five on its own hid the dispersion: a real run read
 * `graph-edit best 60.0 of [21.3, 32.5, 42.5, 33.8, 60.0]` and passed with its
 * worst window 1.3 fps above the 20 fps floor. So the worst window is now
 * printed and read out loud, and it is **not** asserted: "worst ≥ floor" would
 * turn any busy host red, which is exactly the false red the best-of rule
 * exists to avoid (see `docs/notes/performance.md`).
 *
 * `[fps]` is reserved for this one shape. `readFpsLines` counts every `[fps]`
 * occurrence and requires each to parse, so a log line that starts with `[fps]`
 * but is not this shape is a *failure*, not a silent omission — that is what
 * stops the spec's printer and this reader from drifting apart.
 */

/** Matches one `[fps]` line. `g` because one performance run prints three. */
export const FPS_LINE = /\[fps\] ([\w-]+) best ([\d.]+) worst ([\d.]+) of \[([^\]]*)\] fps/g;

/**
 * The floor the spec asserts against. Kept here (and imported by the release
 * log's floor report) so the number has one home; the spec's own assertion and
 * this constant are the same 20, and this file does not change it — a threshold
 * change is a separate, declared batch.
 */
export const FPS_FLOOR = 20;

/**
 * Read the `[fps]` lines out of captured output.
 *
 * Returns `{ entries, printed, malformed }`. `printed` counts every line that
 * carries the `[fps]` marker; `malformed` is how many of those did not match the
 * shape above. Both a zero `printed` and a non-zero `malformed` are failures in
 * `release.mjs`: the first means the gate did not run, the second means the
 * reader is no longer reading what the spec prints.
 */
export function readFpsLines(output) {
  const text = String(output);
  const entries = [];
  for (const match of text.matchAll(FPS_LINE)) {
    entries.push({
      load: match[1],
      best: Number(match[2]),
      worst: Number(match[3]),
      windows: match[4]
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value)),
    });
  }
  const printed = (text.match(/\[fps\]/g) ?? []).length;
  return { entries, printed, malformed: printed - entries.length };
}

/**
 * Report-only floor check for the worst window.
 *
 * Returns one warning string per guard whose worst window is under the floor.
 * Deliberately *not* an assertion — see the header: a single window can be
 * starved by anything else on the host, so the suite's assertion stays on the
 * best window and this only puts the dispersion in the release log.
 */
export function fpsFloorWarnings(entries, floor = FPS_FLOOR) {
  return entries
    .filter((entry) => entry.worst < floor)
    .map(
      (entry) =>
        `${entry.load}: worst window ${entry.worst.toFixed(1)} fps < floor ${floor} fps ` +
        `(best ${entry.best.toFixed(1)}; windows [${entry.windows.map((w) => w.toFixed(1)).join(', ')}]) ` +
        '— printed, not asserted (§一.20⑥)',
    );
}

/**
 * The release log's lines for a performance run, in order.
 *
 * One `·` line per guard — best **and** worst, both always, whatever they are —
 * followed by a `⚠` line for each guard whose worst window is under the floor.
 * Pure so the unit test can pin the exact text `release.mjs` prints; the release
 * itself only calls `log()` on these strings.
 */
export function fpsLogLines(entries, floor = FPS_FLOOR) {
  const lines = entries.map(
    (entry) =>
      `· ${entry.load} best ${entry.best.toFixed(1)} worst ${entry.worst.toFixed(1)} fps of ` +
      `[${entry.windows.map((w) => w.toFixed(1)).join(', ')}]`,
  );
  for (const warning of fpsFloorWarnings(entries, floor)) lines.push(`⚠ ${warning}`);
  return lines;
}
