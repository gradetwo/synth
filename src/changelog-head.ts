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
    version: '2.0.4',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**导入的采样再干净一档。** 高音区的折回杂音从 −70 dB 降到 **−86 dB**，而且把上一版为压杂音牺牲掉的**高音亮度也拿回来了**——采样弹到原音以上一个八度时不再发闷。顺带修掉一个偶发、还随调用顺序变化的插值错位（相位表少了最后一行，约每 1024 个样本错用一次核）。导入速度没有变慢，反而略快。',
        '**Imported samples got cleaner again.** The folded-back grit in the high register drops from -70 dB to **-86 dB**, and the **brightness the last version traded away comes back** -- a sample played an octave above its root is no longer dull. Also fixed an intermittent interpolation slip that changed with call order: the phase table was missing its last row, so roughly one sample in 1024 used the wrong kernel. Importing is not slower; it is slightly faster.',
      ],
    ],
  };
