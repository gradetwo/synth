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
    version: '1.102.0',
    date: '2026-09-13',
    kind: 'sound',
    items: [
      [
        '**普通振荡器的混叠底噪基本消失**：锯齿/方波/三角改用硬同步那套带限振荡器，全键盘离格能量从最差 **−37.4/−39.0/−49.4 dB** 降到 **−100.8/−111.3/−72.9 dB**；正弦/波表/采样不变，并补上 23.5 样本延迟补偿。代价是振荡器约 2.6× CPU；**这是有意的音色改变**，81 个预设指纹已显式重录。',
        '**The ordinary oscillators\' aliasing floor is essentially gone.** Saw, square and triangle now use hard sync\'s band-limited oscillator: their worst off-grid energy drops from **-37.4/-39.0/-49.4 dB** to **-100.8/-111.3/-72.9 dB**, while sine, wavetable and sample keep their path and gain a 23.5-sample delay compensation. The cost is about 2.6x CPU in the oscillator; **this is a deliberate change of sound**, so all 81 preset fingerprints were re-recorded.',
      ],
    ],
  };
