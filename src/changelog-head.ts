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
    version: '1.104.0',
    date: '2026-09-13',
    kind: 'feature',
    items: [
      [
        '**录音 take 更好用了**：take 可以**改名**（一个撤销步），可以 **A/B 试听**两个 take（键盘 A/B，播放位置不变，停止回到原来的），合并新增**覆盖**策略（同时间窗内更新的 take 覆盖旧的，原来只有并集）。另外修掉一个一直沉默的坑：**折叠成片段的层切 take 听感不会变**——现在会明确拒绝并提示「take 仅作素材」，不再让人以为切换生效了。',
        '**Recorded takes are easier to work with.** A take can be **renamed** (one undo step) and **A/B auditioned** against another (keys A/B, playhead preserved, stopping returns to the first), and merging gained an **overwrite** strategy (a newer take replaces the older material in the same time window, alongside the existing union). A silent trap is fixed too: on a layer that has been folded into clips, switching takes used to change nothing; it is now refused with "takes are material only" instead of pretending it worked.',
      ],
    ],
  };
