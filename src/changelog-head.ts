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
    version: '1.101.0',
    date: '2026-09-13',
    kind: 'fix',
    items: [
      [
        '**硬同步的混叠爆发修好了**：BLEP 表是「带限阶跃 − 朴素阶跃」的残差，直接跨过它的跳变做线性插值会取错边，使每次重启有 1 个过采样样本被整级错修——约每 24 秒里有 ~11 秒爆到 **−33 dB**，听感是一层周期性噪声。改为对连续带限阶跃插值再显式减掉朴素阶跃后，三种波形 × 四个从振比值的**每一个** 4 秒窗都 ≤ **−88 dB**，离散度由 86 dB 降到 8–12 dB；时域相关 ≥0.9988、峰值有界。默认关闭，关闭时逐位不变。',
        '**Hard sync\'s alias bursts are fixed.** The BLEP table is the residual `band-limited step - naive step`, so interpolating across its jump reads the wrong side and hands back a full-magnitude correction of the wrong sign: one oversampled sample per restart was mis-corrected, bursting to **-33 dB** for about 11 s out of every 24 s as an audible periodic layer. Interpolating the continuous band-limited step and subtracting the naive step puts **every** four-second window of three waveforms times four ratios at or below **-88 dB**, cutting the spread from 86 dB to 8-12 dB with the time domain still correlated at 0.9988 or better. Sync is off by default and bit-identical when off.',
      ],
    ],
  };
