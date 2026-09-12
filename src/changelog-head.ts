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
    version: '1.97.0',
    date: '2026-09-12',
    kind: 'sound',
    items: [
      [
        '**硬同步不再有可闻的毛刺**：给同步振荡器换成专用的带限实现（朴素波形 + 相位回绕与主振重启的 BLEP/BLAMP 修正，共用同一套高精度相位），锯齿/方波/三角在同步时的混叠能量从约 −32/−34/−50 dB 降到 **−69/−69/−77 dB**（实测，整秒矩形窗精确 bin），也就是比原来低约 28–37 dB；时域上从振仍严格对齐主振周期（相关 0.9995+）。同步**关闭**时（默认）渲染与之前逐位相同。',
        '**Hard sync no longer has audible grit**: the synced oscillator now has its own band-limited implementation (naive shapes with BLEP/BLAMP corrections for both the phase wrap and the master restart, sharing one high-precision phase). Aliasing under sync drops from about −32/−34/−50 dB to **−69/−69/−77 dB** for saw, square and triangle (measured over an integer second with a rectangular window and exact bins) — roughly 28–37 dB lower — while the slave stays locked to the master’s period in the time domain (correlation above 0.9995). With sync **off** (the default) the render is sample-for-sample what it was.',
      ],
    ],
  };
