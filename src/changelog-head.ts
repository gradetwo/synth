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
    version: '2.1.4',
    date: '2026-09-15',
    kind: 'fix',
    items: [
      [
        '**两处「说错话」的地方修好了，采样导入也更快。** 在**音色 B（实例 2）**里改效果图时，画面以前会弹回实例 1 的值——现在图编辑器跟着你正在编辑的那一层走。导入**偏长的采样**时，现在会**明确告诉你已经截断**（以前是静默地只保留开头一段）。另外采样导入快了约 **35%**（4 秒样本 108 → 80 ms，同一台机器交替 A/B 测得），门禁里每一行采样读数都没有变化。',
        '**Two things that showed you the wrong thing are fixed, and sample import is faster.** Editing the effect graph on **instance B** used to snap back to instance A\'s values -- the editor now follows the layer you are editing. Importing an **over-long sample** now **tells you it was truncated** instead of quietly keeping only the front of it. Sample import is also about **35% faster** (a 4 s sample: 108 ms to 80 ms, interleaved A/B on one machine), with every sampler gate reading unchanged.',
      ],
    ],
  };
