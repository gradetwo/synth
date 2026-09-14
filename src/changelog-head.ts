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
    version: '1.113.0',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**高音区更干净。** 波表音色在高音区原本有一层"沙"——那是插值读表的折回成分（非谐波能量 −26…−47 dB），现在**最差 −98 dB**；导入的采样音色也一并更干净（−30 → −33 dB，这条受录音自身带宽限制，已如实记录）。用到波表的 4 个工厂预设音色会有轻微变化，其余 77 个在百分之一 dB 以内，默认音色不受影响。内部同时加入了发布版本保留 + 一键回滚，以及 nightly 的平台矩阵报告（对使用者不可见）。',
        '**Cleaner high notes.** Wavetable voices carried a layer of grit up high -- the folded-back products of reading the tables with interpolation, at -26...-47 dB of non-harmonic energy -- and that now measures a worst case of **-98 dB**. Imported samples are cleaner too (-30 -> -33 dB, limited by the recording\'s own bandwidth, which is written down honestly). Four factory presets that use wavetables change slightly, the other 77 stay within a hundredth of a dB, and the default voice is untouched. Internally this also brings release retention with one-command rollback and a nightly platform-matrix report, neither visible in the app.',
      ],
    ],
  };
