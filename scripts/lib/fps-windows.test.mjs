import { describe, expect, it } from 'vitest';

import { FPS_FLOOR, fpsFloorWarnings, fpsLogLines, readFpsLines } from './fps-windows.mjs';

/**
 * The release log's reader (§一.20⑥), pinned against a synthetic run.
 *
 * The point of the batch is that "best high, worst low" must be *visible*: the
 * assertion stays best-of-five, so the only place the worst window can show up
 * is this reader's output and the release log's `⚠` line. These cases are the
 * self-proof that a line in that shape is read (and reported) as intended, and
 * that the old shape — which had no worst window — no longer passes silently.
 */
describe('fps window reading', () => {
  it('reads best, worst and the window list from the spec line', () => {
    const { entries, printed, malformed } = readFpsLines(
      '[fps] playback best 52.5 worst 37.5 of [42.5, 52.5, 50.0, 37.5, 48.8] fps\n',
    );
    expect(malformed).toBe(0);
    expect(printed).toBe(1);
    expect(entries).toEqual([
      { load: 'playback', best: 52.5, worst: 37.5, windows: [42.5, 52.5, 50.0, 37.5, 48.8] },
    ]);
  });

  it('keeps the worst window of a best-high / worst-low run visible', () => {
    // The exact shape §一.20⑥ recorded: the best window is far above the floor
    // while the worst one sits barely above it. The guard passes (a pass is
    // correct here — nothing is under 20), and the point of the batch is that
    // the dispersion is still *reported* rather than hidden behind "best 60.0".
    const { entries } = readFpsLines(
      '[fps] graph-edit best 60.0 worst 21.3 of [21.3, 32.5, 42.5, 33.8, 60.0] fps\n',
    );
    expect(entries[0].best).toBeGreaterThan(FPS_FLOOR);
    expect(entries[0].worst).toBe(21.3);
    expect(entries[0].windows).toEqual([21.3, 32.5, 42.5, 33.8, 60.0]);
    // Barely above the floor is not under it: best-of-five stays the assertion,
    // so this must not become a failure line.
    expect(fpsFloorWarnings(entries)).toEqual([]);
  });

  it('says nothing when every window clears the floor', () => {
    const { entries, printed, malformed } = readFpsLines(
      [
        '[fps] idle-with-engine best 61.3 worst 53.8 of [61.3, 53.8, 61.3, 61.3, 60.0] fps',
        '[fps] playback best 52.5 worst 37.5 of [42.5, 52.5, 50.0, 37.5, 48.8] fps',
        '[fps] graph-edit best 61.3 worst 53.8 of [53.8, 56.3, 61.3, 58.8, 58.8] fps',
      ].join('\n'),
    );
    expect(printed).toBe(3);
    expect(malformed).toBe(0);
    expect(fpsFloorWarnings(entries)).toEqual([]);
  });

  it('rejects the old shape, so a drift cannot hide the worst window', () => {
    // Before this batch the line was `... best 52.5 of [52.5] fps`. A release
    // that read it as fine would silently drop the number the batch added, so
    // the reader counts it as malformed instead.
    const { entries, printed, malformed } = readFpsLines('[fps] playback best 52.5 of [52.5] fps\n');
    expect(printed).toBe(1);
    expect(entries).toEqual([]);
    expect(malformed).toBe(1);
  });

  it('reports a run that printed nothing at all', () => {
    const { entries, printed, malformed } = readFpsLines('6 passed (34.0s)\n');
    expect(printed).toBe(0);
    expect(malformed).toBe(0);
    expect(entries).toEqual([]);
  });

  it('flags a worst window below the floor, and says it is not an assertion', () => {
    const { entries } = readFpsLines('[fps] playback best 30.0 worst 12.0 of [12.0, 30.0] fps\n');
    const warnings = fpsFloorWarnings(entries, 20);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('playback: worst window 12.0 fps < floor 20 fps');
    expect(warnings[0]).toContain('printed, not asserted');
  });

  it('uses the spec floor by default, so the two cannot drift', () => {
    const { entries } = readFpsLines(
      `[fps] playback best 30.0 worst ${FPS_FLOOR - 0.1} of [30.0] fps\n`,
    );
    expect(fpsFloorWarnings(entries)).toHaveLength(1);
  });

  it('prints both numbers for every guard, and a ⚠ line for a starved window', () => {
    // This is the exact text `scripts/release.mjs` logs (it only prefixes
    // `[release]   `), so the batch's "worst window is visible" claim is pinned
    // here rather than in a shell snippet.
    const { entries } = readFpsLines(
      [
        '[fps] idle-with-engine best 61.3 worst 53.8 of [61.3, 53.8, 61.3, 61.3, 60.0] fps',
        '[fps] playback best 30.0 worst 12.0 of [12.0, 30.0] fps',
      ].join('\n'),
    );
    expect(fpsLogLines(entries)).toEqual([
      '· idle-with-engine best 61.3 worst 53.8 fps of [61.3, 53.8, 61.3, 61.3, 60.0]',
      '· playback best 30.0 worst 12.0 fps of [12.0, 30.0]',
      '⚠ playback: worst window 12.0 fps < floor 20 fps (best 30.0; windows [12.0, 30.0]) — printed, not asserted (§一.20⑥)',
    ]);
  });

  it('prints the worst window even when nothing is wrong', () => {
    const { entries } = readFpsLines(
      '[fps] graph-edit best 60.0 worst 21.3 of [21.3, 32.5, 42.5, 33.8, 60.0] fps\n',
    );
    const lines = fpsLogLines(entries);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('best 60.0');
    expect(lines[0]).toContain('worst 21.3');
  });
});
