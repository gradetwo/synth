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
    version: '1.93.0',
    date: '2026-09-12',
    kind: 'sound',
    items: [
      [
        '**过采样开关：更干净的失真与滤波**：滤波模块多了一个「2×」开关（默认关）。开启后失真与滤波在双倍采样率下运算、再带限降到原采样率，满驱动下的混叠与镜像分量实测**降低约 26 dB**，硬削波听起来更干净、毛刺更少；代价是 CPU 约翻倍（16 音密集音色从 16.6% 升到 31.1% 的实时预算）。默认关，关闭时与旧版本的渲染**逐位一致**。',
        '**An oversampling switch for cleaner drive and filtering**: the filter module gained a 2× switch (off by default). With it on, the drive and the filter run at double the sample rate and are band-limited back down, measuring about **26 dB less aliasing and imaging** at full drive — a cleaner hard clip with less grit. It costs roughly double the CPU (a dense 16-voice patch goes from 16.6% to 31.1% of the real-time budget). Off by default, and off renders sample-for-sample what the old build did.',
      ],
    ],
  };
