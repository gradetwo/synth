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
    version: '1.94.1',
    date: '2026-09-12',
    kind: 'fix',
    items: [
      [
        '**更新提示不再变形**：新版本提示改成一条紧凑的横条（版本号 + 这次更新了什么 + 立即更新 + 关闭），去掉了那个突兀的火箭图标；文案过长会优雅省略，而不是把两个按钮撑成一整块；手机上按钮落到下一行，不再把标题挤成一行三个字。',
        '**The update prompt stopped stretching**: the new-version notice is one compact bar now (version, what changed, Update now, dismiss) without the jarring rocket; a long headline ellipsizes instead of dragging the two buttons into tall blocks, and on a phone the actions take their own row instead of squeezing the title into three words per line.',
      ],
    ],
  };
