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
    version: '1.108.0',
    date: '2026-09-14',
    kind: 'fix',
    items: [
      [
        '**回归门禁补强**：视觉基线 20 → **48 张**（更新横幅、take 行、滤波串联/并联、过采样指示灯、图模板、路由图调制线；深浅 × 手机/桌面），并暴露一个真相——**这批基线此前已经过期、套件本来就是红的**（10 张补录）。预设指纹现在同时覆盖 **1× 与 2×**（81 × 2）。应用未变：wasm 与上一版**逐字节相同**。',
        '**Regression gates widened.** Visual baselines 20 -> **48** (banner, take row, serial/parallel filter, oversampling LED, template picker, modulation wire; dark/light x desktop/phone), which also surfaced that they had gone stale and the suite was **already red** (ten re-recorded). Preset fingerprints now cover **1x and 2x** (81 x 2). The app is unchanged: the wasm is **byte-for-byte** the previous build.',
      ],
    ],
  };
