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
    version: '2.0.1',
    date: '2026-09-14',
    kind: 'sound',
    items: [
      [
        '**导入的采样音色更干净了**：高音区的折回杂音从 −33 dB 降到 **−70 dB**——这也是采样器「逐级抽取」那个老问题的真正修复。副作用如实说明：把采样弹得比原音略高时，亮度会比上一版窄一点。另外修好了 **Safari / Firefox 里点不中连线**的问题（虚线描边的命中区在 Gecko/WebKit 上会漏掉一段）。工厂预设与默认音色未变。',
        '**Imported samples sound cleaner.** The folded-back grit in the high register drops from -33 dB to **-70 dB**, which is the real fix for how the sampler decimated its levels. One honest side effect: playing a sample a little above its root sounds slightly less bright than the last version. Also fixed **wires being unclickable in Safari and Firefox**, where the hit area of a dashed stroke has gaps. No factory preset or default voice moved.',
      ],
    ],
  };
