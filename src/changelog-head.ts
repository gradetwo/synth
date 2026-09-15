/**
 * The newest release, on its own.
 *
 * The update banner sits on the first screen and only needs its headline, but
 * importing `CHANGELOG` dragged every release note into the initial bundle —
 * which is exactly the budget the size gate is there to protect. The panel
 * that shows the history loads lazily; this is the one entry the banner reads,
 * and `changelog.test.ts` keeps it identical to `CHANGELOG[0]`.
 *
 * A release ends by rotating this file: the entry that was here moves into
 * `CHANGELOG` (as a literal, right behind the head reference) and the oldest
 * shipped entry moves to the front of `changelog-archive.ts`, so the shipped
 * list stays at `SHIPPED_CHANGELOG_LIMIT`. `changelog.test.ts` fails if any of
 * that is skipped, done twice, or done with a typo.
 */
export interface Release {
  version: string;
  /** ISO date the build shipped. */
  date: string;
  kind: 'sound' | 'feature' | 'fix';
  items: [string, string][];
}

export const CHANGELOG_HEAD: Release = {
    version: '2.1.3',
    date: '2026-09-15',
    kind: 'feature',
    items: [
      [
        '**首屏更轻了：预设库与内置曲库改成「用到才下载」。** 以前无论你要不要打开它们，这两坨数据（91 条工厂预设 + 25 首内置曲目）都跟着首屏一起下载；现在它们在你**打开音色抽屉或播放器时**才取，首屏要下载的 JS 少了约 **12 KB**（gzip）。代价写清楚：首次打开这两个面板会有一瞬间的加载状态；**离线**且从未联网打开过它们时，会看到「加载失败 + 重试」。合成器的声音没有任何变化。',
        '**A lighter first screen: the preset library and the built-in songs load only when you use them.** Both used to come down with the first screen whether you opened them or not (91 factory presets, 25 songs); they are fetched when you **open the preset drawer or the player**, which takes about **12 KB gzip** off what a first visit loads up front. The cost, stated plainly: the first open of those panels shows a brief loading state, and **offline** -- if you have never opened them online -- a "load failed / retry" line instead. The synth sounds exactly as before.',
      ],
    ],
  };
