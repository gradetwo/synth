/**
 * The newest release, on its own.
 *
 * The update banner sits on the first screen and only needs its headline, but
 * importing `CHANGELOG` dragged every release note into the initial bundle —
 * which is exactly the budget the size gate is there to protect. The panel
 * that shows the history loads lazily; this is the one entry the banner reads,
 * and `changelog.test.ts` keeps it identical to `CHANGELOG[0]`.
 */
export interface Release {
  version: string;
  /** ISO date the build shipped. */
  date: string;
  kind: 'sound' | 'feature' | 'fix';
  items: [string, string][];
}

export const CHANGELOG_HEAD: Release = {
    version: '2.0.3',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**新增教学与练习模式。** 选一个音阶或和弦，目标音会在键盘上高亮；弹一遍就给出**可量化的评分**——命中率、音准、节奏偏差和 0–100 的总分。评分规则是写下来、可以手算复核的，不是黑箱。这个面板**按需加载**，所以从没打开过它的人不会为此多下载任何东西。',
        '**New teaching and practice mode.** Pick a scale or a chord and the target notes light up on the keyboard; play a take and it scores it -- hit rate, intonation, timing deviation and an overall 0-100. The scoring rule is written down and can be checked by hand rather than being a black box. The panel loads on demand, so anyone who never opens it downloads nothing for it.',
      ],
    ],
  };
