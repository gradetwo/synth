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
    version: '2.0.6',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**整体响了约 6 dB（大致 4 倍功率）。** 以前这台合成器明显比别的软件轻——即使振荡器开满、滤波全开，峰值也只到 −19 dBFS，限幅器几乎从不工作；现在同样设置是 −13 dBFS，工厂音色、默认音色与随机音色一起抬升。代价如实说明：把**极端**素材（十几个声部全开、主音量也拉满）推得更狠时，软削波会多一些（实测 1.5% 的采样点）。想更响需要改输出级设计，而不是继续加增益——实测 +9 dB 会让 2× 抗混叠余量真的劣化。另有几条**位粉碎**类工厂音色听感会变，因为它们现在才真正开始量化。',
        '**Everything is about 6 dB louder -- roughly four times the power.** The instrument used to sit well below other software: with the oscillators at full and the filter wide open, peaks reached only -19 dBFS and the limiter almost never worked. At the same settings it now reaches -13 dBFS, and factory, default and random patches move together. One honest cost: pushing **extreme** material (a dozen voices wide open with the master up) soft-limits a little more, measured at 1.5% of samples. Going further would need an output-stage redesign rather than more gain -- +9 dB was measured to erode the 2x anti-alias margin. A few **bit-crusher** factory patches also change audibly, because they only now start quantising.',
      ],
    ],
  };
