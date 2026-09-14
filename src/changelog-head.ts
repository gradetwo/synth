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
    version: '2.0.2',
    date: '2026-09-14',
    kind: 'feature',
    items: [
      [
        '**新增 10 个工厂音色和 5 首曲子。** 新音色专门展示双滤波、位粉碎、过采样与图内调制这几项能力；曲库扩到 25 首，全部公版并标注来源。顺带修好更新横幅：**它现在报的是「将要安装的版本」**，而不是页面正在跑的那个——回滚之后那条提示曾经指向的就是被回滚掉的版本。',
        '**Ten new factory patches and five more songs.** The patches exist to show off the dual filter, the bit crusher, oversampling and in-graph modulation; the library grows to 25 tracks, all public domain and each labelled with its source. Also fixed: the update banner now names **the version it is about to install** rather than the one the page is running -- after a rollback that notice used to point at the very version being rolled back.',
      ],
    ],
  };
